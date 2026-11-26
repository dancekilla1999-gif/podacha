const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/podacha';
process.env.TG_SESSION_SECRET = process.env.TG_SESSION_SECRET || 'test-session-secret-value';
process.env.IP_SALT = process.env.IP_SALT || 'test-ip-salt-value';
process.env.REFRESH_GRACE_KEY = process.env.REFRESH_GRACE_KEY || Buffer.alloc(32, 4).toString('base64');
process.env.TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || 'test-bot-token-not-a-telegram-token';
process.env.TG_BOT_USERNAME = process.env.TG_BOT_USERNAME || 'trio_podacha_bot';

const root = path.join(__dirname, '..');

async function sql(text, params) {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  try { return await c.query(text, params); }
  finally { await c.end(); }
}

async function reset() {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  try {
    await c.query('drop schema if exists app cascade');
    await c.query('drop schema if exists bill cascade');
    await c.query('drop schema if exists extensions cascade');
    await c.query(`
      do $do$ declare r record; begin
        for r in select p.oid::regprocedure as s from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'pd_%' loop
          execute 'drop function if exists ' || r.s || ' cascade';
        end loop;
      end $do$`);
    await c.query(fs.readFileSync(path.join(root, 'sql/schema_current.sql'), 'utf8'));
    await c.query(fs.readFileSync(path.join(root, 'sql/20261126_tg_auth.sql'), 'utf8'));
    await c.query(
      `insert into app.server_secrets(key, value) values ('tg_session_secret', $1)
       on conflict (key) do update set value = excluded.value`,
      [process.env.TG_SESSION_SECRET]
    );
  } finally {
    await c.end();
  }
}

function invoke(handler, opts) {
  opts = opts || {};
  const headers = Object.assign({
    host: 'podacha.test',
    origin: 'https://podacha.test',
    'user-agent': 'Mozilla/5.0 Chrome/120.0 Windows',
    'x-real-ip': '203.0.113.10'
  }, opts.headers || {});
  return new Promise((resolve, reject) => {
    const req = {
      method: opts.method || 'POST',
      url: opts.url || '/',
      headers,
      body: opts.body === undefined ? {} : opts.body,
      query: opts.query || {}
    };
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
      end(s) {
        let json = null;
        try { json = s ? JSON.parse(s) : null; } catch (e) { json = { raw: s }; }
        resolve({ status: this.statusCode, headers: this.headers, json });
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function cookie(res) {
  const c = String(res.headers['set-cookie'] || '');
  const m = c.match(/pd_rt=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : '';
}

module.exports = { sql, reset, invoke, cookie, root };
