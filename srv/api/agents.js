// Агенты Подачи в кабинете: проверить сейчас, вопрос управляющему залом, привязка Telegram
const { rpc } = require('../lib/sb');
const { dbFor, runAll } = require('../lib/pipeline');
const A = require('../lib/agents');
const ai = require('../lib/ai');
const { moscowDay, send, readBody } = require('../lib/common');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Только POST' });
  const b = await readBody(req);
  const token = String(b.token || '');
  try {
    const db = dbFor({ token });
    await db.op('home', {});
    switch (b.action) {
      case 'status': return send(res, 200, { ai: ai.enabled(), tg: !!process.env.TG_BOT_TOKEN, agents: A.AGENTS });
      case 'run': {
        const r = await runAll(db, { day: moscowDay(-1), week: true });
        return send(res, 200, { ok: true, empty: !!r.empty });
      }
      case 'ask': {
        const q = String(b.question || '').trim();
        if (q.length < 2) throw new Error('Задайте вопрос');
        if (q.length > 1500) throw new Error('Слишком длинный вопрос — до 1500 знаков');
        const ctx = await db.op('ctx', { days: 14 });
        await db.op('chat_add', { role: 'user', text: q });
        const ans = await A.answer(q, ctx);
        if (process.env.CRON_SECRET) {
          const o = await rpc('pd_agent_sys', { p_secret: process.env.CRON_SECRET, p_owner: null, p_op: 'owner_of_token', p_args: { token } });
          await rpc('pd_agent_sys', { p_secret: process.env.CRON_SECRET, p_owner: o.owner_id, p_op: 'chat_add', p_args: { role: 'assistant', text: ans.text } });
        }
        return send(res, 200, { ok: true, text: ans.text, by_ai: ans.by_ai });
      }
      case 'tg_link': {
        const tok = process.env.TG_BOT_TOKEN;
        if (!tok) return send(res, 200, { enabled: false });
        const me = await fetch(`https://api.telegram.org/bot${tok}/getMe`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => null);
        if (!me || !me.ok) return send(res, 200, { enabled: false });
        const c = await db.op('tg_code', {});
        return send(res, 200, { enabled: true, bot: me.result.username, url: `https://t.me/${me.result.username}?start=${c.code}` });
      }
      case 'tg_unbind': await db.op('tg_unbind', {}); return send(res, 200, { ok: true });
      default: return send(res, 400, { error: 'Неизвестное действие' });
    }
  } catch (e) {
    return send(res, e.hint === 'auth' ? 401 : 400, { error: e.message || 'Ошибка', hint: e.hint || null });
  }
};
