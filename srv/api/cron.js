// Ежедневно в 06:20 по Москве: наставник и меню-контроль, по понедельникам — неделя обучения и план. Заодно будит базу (бесплатный Supabase).
const { rpc } = require('../lib/sb');
const { dbFor, runAll } = require('../lib/pipeline');
const { moscowDay, publicUrl, hookSecret, send, same } = require('../lib/common');

module.exports = async function handler(req, res) {
  await rpc('pd_ping', {}).catch(() => {});
  const secret = process.env.CRON_SECRET || '';
  if (!secret || !same(req.headers.authorization, `Bearer ${secret}`)) return send(res, 401, { error: 'unauthorized' });
  const base = publicUrl(req);
  // Вебхук и кнопка меню ставятся только вручную (scripts/tg-setup.js). По умолчанию cron бота не трогает.
  if (process.env.TG_SETUP === '1' && process.env.TG_BOT_TOKEN) {
    await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/setWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${base}/api/tg`, secret_token: hookSecret(), allowed_updates: ['message'] }), signal: AbortSignal.timeout(10000) }).catch(() => {});
  }
  try {
    const db = require('../lib/db');
    if (db.databaseUrl() || process.env.SB_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) {
      await db.service('pd_auth_cleanup', { p_secret: process.env.TG_SESSION_SECRET || '' });
    }
  } catch (e) { /* чистка не должна останавливать отчёты */ }
  const day = (req.query && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '')) ? req.query.day : moscowDay(-1);
  const jobs = await rpc('pd_agent_sys', { p_secret: secret, p_owner: null, p_op: 'jobs', p_args: {} });
  const queue = jobs.slice(); let ok = 0;
  async function worker() {
    while (queue.length) {
      const j = queue.shift();
      try { await runAll(dbFor({ secret, owner: j.owner_id }), { day, chatId: j.chat_id, base }); ok++; } catch (e) { console.error('pd cron', j.owner_id, e.message); }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return send(res, 200, { day, total: jobs.length, ok });
};
