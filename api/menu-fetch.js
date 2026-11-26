// Тот же origin: кабинет не ходит на чужие сайты (connect-src 'self').
// Разрешена только известная ссылка демо-меню.
const { send } = require('../srv/lib/common');

const ALLOW = new Set(['https://sd.msk.ru/restaurant.json']);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
  const fromQuery = req.query && req.query.url;
  let fromUrl = '';
  try { fromUrl = new URL(req.url || '/', 'http://local').searchParams.get('url') || ''; } catch (e) { fromUrl = ''; }
  const target = String(fromQuery || fromUrl || '');
  if (!ALLOW.has(target)) return send(res, 400, { error: 'Эту ссылку загрузить нельзя' });
  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return send(res, 502, { error: 'Меню не открылось' });
    const data = await r.json();
    return send(res, 200, data);
  } catch (e) {
    return send(res, 502, { error: 'Меню не открылось' });
  }
};

module.exports.ALLOW = ALLOW;
