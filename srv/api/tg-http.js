// POST /api/tg/auth | /link | /login | /unbind
const db = require('../lib/db');
const tg = require('../lib/telegram');
const { send, readBody } = require('../lib/common');
const web = require('../lib/web');

const CONSENT_VERSION = '2026-11-26';

function tooBig(body) {
  try { return JSON.stringify(body || {}).length > 20000; } catch (e) { return true; }
}

async function note(status) {
  if (status !== 401 && status !== 429) return;
  if (!web.sessionSecret()) return;
  try {
    const row = await db.service('pd_auth_signal', { p_status: status, p_secret: web.sessionSecret() });
    if (row && row.alert) {
      const n = Number(row.n) || 0;
      await alertText('Подача: ' + n + ' ответов 401/429 за 5 мин');
    }
  } catch (e) { /* сигнал не должен ломать ответ */ }
}

async function alertText(text) {
  const tok = process.env.TG_BOT_TOKEN;
  const chat = process.env.ALERT_CHAT_ID;
  if (!tok || !chat) return;
  await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: String(text).slice(0, 200) }),
    signal: AbortSignal.timeout(8000)
  }).catch(() => {});
}

function finish(res, status, obj, headers) {
  if (headers) Object.keys(headers).forEach((k) => res.setHeader(k, headers[k]));
  note(status);
  send(res, status, obj);
}

function mapErr(e) {
  const hint = (e && e.hint) || '';
  if (hint === 'replay') return { status: 401, body: { error: 'REPLAY' } };
  if (hint === 'disabled') return { status: 401, body: { error: 'Аккаунт отключён', hint: 'disabled' } };
  if (hint === 'consent') return { status: 400, body: { error: 'Нужно согласие', hint: 'consent' } };
  if (hint === 'conflict') return { status: 409, body: { error: (e && e.message) || 'Этот Telegram уже привязан к другому аккаунту. Сначала отвяжите его там', hint: 'conflict' } };
  if (hint === 'invalid') return { status: 400, body: { error: 'Проверьте данные', hint: 'invalid' } };
  if (hint === 'denied' || hint === 'forbidden' || (e && e.code === '42501')) return { status: 403, body: { error: 'forbidden' } };
  if (hint === 'config') return { status: 503, body: { error: 'Вход временно недоступен' } };
  if (e && e.message === 'REPLAY') return { status: 401, body: { error: 'REPLAY' } };
  return { status: 500, body: { error: 'Ошибка сервера' } };
}

function resultOf(row) {
  if (!row) return { status: 500, body: { error: 'Ошибка сервера' } };
  if (row.status === 429) return { status: 429, body: { error: row.error, retry_min: row.retry_min } };
  if (row.hint === 'consent') return { status: 400, body: { error: 'Нужно согласие', hint: 'consent' } };
  if (row.error) return { status: 401, body: { error: row.error } };
  return { status: 200, body: row };
}

async function guardPost(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, { error: 'POST only' });
    return null;
  }
  if (!web.configured() || !process.env.TG_BOT_TOKEN) {
    send(res, 503, { error: 'Вход временно недоступен' });
    return null;
  }
  const body = await readBody(req);
  if (tooBig(body)) {
    send(res, 400, { error: 'BAD_HASH' });
    return null;
  }
  return body;
}

async function auth(req, res) {
  const body = await guardPost(req, res);
  if (!body) return;
  const ipH = web.ipHash(web.clientIp(req));
  try {
    const lim = await db.service('pd_rate_bump', {
      p_bucket: 'tg_auth_ip', p_subject: ipH || 'none', p_limit: 60, p_window_sec: 60, p_secret: web.sessionSecret()
    });
    if (lim && lim.limited) return finish(res, 429, { error: 'Слишком много попыток, подождите ' + lim.retry_min + ' мин' });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
  const v = tg.validateInitData(body.initData, process.env.TG_BOT_TOKEN, { maxAgeSec: 600 });
  if (!v.ok) {
    web.logTg(v.error === 'EXPIRED' ? 'EXPIRED' : 'BAD_HASH', null);
    return finish(res, 401, { error: v.error === 'EXPIRED' ? 'EXPIRED' : 'BAD_HASH' });
  }
  const dev = web.cleanDeviceKey(body.device_key);
  if (!dev) return finish(res, 400, { error: 'Нет устройства' });
  web.logTg('ok', v.user.id);
  try {
    const row = await db.service('pd_tg_session', {
      p_tg_user_id: v.user.id,
      p_first_name: v.user.first_name,
      p_username: v.user.username,
      p_device_key: dev,
      p_device_label: web.cleanLabel(body.device_label) || 'Telegram',
      p_ip_hash: ipH,
      p_secret: web.sessionSecret()
    });
    const out = resultOf(row);
    return finish(res, out.status, out.body);
  } catch (e) {
    const m = mapErr(e);
    web.logTg(m.body.error || m.body.hint || 'ERR', v.user.id);
    return finish(res, m.status, m.body);
  }
}

async function link(req, res) {
  const body = await guardPost(req, res);
  if (!body) return;
  if (body.consent !== true) return finish(res, 400, { error: 'Нужно согласие', hint: 'consent' });
  const v = tg.validateInitData(body.initData, process.env.TG_BOT_TOKEN, { maxAgeSec: 3600 });
  if (!v.ok) {
    web.logTg(v.error === 'EXPIRED' ? 'EXPIRED' : 'BAD_HASH', null);
    return finish(res, 401, { error: v.error === 'EXPIRED' ? 'EXPIRED' : 'BAD_HASH' });
  }
  const dev = web.cleanDeviceKey(body.device_key);
  if (!dev) return finish(res, 400, { error: 'Нет устройства' });
  const code = String(body.code || '').replace(/^l_/, '');
  web.logTg('link', v.user.id);
  try {
    const row = await db.service('pd_tg_link', {
      p_tg_user_id: v.user.id,
      p_first_name: v.user.first_name,
      p_username: v.user.username,
      p_device_key: dev,
      p_device_label: web.cleanLabel(body.device_label) || 'Telegram',
      p_ip_hash: web.ipHash(web.clientIp(req)),
      p_code: code,
      p_init_hash: web.sha256(String(body.initData || '')),
      p_consent: true,
      p_consent_version: CONSENT_VERSION,
      p_secret: web.sessionSecret()
    });
    const out = resultOf(row);
    return finish(res, out.status, out.body);
  } catch (e) {
    const m = mapErr(e);
    web.logTg(m.body.error || 'ERR', v.user.id);
    return finish(res, m.status, m.body);
  }
}

async function login(req, res) {
  const body = await guardPost(req, res);
  if (!body) return;
  if (body.consent !== true) return finish(res, 400, { error: 'Нужно согласие', hint: 'consent' });
  const v = tg.validateInitData(body.initData, process.env.TG_BOT_TOKEN, { maxAgeSec: 3600 });
  if (!v.ok) {
    web.logTg(v.error === 'EXPIRED' ? 'EXPIRED' : 'BAD_HASH', null);
    return finish(res, 401, { error: v.error === 'EXPIRED' ? 'EXPIRED' : 'BAD_HASH' });
  }
  const dev = web.cleanDeviceKey(body.device_key);
  if (!dev) return finish(res, 400, { error: 'Нет устройства' });
  web.logTg('login', v.user.id);
  try {
    const row = await db.service('pd_tg_login', {
      p_tg_user_id: v.user.id,
      p_first_name: v.user.first_name,
      p_username: v.user.username,
      p_device_key: dev,
      p_device_label: web.cleanLabel(body.device_label) || 'Telegram',
      p_ip_hash: web.ipHash(web.clientIp(req)),
      p_email: String(body.email || ''),
      p_password: String(body.password || ''),
      p_init_hash: web.sha256(String(body.initData || '')),
      p_consent: true,
      p_consent_version: CONSENT_VERSION,
      p_secret: web.sessionSecret()
    });
    const out = resultOf(row);
    return finish(res, out.status, out.body);
  } catch (e) {
    const m = mapErr(e);
    web.logTg(m.body.error || 'ERR', v.user.id);
    return finish(res, m.status, m.body);
  }
}

async function unbind(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!web.configured()) return send(res, 503, { error: 'Вход временно недоступен' });
  const token = web.bearer(req);
  if (!token) return finish(res, 401, { hint: 'auth', error: 'Нужно войти' });
  try {
    const row = await db.service('pd_tg_unbind', { p_token: token, p_reason: 'unbind', p_secret: web.sessionSecret() });
    return finish(res, 200, row || { ok: true });
  } catch (e) {
    const m = mapErr(e);
    return finish(res, m.status, m.body);
  }
}

module.exports = { auth, link, login, unbind, CONSENT_VERSION, alertText };
