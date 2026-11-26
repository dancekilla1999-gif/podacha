const crypto = require('node:crypto');

function safeEqual(a, b) {
  const x = Buffer.from(String(a == null ? '' : a));
  const y = Buffer.from(String(b == null ? '' : b));
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

function sessionSecret() {
  return process.env.TG_SESSION_SECRET || '';
}

function configured() {
  return sessionSecret().length >= 16 && !!graceKey();
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function graceKey() {
  const raw = process.env.REFRESH_GRACE_KEY || '';
  if (!raw) return null;
  let buf = null;
  if (/^[0-9a-f]{64}$/i.test(raw)) buf = Buffer.from(raw, 'hex');
  else {
    try { buf = Buffer.from(raw, 'base64'); } catch (e) { buf = null; }
  }
  if (!buf || buf.length !== 32) return null;
  return buf;
}

function encryptJson(obj, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptJson(payload, key) {
  const buf = Buffer.from(String(payload || ''), 'base64');
  if (buf.length < 12 + 16 + 2) {
    const e = new Error('cipher');
    e.hint = 'auth';
    throw e;
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  return JSON.parse(plain);
}

function clientIp(req) {
  const raw = req && req.headers ? req.headers['x-real-ip'] : '';
  if (!raw) return '';
  return String(Array.isArray(raw) ? raw[0] : raw).split(',')[0].trim().slice(0, 80);
}

function ipHash(ip) {
  const salt = process.env.IP_SALT || '';
  if (!salt || !ip) return '';
  return crypto.createHmac('sha256', salt).update(String(ip)).digest('hex');
}

function requestHost(req) {
  const raw = (req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  return String(Array.isArray(raw) ? raw[0] : raw).split(',')[0].trim();
}

function originOk(req) {
  const origin = String((req.headers && req.headers.origin) || '');
  const host = requestHost(req);
  if (!origin || !host) return false;
  let url;
  try { url = new URL(origin); } catch (e) { return false; }
  return url.host === host;
}

function readCookie(req, name) {
  const h = String((req.headers && req.headers.cookie) || '');
  const parts = h.split(/; */);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const eq = p.indexOf('=');
    if (eq > 0 && p.slice(0, eq) === name) {
      try { return decodeURIComponent(p.slice(eq + 1)); } catch (e) { return ''; }
    }
  }
  return '';
}

function refreshCookie(token) {
  return 'pd_rt=' + encodeURIComponent(token) + '; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=31536000';
}

function clearCookie() {
  return 'pd_rt=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0';
}

function bearer(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  const m = h.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : '';
}

function cleanLabel(s) {
  return String(s || '').replace(/[\u0000-\u001f]/g, '').slice(0, 80);
}

function deviceLabelFromUa(ua) {
  ua = String(ua || '');
  let os = 'Устройство';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad/i.test(ua)) os = 'iPhone';
  else if (/Mac OS/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let browser = 'Браузер';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';
  return (browser + ' · ' + os).slice(0, 80);
}

function cleanDeviceKey(s) {
  s = String(s || '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : '';
}

function logTg(code, tgUserId) {
  if (tgUserId) console.info('tg', code, String(tgUserId));
  else console.info('tg', code);
}

module.exports = {
  safeEqual, sessionSecret, configured, newToken, sha256, graceKey, encryptJson, decryptJson,
  clientIp, ipHash, originOk, readCookie, refreshCookie, clearCookie, bearer, cleanLabel,
  deviceLabelFromUa, cleanDeviceKey, logTg, requestHost
};
