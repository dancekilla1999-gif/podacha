const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { reset, sql, invoke, cookie } = require('./helper');
const db = require('../srv/lib/db');
const tg = require('../srv/api/tg-http');
const auth = require('../srv/api/auth-http');
const { signInitData } = require('../srv/lib/telegram');

const logs = [];
const seenInit = [];
const origInfo = console.info;
console.info = (...a) => { logs.push(a.map((x) => String(x)).join(' ')); };

function dev(label) {
  return crypto.createHash('sha256').update(String(label)).digest('hex');
}
function initData(userId, ageSec) {
  const raw = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000) - (ageSec || 0)),
    query_id: 'q' + userId + '-' + Math.random().toString(16).slice(2),
    signature: 'sig-' + userId,
    user: JSON.stringify({ id: userId, first_name: 'Егор', username: 'rundego', language_code: 'ru' })
  }, process.env.TG_BOT_TOKEN);
  seenInit.push(raw);
  return raw;
}
function authHeaders(ip) {
  return { 'x-real-ip': ip, origin: 'https://podacha.test', host: 'podacha.test' };
}

async function makeUser(email) {
  const r = await sql(
    `insert into app.owners (email, pass_hash, name)
     values ($1, extensions.crypt($2, extensions.gen_salt('bf', 4)), 'Тест') returning id::text`,
    [email, 'password-ok']
  );
  return r.rows[0].id;
}

async function webLogin(email, ip) {
  return invoke(auth.login, { body: { email, password: 'password-ok' }, headers: authHeaders(ip || '203.0.113.40') });
}

test.describe('кабинет и telegram', { concurrency: 1 }, () => {
  test.before(async () => { await reset(); });
  test.after(async () => {
    await db.close();
    console.info = origInfo;
  });

  test('регистрация только по приглашению', async () => {
    let hint = '';
    try { await sql(`select public.pd_owner_register('open@podacha.test', 'password-ok', '')`); }
    catch (e) { hint = e.hint; }
    assert.equal(hint, 'invite');
    const no = await invoke(auth.register, { body: { email: 'open@podacha.test', password: 'password-ok', name: 'А' } });
    assert.equal(no.status, 403);
    assert.match(no.json.error, /приглашен/);
    const bad = await invoke(auth.register, { body: { email: 'open@podacha.test', password: 'password-ok', invite: 'no-such-code-here-xxxxxx' } });
    assert.equal(bad.status, 403);
    const issued = await db.service('pd_owner_invite_issue', { p_note: 'егор', p_secret: process.env.TG_SESSION_SECRET });
    assert.equal(issued.code.length, 22);
    const hash = crypto.createHash('sha256').update(issued.code).digest('hex');
    const stored = await sql('select code_hash from app.owner_invites where code_hash = $1', [hash]);
    assert.equal(stored.rowCount, 1);
    const plain = await sql('select count(*)::int as n from app.owner_invites where note like $1', ['%' + issued.code + '%']);
    assert.equal(plain.rows[0].n, 0);
    const ok = await invoke(auth.register, {
      body: { email: 'owner@podacha.test', password: 'password-ok', name: 'Егор', invite: issued.code }
    });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.token);
    assert.match(ok.headers['set-cookie'], /HttpOnly/);
    assert.match(ok.headers['set-cookie'], /Secure/);
    assert.match(ok.headers['set-cookie'], /SameSite=Strict/);
    assert.match(ok.headers['set-cookie'], /Path=\/api\/auth/);
    const again = await invoke(auth.register, {
      body: { email: 'other@podacha.test', password: 'password-ok', name: 'Б', invite: issued.code }
    });
    assert.equal(again.status, 403);
  });

  test('anon не вызывает функции сессии даже с верным секретом', async () => {
    const { Client } = require('pg');
    const secret = process.env.TG_SESSION_SECRET;
    const fns = [
      `select public.pd_tg_session(1, 'a', 'b', '${dev('a')}', 'lab', 'ip', '${secret}')`,
      `select public.pd_tg_link(1, 'a', 'b', '${dev('a')}', 'lab', 'ip', 'cccccccccccccccccccccc', '${'ab'.repeat(32)}', true, '2026-11-26', '${secret}')`,
      `select public.pd_tg_login(1, 'a', 'b', '${dev('a')}', 'lab', 'ip', 'a@b.co', 'x', '${'cd'.repeat(32)}', true, '2026-11-26', '${secret}')`,
      `select public.pd_link_code_consume('code', '${secret}')`
    ];
    for (const q of fns) {
      const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
      await c.connect();
      let code = '';
      try {
        await c.query('begin');
        await c.query('set local role anon');
        await c.query(q);
      } catch (e) { code = e.code; }
      finally {
        try { await c.query('rollback'); } catch (e) { /* уже оборвано */ }
        await c.end();
      }
      assert.equal(code, '42501', q.slice(0, 48));
    }
    const row = await db.service('pd_tg_session', {
      p_tg_user_id: '1001', p_first_name: 'Егор', p_username: 'rundego',
      p_device_key: dev('none'), p_device_label: 'iPhone · Telegram', p_ip_hash: 'ip', p_secret: secret
    });
    assert.equal(row.need_link, true);
    assert.equal(row.tg.first_name, 'Егор');
    let denied = '';
    try {
      await db.service('pd_tg_session', {
        p_tg_user_id: '1001', p_first_name: 'Егор', p_username: 'rundego',
        p_device_key: dev('none'), p_device_label: 'x', p_ip_hash: 'ip', p_secret: 'wrong-secret-value!!'
      });
    } catch (e) { denied = e.hint; }
    assert.equal(denied, 'forbidden');
  });

  test('подсказки сессии и отказ RPC', async () => {
    await makeUser('hints@podacha.test');
    const login = await webLogin('hints@podacha.test', '203.0.113.41');
    const token = login.json.token;
    const reasons = ['logout', 'logout_all', 'password', 'admin', 'unbind', 'device_end', 'refresh_reuse'];
    for (const reason of reasons) {
      await sql(`update app.owner_sessions set revoked_at = now(), revoke_reason = $2, expires_at = now() + interval '1 day' where token_hash = app.hash_token($1)`, [token, reason]);
      let hint = '';
      try { await sql('select app.owner_id($1)', [token]); } catch (e) { hint = e.hint; }
      assert.equal(hint, 'revoked', reason);
      await sql(`update app.owner_sessions set revoked_at = null, revoke_reason = null where token_hash = app.hash_token($1)`, [token]);
    }
    await sql(`update app.owner_sessions set revoked_at = now(), revoke_reason = 'rotated' where token_hash = app.hash_token($1)`, [token]);
    let hint = '';
    try { await sql('select app.owner_id($1)', [token]); } catch (e) { hint = e.hint; }
    assert.equal(hint, 'expired');
    await sql(`update app.owner_sessions set revoked_at = null, revoke_reason = null, expires_at = now() - interval '1 second' where token_hash = app.hash_token($1)`, [token]);
    hint = '';
    try { await sql('select app.owner_id($1)', [token]); } catch (e) { hint = e.hint; }
    assert.equal(hint, 'expired');
    await sql(`update app.owner_sessions set expires_at = now() + interval '1 day', abs_expires_at = now() - interval '1 second' where token_hash = app.hash_token($1)`, [token]);
    hint = '';
    try { await sql('select app.owner_id($1)', [token]); } catch (e) { hint = e.hint; }
    assert.equal(hint, 'expired');
    await sql(`update app.owners set disabled_at = now() where email = 'hints@podacha.test'`);
    await sql(`update app.owner_sessions set revoked_at = null, revoke_reason = null, expires_at = now() + interval '1 day', abs_expires_at = null where token_hash = app.hash_token($1)`, [token]);
    hint = '';
    try { await sql('select app.owner_id($1)', [token]); } catch (e) { hint = e.hint; }
    assert.equal(hint, 'disabled');
    await sql(`update app.owners set disabled_at = null where email = 'hints@podacha.test'`);
    await sql(`update app.owner_sessions set revoked_at = now(), revoke_reason = 'logout' where token_hash = app.hash_token($1)`, [token]);
    const names = ['pd_agent', 'pd_last_venue', 'pd_menu_confirm', 'pd_menu_filter', 'pd_menu_get', 'pd_menu_import', 'pd_menu_item_delete', 'pd_menu_item_save', 'pd_owner_logout', 'pd_owner_me', 'pd_owner_password', 'pd_report', 'pd_report_days', 'pd_staff_new_link', 'pd_staff_update', 'pd_team_get', 'pd_venue_create', 'pd_venue_new_invite', 'pd_venue_update', 'pd_bill_status'];
    for (const name of names) {
      let h = '';
      try {
        if (name === 'pd_owner_password') await sql(`select public.${name}($1, 'nope', 'password-ok')`, [token]);
        else await sql(`select public.${name}($1)`, [token]);
      } catch (e) { h = e.hint; }
      assert.equal(h, 'revoked', name);
    }
    const vol = await sql(`select p.proname, p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('owner_id', 'session_touch')`);
    const map = Object.fromEntries(vol.rows.map((r) => [r.proname, r.provolatile]));
    assert.equal(map.owner_id, 's');
    assert.equal(map.session_touch, 'v');
    const src = await sql(`select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'owner_id'`);
    assert.equal(/insert|update/i.test(src.rows[0].prosrc), false);
  });

  test('refresh: ротация, окно 60 с, затем кража', async () => {
    await makeUser('refresh@podacha.test');
    const login = await webLogin('refresh@podacha.test', '203.0.113.42');
    const firstAccess = login.json.token;
    const firstRefresh = cookie(login);
    assert.match(login.headers['set-cookie'], /HttpOnly; Secure; SameSite=Strict; Path=\/api\/auth; Max-Age=31536000/);
    const foreign = await invoke(auth.refresh, { headers: Object.assign(authHeaders('203.0.113.42'), { origin: 'https://evil.test', cookie: 'pd_rt=' + firstRefresh }) });
    assert.equal(foreign.status, 403);
    const next = await invoke(auth.refresh, { headers: Object.assign(authHeaders('203.0.113.42'), { cookie: 'pd_rt=' + firstRefresh }) });
    assert.equal(next.status, 200);
    const again = await invoke(auth.refresh, { headers: Object.assign(authHeaders('203.0.113.42'), { cookie: 'pd_rt=' + firstRefresh }) });
    assert.equal(again.status, 200);
    assert.equal(again.json.token, next.json.token);
    assert.equal(cookie(again), cookie(next));
    const leaked = await sql(`select count(*)::int as n from app.owner_sessions where grace_cipher like $1 or token_hash = $1 or device_label like $1`, ['%' + next.json.token + '%']);
    assert.equal(leaked.rows[0].n, 0);
    await sql(`update app.owner_sessions set grace_expires_at = now() - interval '1 second' where revoke_reason = 'rotated' and token_hash = app.hash_token($1)`, [firstRefresh]);
    const theft = await invoke(auth.refresh, { headers: Object.assign(authHeaders('203.0.113.42'), { cookie: 'pd_rt=' + firstRefresh }) });
    assert.equal(theft.status, 401);
    assert.equal(theft.json.hint, 'revoked');
    let dead = '';
    try { await sql('select app.owner_id($1)', [next.json.token]); } catch (e) { dead = e.hint; }
    assert.equal(dead, 'revoked');
    const ev = await sql(`select count(*)::int as n from app.auth_events where kind = 'refresh_reuse'`);
    assert.ok(ev.rows[0].n >= 1);
    assert.notEqual(firstAccess, next.json.token);
  });

  test('лимиты почты и IP, подмена x-forwarded-for не помогает', async () => {
    await makeUser('limit@podacha.test');
    for (let i = 0; i < 10; i++) {
      const r = await invoke(auth.login, {
        body: { email: 'limit@podacha.test', password: 'wrong-pass' },
        headers: authHeaders('198.51.100.10')
      });
      assert.equal(r.status, 401, String(i));
      assert.equal(r.json.error, 'Неверная почта или пароль');
    }
    const missing = await invoke(auth.login, {
      body: { email: 'nobody-limit@podacha.test', password: 'wrong-pass' },
      headers: authHeaders('198.51.100.11')
    });
    assert.equal(missing.json.error, 'Неверная почта или пароль');
    const blocked = await invoke(auth.login, {
      body: { email: 'limit@podacha.test', password: 'password-ok' },
      headers: Object.assign(authHeaders('198.51.100.10'), { 'x-forwarded-for': '1.2.3.4' })
    });
    assert.equal(blocked.status, 429);
    assert.match(blocked.json.error, /Слишком много попыток, подождите \d+ мин/);
    for (let i = 0; i < 30; i++) {
      await invoke(auth.login, {
        body: { email: 'ip' + i + '@podacha.test', password: 'wrong-pass' },
        headers: Object.assign(authHeaders('198.51.100.50'), { 'x-forwarded-for': '9.9.9.' + i })
      });
    }
    const ipBlock = await invoke(auth.login, {
      body: { email: 'fresh-ip@podacha.test', password: 'wrong-pass' },
      headers: Object.assign(authHeaders('198.51.100.50'), { 'x-forwarded-for': '8.8.8.8' })
    });
    assert.equal(ipBlock.status, 429);
    const otherIp = await invoke(auth.login, {
      body: { email: 'fresh-ip@podacha.test', password: 'wrong-pass' },
      headers: authHeaders('198.51.100.51')
    });
    assert.equal(otherIp.status, 401);
  });

  test('привязка кодом, согласие, один telegram, гонки', async () => {
    await makeUser('link@podacha.test');
    await makeUser('other@podacha.test');
    const login = await webLogin('link@podacha.test', '203.0.113.60');
    const other = await webLogin('other@podacha.test', '203.0.113.61');
    const codes = [];
    for (let i = 0; i < 5; i++) {
      const c = await invoke(auth.linkCode, { headers: Object.assign(authHeaders('203.0.113.60'), { authorization: 'Bearer ' + login.json.token }) });
      assert.equal(c.status, 200, JSON.stringify(c.json));
      assert.equal(c.json.code.length >= 22, true);
      assert.match(c.json.url, /^https:\/\/t\.me\/trio_podacha_bot\/app\?startapp=l_/);
      codes.push(c.json.code);
    }
    const sixth = await invoke(auth.linkCode, { headers: Object.assign(authHeaders('203.0.113.60'), { authorization: 'Bearer ' + login.json.token }) });
    assert.equal(sixth.status, 429);
    const stored = await sql('select code_hash from app.tg_link_codes');
    for (const row of stored.rows) assert.equal(codes.includes(row.code_hash), false);

    const data = initData(9001, 0);
    const noConsent = await invoke(tg.link, { body: { initData: data, code: codes[0], consent: false, device_key: dev('phone') } });
    assert.equal(noConsent.status, 400);
    const links = await sql('select count(*)::int as n from app.tg_links');
    assert.equal(links.rows[0].n, 0);

    const hex = await invoke(tg.link, { body: { initData: data, code: 'abcdef0123456789ab', consent: true, device_key: dev('phone') }, headers: authHeaders('203.0.113.70') });
    assert.equal(hex.status, 401);
    assert.equal(JSON.stringify(hex.json).includes(data), false);

    const oldCode = codes[1];
    await sql(`update app.tg_link_codes set expires_at = now() - interval '1 minute' where code_hash = app.hash_token($1)`, [oldCode]);
    const expired = await invoke(tg.link, { body: { initData: initData(9001, 30), code: oldCode, consent: true, device_key: dev('phone') }, headers: authHeaders('203.0.113.71') });
    assert.equal(expired.status, 401);

    const good = await invoke(tg.link, {
      body: { initData: initData(9001, 30), code: codes[2], consent: true, device_key: dev('phone'), device_label: 'iPhone · Telegram' },
      headers: authHeaders('203.0.113.72')
    });
    assert.equal(good.status, 200, JSON.stringify(good.json));
    const consent = await sql(`select kind, version, withdrawn_at from app.consents where tg_user_id = 9001`);
    assert.equal(consent.rows[0].kind, 'tg_login');
    assert.equal(consent.rows[0].version, '2026-11-26');
    assert.equal(consent.rows[0].withdrawn_at, null);
    const reuse = await invoke(tg.link, {
      body: { initData: initData(9002, 0), code: codes[2], consent: true, device_key: dev('other') },
      headers: authHeaders('203.0.113.73')
    });
    assert.equal(reuse.status, 401);

    const secondTg = await invoke(tg.login, {
      body: { initData: initData(9003, 0), email: 'link@podacha.test', password: 'password-ok', consent: true, device_key: dev('desk') },
      headers: authHeaders('203.0.113.74')
    });
    assert.equal(secondTg.status, 409);

    const taken = await invoke(tg.login, {
      body: { initData: initData(9001, 0), email: 'other@podacha.test', password: 'password-ok', consent: true, device_key: dev('desk2') },
      headers: authHeaders('203.0.113.75')
    });
    assert.equal(taken.status, 409);
    assert.match(taken.json.error, /другому аккаунту/);

    const status = await invoke(auth.linkStatus, {
      method: 'GET',
      url: '/api/auth/link-status?code=' + codes[2],
      headers: Object.assign(authHeaders('203.0.113.60'), { authorization: 'Bearer ' + login.json.token })
    });
    assert.equal(status.json.state, 'linked');
    assert.equal(status.json.username, 'rundego');
    const dispute = await invoke(auth.linkDispute, { headers: Object.assign(authHeaders('203.0.113.60'), { authorization: 'Bearer ' + login.json.token }) });
    assert.equal(dispute.status, 200);
    const withdrawn = await sql(`select withdrawn_at is not null as w from app.consents where tg_user_id = 9001 order by id desc limit 1`);
    assert.equal(withdrawn.rows[0].w, true);
    const gone = await sql('select count(*)::int as n from app.tg_links where tg_user_id = 9001');
    assert.equal(gone.rows[0].n, 0);
    const ev = await sql(`select count(*)::int as n from app.auth_events where kind = 'tg_unlink_disputed'`);
    assert.equal(ev.rows[0].n, 1);
  });

  test('неверный пароль не сжигает initData, параллельный вход — один успех', async () => {
    await makeUser('race@podacha.test');
    const data = initData(9100, 0);
    const bad = await invoke(tg.login, {
      body: { initData: data, email: 'race@podacha.test', password: 'nope-nope', consent: true, device_key: dev('p') },
      headers: authHeaders('203.0.113.80')
    });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error, 'Неверная почта или пароль');
    const good = await invoke(tg.login, {
      body: { initData: data, email: 'race@podacha.test', password: 'password-ok', consent: true, device_key: dev('p') },
      headers: authHeaders('203.0.113.80')
    });
    assert.equal(good.status, 200, JSON.stringify(good.json));
    await invoke(tg.unbind, { headers: { authorization: 'Bearer ' + good.json.token } });

    const burst = initData(9100, 0);
    const all = await Promise.all(Array.from({ length: 20 }, () => invoke(tg.login, {
      body: { initData: burst, email: 'race@podacha.test', password: 'password-ok', consent: true, device_key: dev('burst') },
      headers: authHeaders('203.0.113.81')
    })));
    assert.equal(all.filter((r) => r.status === 200).length, 1);
    assert.equal(all.filter((r) => r.json && r.json.error === 'REPLAY').length, 19);
    const replay = await invoke(tg.login, {
      body: { initData: burst, email: 'race@podacha.test', password: 'password-ok', consent: true, device_key: dev('burst2') },
      headers: authHeaders('203.0.113.82')
    });
    assert.equal(replay.json.error, 'REPLAY');

    await makeUser('race2@podacha.test');
    const login = await webLogin('race2@podacha.test', '203.0.113.83');
    const c1 = await invoke(auth.linkCode, { headers: Object.assign(authHeaders('203.0.113.83'), { authorization: 'Bearer ' + login.json.token }) });
    const shared = initData(9200, 0);
    const both = await Promise.all([0, 1].map((n) => invoke(tg.link, {
      body: { initData: shared, code: c1.json.code, consent: true, device_key: dev('L' + n) },
      headers: authHeaders('203.0.113.84')
    })));
    assert.equal(both.filter((r) => r.status === 200).length, 1);
    const nlinks = await sql('select count(*)::int as n from app.tg_links where owner_id = (select id from app.owners where email = $1)', ['race2@podacha.test']);
    assert.equal(nlinks.rows[0].n, 1);
  });

  test('два устройства, ротация, лимит 5, сроки 7 и 30 суток', async () => {
    await makeUser('dev@podacha.test');
    const a = await invoke(tg.login, {
      body: { initData: initData(9300, 0), email: 'dev@podacha.test', password: 'password-ok', consent: true, device_key: dev('A'), device_label: 'iPhone · Telegram' },
      headers: authHeaders('203.0.113.90')
    });
    const b = await invoke(tg.auth, {
      body: { initData: initData(9300, 0), device_key: dev('B'), device_label: 'Windows · Telegram' },
      headers: authHeaders('203.0.113.91')
    });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal((await sql('select app.owner_id($1)', [a.json.token])).rows[0].owner_id.length > 0, true);
    const a2 = await invoke(tg.auth, {
      body: { initData: initData(9300, 0), device_key: dev('A'), device_label: 'iPhone · Telegram' },
      headers: authHeaders('203.0.113.90')
    });
    assert.equal(a2.status, 200);
    assert.notEqual(a2.json.token, a.json.token);
    let hint = '';
    try { await sql('select app.owner_id($1)', [a.json.token]); } catch (e) { hint = e.hint; }
    assert.equal(hint, 'expired');
    assert.equal((await sql('select app.owner_id($1)::text as id', [b.json.token])).rows[0].id.length > 0, true);

    for (let i = 0; i < 4; i++) {
      await invoke(tg.auth, {
        body: { initData: initData(9300, 0), device_key: dev('D' + i), device_label: 'D' + i },
        headers: authHeaders('203.0.113.92')
      });
      await sql(`update app.owner_sessions set last_used_at = now() - ($1 || ' minutes')::interval where device_key = $2 and revoked_at is null`, [String(10 - i), dev('D' + i)]);
    }
    await sql(`update app.owner_sessions set last_used_at = now() - interval '1 hour' where device_key = $1 and revoked_at is null`, [dev('B')]);
    const sixth = await invoke(tg.auth, {
      body: { initData: initData(9300, 0), device_key: dev('SIX'), device_label: 'шестое' },
      headers: authHeaders('203.0.113.93')
    });
    assert.equal(sixth.status, 200);
    const active = await sql(`select count(*)::int as n from app.owner_sessions where kind = 'tg' and revoked_at is null and tg_user_id = 9300 and expires_at > now()`);
    assert.ok(active.rows[0].n <= 5);
    const oldest = await sql(`select revoke_reason from app.owner_sessions where device_key = $1 order by created_at desc limit 1`, [dev('B')]);
    assert.equal(oldest.rows[0].revoke_reason, 'rotated');
    const back = await invoke(tg.auth, {
      body: { initData: initData(9300, 0), device_key: dev('B'), device_label: 'Windows · Telegram' },
      headers: authHeaders('203.0.113.91')
    });
    assert.equal(back.status, 200);

    await sql(`update app.owner_sessions set expires_at = now() - interval '1 second' where token_hash = app.hash_token($1)`, [back.json.token]);
    let expired = '';
    try { await sql('select app.owner_id($1)', [back.json.token]); } catch (e) { expired = e.hint; }
    assert.equal(expired, 'expired');
    const silent = await invoke(tg.auth, {
      body: { initData: initData(9300, 0), device_key: dev('B') },
      headers: authHeaders('203.0.113.91')
    });
    assert.equal(silent.status, 200);
    await sql(`update app.owner_sessions set abs_expires_at = now() - interval '1 second', expires_at = now() + interval '1 day' where token_hash = app.hash_token($1)`, [silent.json.token]);
    expired = '';
    try { await sql('select app.owner_id($1)', [silent.json.token]); } catch (e) { expired = e.hint; }
    assert.equal(expired, 'expired');

    const touch = await sql(`select expires_at from app.owner_sessions where token_hash = app.hash_token($1)`, [silent.json.token]);
    await sql(`update app.owner_sessions set expires_at = now() + interval '7 days' - interval '2 hours', abs_expires_at = now() + interval '20 days', revoked_at = null, revoke_reason = null where token_hash = app.hash_token($1)`, [silent.json.token]);
    await sql('select app.session_touch($1)', [silent.json.token]);
    const after1 = await sql(`select expires_at from app.owner_sessions where token_hash = app.hash_token($1)`, [silent.json.token]);
    await sql('select app.session_touch($1)', [silent.json.token]);
    const after2 = await sql(`select expires_at from app.owner_sessions where token_hash = app.hash_token($1)`, [silent.json.token]);
    assert.ok(new Date(after1.rows[0].expires_at).getTime() > new Date(touch.rows[0].expires_at).getTime() - 86400000);
    assert.equal(new Date(after1.rows[0].expires_at).toISOString(), new Date(after2.rows[0].expires_at).toISOString());
  });

  test('пароль, устройства, выход', async () => {
    await makeUser('pass@podacha.test');
    const web = await webLogin('pass@podacha.test', '203.0.113.100');
    const tgLogin = await invoke(tg.login, {
      body: { initData: initData(9400, 0), email: 'pass@podacha.test', password: 'password-ok', consent: true, device_key: dev('tgpass'), device_label: 'iPhone · Telegram' },
      headers: authHeaders('203.0.113.101')
    });
    assert.equal(tgLogin.status, 200);
    const badPw = await invoke(auth.password, {
      body: { current: 'nope', new: 'password-new' },
      headers: Object.assign(authHeaders('203.0.113.100'), { authorization: 'Bearer ' + web.json.token })
    });
    assert.equal(badPw.status, 400);
    const fromTg = await invoke(auth.password, {
      body: { current: 'password-ok', new: 'password-new' },
      headers: Object.assign(authHeaders('203.0.113.101'), { authorization: 'Bearer ' + tgLogin.json.token })
    });
    assert.equal(fromTg.status, 200);
    assert.equal((await sql('select count(*)::int as n from app.tg_links where tg_user_id = 9400')).rows[0].n, 1);
    let webHint = '';
    try { await sql('select app.owner_id($1)', [web.json.token]); } catch (e) { webHint = e.hint; }
    assert.equal(webHint, 'revoked');
    assert.equal((await sql('select app.owner_id($1)::text t', [tgLogin.json.token])).rows[0].t.length > 0, true);

    const web2 = await invoke(auth.login, { body: { email: 'pass@podacha.test', password: 'password-new' }, headers: authHeaders('203.0.113.102') });
    assert.equal(web2.status, 200);
    const fromWeb = await invoke(auth.password, {
      body: { current: 'password-new', new: 'password-web' },
      headers: Object.assign(authHeaders('203.0.113.102'), { authorization: 'Bearer ' + web2.json.token })
    });
    assert.equal(fromWeb.status, 200);
    assert.equal((await sql('select count(*)::int as n from app.tg_links where tg_user_id = 9400')).rows[0].n, 0);
    let tgHint = '';
    try { await sql('select app.owner_id($1)', [tgLogin.json.token]); } catch (e) { tgHint = e.hint; }
    assert.equal(tgHint, 'revoked');
    assert.equal((await sql('select app.owner_id($1)::text t', [web2.json.token])).rows[0].t.length > 0, true);

    const again = await invoke(tg.login, {
      body: { initData: initData(9400, 0), email: 'pass@podacha.test', password: 'password-web', consent: true, device_key: dev('tg2'), device_label: 'Android · Telegram' },
      headers: authHeaders('203.0.113.103')
    });
    const list = await invoke(auth.devices, {
      method: 'GET', url: '/api/auth/devices',
      headers: Object.assign(authHeaders('203.0.113.102'), { authorization: 'Bearer ' + web2.json.token })
    });
    assert.equal(list.status, 200);
    const tgRow = list.json.devices.filter((d) => d.kind === 'tg')[0];
    assert.ok(tgRow);
    const end = await invoke(auth.deviceEnd, {
      query: { id: tgRow.id },
      headers: Object.assign(authHeaders('203.0.113.102'), { authorization: 'Bearer ' + web2.json.token })
    });
    assert.equal(end.status, 200);
    assert.equal((await sql('select count(*)::int as n from app.tg_links where tg_user_id = 9400')).rows[0].n, 0);
    let ended = '';
    try { await sql('select app.owner_id($1)', [again.json.token]); } catch (e) { ended = e.hint; }
    assert.equal(ended, 'revoked');
    assert.equal((await sql('select app.owner_id($1)::text t', [web2.json.token])).rows[0].t.length > 0, true);

    const all = await invoke(auth.logoutAll, {
      headers: Object.assign(authHeaders('203.0.113.102'), { authorization: 'Bearer ' + web2.json.token })
    });
    assert.equal(all.status, 200);
    let out = '';
    try { await sql('select app.owner_id($1)', [web2.json.token]); } catch (e) { out = e.hint; }
    assert.equal(out, 'revoked');
  });

  test('пустой initData на /auth не логируется, старый initData — EXPIRED', async () => {
    const old = initData(9500, 11 * 60);
    const res = await invoke(tg.auth, { body: { initData: old, device_key: dev('old') }, headers: authHeaders('203.0.113.110') });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'EXPIRED');
    assert.equal(JSON.stringify(res.json).includes(old), false);
    const bad = await invoke(tg.auth, { body: { initData: 'hash=abcd', device_key: dev('bad') }, headers: authHeaders('203.0.113.111') });
    assert.equal(bad.json.error, 'BAD_HASH');
  });

  test('в логах нет initData', () => {
    const blob = logs.join('\n');
    for (const sample of seenInit) {
      assert.equal(blob.includes(sample), false);
      assert.equal(blob.includes('photo_url'), false);
    }
  });
});
