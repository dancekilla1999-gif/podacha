// Сайт: вход, refresh-cookie, устройства, код привязки Telegram, смена пароля.
const db = require('../lib/db');
const { send, readBody } = require('../lib/common');
const web = require('../lib/web');
const { alertText } = require('./tg-http');

function finish(res, status, obj, headers) {
  if (headers) Object.keys(headers).forEach((k) => res.setHeader(k, headers[k]));
  if (status === 401 || status === 429) {
    db.service('pd_auth_signal', { p_status: status, p_secret: web.sessionSecret() }).then((row) => {
      if (row && row.alert) alertText('Подача: ' + (Number(row.n) || 0) + ' ответов 401/429 за 5 мин');
    }).catch(() => {});
  }
  send(res, status, obj);
}

function mapErr(e) {
  const hint = (e && e.hint) || '';
  if (hint === 'disabled') return { status: 401, body: { error: 'Аккаунт отключён', hint: 'disabled' } };
  if (hint === 'invite') return { status: 403, body: { error: 'Регистрация только по приглашению', hint: 'invite' } };
  if (hint === 'invalid') return { status: 400, body: { error: e.message && e.message.length < 120 ? e.message : 'Проверьте данные', hint: 'invalid' } };
  if (hint === 'exists') return { status: 409, body: { error: 'Эта почта уже зарегистрирована — войдите', hint: 'exists' } };
  if (hint === 'rate') return { status: 429, body: { error: 'Слишком много попыток, подождите 60 мин' } };
  if (hint === 'auth' || hint === 'expired' || hint === 'revoked') return { status: 401, body: { hint, error: 'Нужно войти' } };
  if (hint === 'denied' || hint === 'forbidden' || (e && e.code === '42501')) return { status: 403, body: { error: 'forbidden' } };
  if (hint === 'config') return { status: 503, body: { error: 'Вход временно недоступен' } };
  return { status: 500, body: { error: 'Ошибка сервера' } };
}

function needPost(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { error: 'POST only' });
    return false;
  }
  if (!web.originOk(req)) {
    send(res, 403, { error: 'forbidden' });
    return false;
  }
  if (!web.configured()) {
    send(res, 503, { error: 'Вход временно недоступен' });
    return false;
  }
  return true;
}

async function login(req, res) {
  if (!needPost(req, res)) return;
  const body = await readBody(req);
  const access = web.newToken();
  const refresh = web.newToken();
  const label = web.deviceLabelFromUa(req.headers && req.headers['user-agent']);
  try {
    const row = await db.service('pd_web_login', {
      p_email: String(body.email || ''),
      p_password: String(body.password || ''),
      p_access: access,
      p_refresh: refresh,
      p_device_label: label,
      p_ip_hash: web.ipHash(web.clientIp(req)),
      p_secret: web.sessionSecret()
    });
    if (row && row.status === 429) return finish(res, 429, { error: row.error });
    if (row && row.error) return finish(res, 401, { error: row.error });
    return finish(res, 200, { token: access, email: row.email, name: row.name }, { 'Set-Cookie': web.refreshCookie(refresh) });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

async function register(req, res) {
  if (!needPost(req, res)) return;
  const body = await readBody(req);
  const invite = String(body.invite || '').trim();
  if (!invite) return finish(res, 403, { error: 'Регистрация только по приглашению', hint: 'invite' });
  const access = web.newToken();
  const refresh = web.newToken();
  const label = web.deviceLabelFromUa(req.headers && req.headers['user-agent']);
  try {
    const row = await db.service('pd_web_register', {
      p_email: String(body.email || ''),
      p_password: String(body.password || ''),
      p_name: String(body.name || ''),
      p_invite: invite,
      p_access: access,
      p_refresh: refresh,
      p_device_label: label,
      p_ip_hash: web.ipHash(web.clientIp(req)),
      p_secret: web.sessionSecret()
    });
    return finish(res, 200, { token: access, email: row.email, name: row.name }, { 'Set-Cookie': web.refreshCookie(refresh) });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

async function refresh(req, res) {
  if (!needPost(req, res)) return;
  const old = web.readCookie(req, 'pd_rt');
  if (!old) return finish(res, 401, { hint: 'auth', error: 'Нужно войти' });
  const access = web.newToken();
  const next = web.newToken();
  const key = web.graceKey();
  let cipher = '';
  try { cipher = web.encryptJson({ access, refresh: next }, key); }
  catch (e) { return finish(res, 503, { error: 'Вход временно недоступен' }); }
  try {
    const row = await db.service('pd_web_refresh', {
      p_refresh: old, p_new_access: access, p_new_refresh: next, p_grace_cipher: cipher, p_secret: web.sessionSecret()
    });
    if (row && row.reuse) {
      const same = web.decryptJson(row.grace_cipher, key);
      return finish(res, 200, { token: same.access }, { 'Set-Cookie': web.refreshCookie(same.refresh) });
    }
    if (row && row.theft) {
      alertText('Подача: refresh_reuse').catch(() => {});
      return finish(res, 401, { hint: 'revoked', error: 'Сессия завершена' }, { 'Set-Cookie': web.clearCookie() });
    }
    if (row && row.ok) {
      return finish(res, 200, { token: access }, { 'Set-Cookie': web.refreshCookie(next) });
    }
    const hint = (row && row.hint) || 'auth';
    return finish(res, 401, { hint, error: hint === 'disabled' ? 'Аккаунт отключён' : 'Нужно войти' }, { 'Set-Cookie': web.clearCookie() });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

async function migrate(req, res) {
  if (!needPost(req, res)) return;
  const body = await readBody(req);
  const legacy = String(body.token || '');
  if (legacy.length < 20) return finish(res, 401, { hint: 'auth', error: 'Нужно войти' });
  const access = web.newToken();
  const next = web.newToken();
  const key = web.graceKey();
  const cipher = web.encryptJson({ access, refresh: next }, key);
  const label = web.deviceLabelFromUa(req.headers && req.headers['user-agent']);
  try {
    const row = await db.service('pd_web_migrate', {
      p_token: legacy, p_access: access, p_refresh: next, p_grace_cipher: cipher,
      p_device_label: label, p_ip_hash: web.ipHash(web.clientIp(req)), p_secret: web.sessionSecret()
    });
    if (row && row.reuse) {
      const same = web.decryptJson(row.grace_cipher, key);
      return finish(res, 200, { token: same.access }, { 'Set-Cookie': web.refreshCookie(same.refresh) });
    }
    if (row && row.ok) {
      return finish(res, 200, { token: access, email: row.email }, { 'Set-Cookie': web.refreshCookie(next) });
    }
    return finish(res, 401, { hint: (row && row.hint) || 'auth', error: 'Нужно войти' });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

async function logout(req, res) {
  if (!needPost(req, res)) return;
  const token = web.bearer(req);
  if (!token) return finish(res, 401, { hint: 'auth', error: 'Нужно войти' }, { 'Set-Cookie': web.clearCookie() });
  try {
    await db.service('pd_web_logout', { p_token: token, p_all: false, p_secret: web.sessionSecret() });
    return finish(res, 200, { ok: true }, { 'Set-Cookie': web.clearCookie() });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body, { 'Set-Cookie': web.clearCookie() });
  }
}

async function logoutAll(req, res) {
  if (!needPost(req, res)) return;
  const token = web.bearer(req);
  if (!token) return finish(res, 401, { hint: 'auth', error: 'Нужно войти' });
  try {
    await db.service('pd_web_logout', { p_token: token, p_all: true, p_secret: web.sessionSecret() });
    return finish(res, 200, { ok: true }, { 'Set-Cookie': web.clearCookie() });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

async function password(req, res) {
  if (!needPost(req, res)) return;
  const token = web.bearer(req);
  const body = await readBody(req);
  if (!token) return finish(res, 401, { hint: 'auth', error: 'Нужно войти' });
  try {
    const row = await db.service('pd_owner_password', {
      p_token: token, p_old: String(body.current || ''), p_new: String(body.new || '')
    });
    return finish(res, 200, row || { ok: true });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

async function devices(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'GET only' });
  if (req.headers && req.headers.origin && !web.originOk(req)) return send(res, 403, { error: 'forbidden' });
  if (!web.configured()) return send(res, 503, { error: 'Вход временно недоступен' });
  const token = web.bearer(req);
  if (!token) return finish(res, 401, { hint: 'auth', error: 'Нужно войти' });
  try {
    const row = await db.service('pd_devices', { p_token: token, p_secret: web.sessionSecret() });
    return finish(res, 200, row);
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

async function deviceEnd(req, res) {
  if (!needPost(req, res)) return;
  const token = web.bearer(req);
  const id = (req.query && req.query.id) || (req.params && req.params.id) || '';
  if (!token) return finish(res, 401, { hint: 'auth', error: 'Нужно войти' });
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return finish(res, 400, { error: 'Устройство не найдено' });
  try {
    const row = await db.service('pd_device_end', { p_token: token, p_id: String(id), p_secret: web.sessionSecret() });
    if (row && row.error) return finish(res, 404, { error: row.error });
    return finish(res, 200, row || { ok: true });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

async function linkCode(req, res) {
  if (!needPost(req, res)) return;
  const token = web.bearer(req);
  if (!token) return finish(res, 401, { hint: 'auth', error: 'Нужно войти' });
  const bot = process.env.TG_BOT_USERNAME || '';
  if (!bot) return finish(res, 503, { error: 'Бот ещё не настроен' });
  try {
    const row = await db.service('pd_link_code_issue', { p_token: token, p_secret: web.sessionSecret() });
    if (row && row.status === 429) return finish(res, 429, { error: row.error });
    if (!row || !row.code) return finish(res, 500, { error: 'Ошибка сервера' });
    const url = 'https://t.me/' + bot + '/app?startapp=l_' + row.code;
    return finish(res, 200, { code: row.code, url, expires_at: row.expires_at });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

async function linkStatus(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'GET only' });
  if (req.headers && req.headers.origin && !web.originOk(req)) return send(res, 403, { error: 'forbidden' });
  if (!web.configured()) return send(res, 503, { error: 'Вход временно недоступен' });
  const token = web.bearer(req);
  if (!token) return finish(res, 401, { hint: 'auth', error: 'Нужно войти' });
  const url = new URL(req.url || '/', 'http://local');
  const code = (req.query && req.query.code) || url.searchParams.get('code') || '';
  try {
    const row = await db.service('pd_link_status', { p_token: token, p_code: String(code).replace(/^l_/, ''), p_secret: web.sessionSecret() });
    return finish(res, 200, row);
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

async function linkDispute(req, res) {
  if (!needPost(req, res)) return;
  const token = web.bearer(req);
  if (!token) return finish(res, 401, { hint: 'auth', error: 'Нужно войти' });
  try {
    const row = await db.service('pd_tg_unbind', { p_token: token, p_reason: 'tg_unlink_disputed', p_secret: web.sessionSecret() });
    return finish(res, 200, row || { ok: true });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

module.exports = {
  login, register, refresh, migrate, logout, logoutAll, password, devices, deviceEnd, linkCode, linkStatus, linkDispute
};
