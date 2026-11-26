// Вызов функций Postgres: локально и в CI — TEST_DATABASE_URL / DATABASE_URL,
// на сервере — Supabase RPC с сервисным ключом (не с публичным).
const { Pool } = require('pg');

let pool = null;

function databaseUrl() {
  return process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';
}

function poolOf() {
  const url = databaseUrl();
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url, max: 30 });
  return pool;
}

function serviceKey() {
  return process.env.SB_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function assertName(fn) {
  if (!/^[a-z][a-z0-9_]*$/.test(fn)) {
    const e = new Error('bad function');
    e.hint = 'invalid';
    throw e;
  }
}

function wrapPg(e) {
  if (!e || e.hint) return e;
  if (e.code === '42501') e.hint = 'denied';
  return e;
}

async function pgCall(fn, args, role) {
  assertName(fn);
  const keys = Object.keys(args || {});
  keys.forEach((k) => {
    if (!/^p_[a-z0-9_]+$/.test(k)) {
      const e = new Error('bad arg');
      e.hint = 'invalid';
      throw e;
    }
  });
  const client = await poolOf().connect();
  try {
    await client.query('begin');
    if (role) {
      if (!['service_role', 'anon', 'authenticated'].includes(role)) {
        const e = new Error('bad role');
        e.hint = 'invalid';
        throw e;
      }
      await client.query('set local role ' + role);
    }
    const assigns = keys.map((k, i) => k + ' => $' + (i + 1)).join(', ');
    const sql = 'select public.' + fn + '(' + assigns + ') as result';
    const vals = keys.map((k) => args[k] === undefined ? null : args[k]);
    const r = await client.query(sql, vals);
    await client.query('commit');
    return r.rows[0] ? r.rows[0].result : null;
  } catch (e) {
    try { await client.query('rollback'); } catch (ignore) { /* уже оборвано */ }
    throw wrapPg(e);
  } finally {
    client.release();
  }
}

async function httpCall(fn, args, role) {
  assertName(fn);
  const base = (process.env.SB_URL || 'https://qozyihhlocvgpkchyqsp.supabase.co').replace(/\/+$/, '');
  const key = role === 'anon' ? (process.env.SB_KEY || '') : serviceKey();
  if (!key) {
    const e = new Error('База не настроена');
    e.hint = 'config';
    e.status = 503;
    throw e;
  }
  const r = await fetch(base + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
    signal: AbortSignal.timeout(20000)
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
  if (!r.ok) {
    const e = new Error((data && data.message) || 'База ответила ошибкой');
    e.hint = data && data.hint;
    e.status = r.status;
    e.code = data && data.code;
    if (e.code === '42501' || /permission denied/i.test(e.message)) e.hint = e.hint || 'denied';
    throw e;
  }
  return data;
}

async function call(fn, args, role) {
  if (databaseUrl()) return pgCall(fn, args, role || null);
  return httpCall(fn, args, role || 'service_role');
}

function service(fn, args) {
  return call(fn, args, 'service_role');
}

async function close() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

module.exports = { call, service, close, databaseUrl, serviceKey };
