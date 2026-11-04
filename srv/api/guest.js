// ИИ-гость для сотрудника: следующая реплика гостя и итоговая оценка диалога. Без ИИ-ключа приложение использует сценарный режим.
const { rpc } = require('../lib/sb');
const A = require('../lib/agents');
const ai = require('../lib/ai');
const { send, readBody } = require('../lib/common');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Только POST' });
  const b = await readBody(req);
  try {
    if (b.action === 'status') return send(res, 200, { ai: ai.enabled() });
    if (!ai.enabled()) return send(res, 200, { ai: false });
    const st = await rpc('pd_staff_agent', { p_token: String(b.token || ''), p_op: 'guest_start', p_args: {} });
    if (!st.items.length) throw new Error('Меню ещё не проверено управляющим — гостю не о чем спрашивать');
    const turns = (Array.isArray(b.turns) ? b.turns : []).slice(-16).map((t) => ({ who: t.who === 'guest' ? 'guest' : 'staff', text: String(t.text || '').slice(0, 800) }));
    if (b.action === 'reply') {
      if (!turns.length && st.ai_used >= st.ai_limit) return send(res, 200, { ai: false, limit: true });
      return send(res, 200, { ai: true, text: await A.guestReply(st.venue, st.items, st.staff, turns) });
    }
    if (b.action === 'judge') {
      const r = await A.guestJudge(st.venue, st.items, turns);
      await rpc('pd_staff_agent', { p_token: String(b.token || ''), p_op: 'guest_save', p_args: { mode: 'ai', score: r.score, summary: [r.good, r.fix].filter(Boolean).join(' Исправить: '), turns } });
      return send(res, 200, Object.assign({ ai: true }, r));
    }
    return send(res, 400, { error: 'Неизвестное действие' });
  } catch (e) {
    return send(res, e.hint === 'auth' ? 401 : 400, { error: e.message || 'Ошибка', hint: e.hint || null });
  }
};
