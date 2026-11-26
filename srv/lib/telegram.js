// Проверка initData по документации Telegram «Validating data received via the Mini App».
// secret_key = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)
// data_check_string — все поля, кроме hash, по алфавиту, через \n. Поле signature НЕ выкидывается.
const crypto = require('node:crypto');

function dataCheckString(map, opts) {
  const skipSig = !!(opts && opts.excludeSignature);
  return Object.keys(map)
    .filter((k) => k !== 'hash' && !(skipSig && k === 'signature'))
    .sort()
    .map((k) => k + '=' + map[k])
    .join('\n');
}

function parseInitData(initData) {
  const out = {};
  const sp = new URLSearchParams(String(initData || ''));
  for (const [k, v] of sp.entries()) out[k] = v;
  return out;
}

function signHex(botToken, check) {
  const secret = crypto.createHmac('sha256', 'WebAppData').update(String(botToken)).digest();
  return crypto.createHmac('sha256', secret).update(String(check)).digest('hex');
}

function signInitData(fields, botToken) {
  const map = Object.assign({}, fields || {});
  delete map.hash;
  const hash = signHex(botToken, dataCheckString(map));
  const sp = new URLSearchParams();
  Object.keys(map).sort().forEach((k) => sp.append(k, map[k] == null ? '' : String(map[k])));
  sp.append('hash', hash);
  return sp.toString();
}

function safeEqualHex(a, b) {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function validateInitData(initData, botToken, opts) {
  opts = opts || {};
  const maxAge = opts.maxAgeSec != null ? opts.maxAgeSec : 600;
  const nowMs = opts.now != null ? opts.now : Date.now();
  try {
    const map = parseInitData(initData);
    const hash = String(map.hash || '');
    if (!/^[0-9a-f]{64}$/.test(hash) || !botToken) return { ok: false, error: 'BAD_HASH' };
    const expected = signHex(botToken, dataCheckString(map, { excludeSignature: !!opts.excludeSignature }));
    if (!safeEqualHex(hash, expected)) return { ok: false, error: 'BAD_HASH' };
    const authDate = Number(map.auth_date);
    if (!Number.isFinite(authDate)) return { ok: false, error: 'BAD_HASH' };
    const nowSec = Math.floor(Number(nowMs) / 1000);
    if (authDate - nowSec > 60) return { ok: false, error: 'EXPIRED' };
    if (nowSec - authDate > maxAge) return { ok: false, error: 'EXPIRED' };
    let raw = {};
    try { raw = JSON.parse(map.user || '{}'); } catch (e) { return { ok: false, error: 'BAD_HASH' }; }
    if (raw == null || raw.id == null || raw.id === '') return { ok: false, error: 'BAD_HASH' };
    return {
      ok: true,
      hash,
      authDate,
      user: {
        id: String(raw.id),
        first_name: raw.first_name ? String(raw.first_name).slice(0, 80) : '',
        username: raw.username ? String(raw.username).slice(0, 64) : '',
        language_code: raw.language_code ? String(raw.language_code).slice(0, 16) : ''
      }
    };
  } catch (e) {
    return { ok: false, error: 'BAD_HASH' };
  }
}

module.exports = { dataCheckString, parseInitData, signInitData, validateInitData };
