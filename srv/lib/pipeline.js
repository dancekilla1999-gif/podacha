// Конвейер агентов Подачи
const { rpc } = require('./sb');
const { tgSend, moscowDay } = require('./common');
const A = require('./agents');

function dbFor(who) {
  return { op: (op, args) => who.token ? rpc('pd_agent', { p_token: who.token, p_op: op, p_args: args || {} })
    : rpc('pd_agent_sys', { p_secret: who.secret, p_owner: who.owner, p_op: op, p_args: args || {} }) };
}
function save(db, r) { return r ? db.op('insight_save', { agent: r.agent, pkey: r.pkey, level: r.level, title: r.title, data: Object.assign({ items: r.items }, r.data), text: r.text }) : null; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function dot(l) { return l === 'bad' ? '🔴' : l === 'warn' ? '🟡' : '🟢'; }

// Каждый день — наставник и меню-контроль (дёшево), по воскресеньям или по запросу — неделя: аналитика, ИИ-гость, план
async function runAll(db, opts = {}) {
  const day = opts.day || moscowDay(-1);
  const weekly = opts.week === true || (opts.week !== false && A.dow(day) === 0);
  const ctx = await db.op('ctx', { days: 7 });
  if (!(ctx.venues || []).length) return { empty: true };
  const mt = A.mentor(ctx, day), mc = A.menuCheck(ctx, day);
  await Promise.all([save(db, mt), save(db, mc)]);
  let week = null;
  if (weekly) {
    const w = A.weekOf(day);
    const co = A.coach(ctx, w.key), gs = A.guestStats(ctx, w.key);
    const ld = await A.lead({ key: w.key, label: `${A.dayRu(w.from)} – ${A.dayRu(w.to)}` }, [co, mc, gs, mt], { noAi: opts.noAi });
    await Promise.all([save(db, co), save(db, gs)]);
    await save(db, ld);
    week = { coach: co, guest: gs, lead: ld };
  }
  let sent = false;
  if (opts.chatId && week) {
    const link = opts.base ? opts.base + '/app/#/o/agents' : null;
    const L = [`<b>Обучение команды · неделя ${esc(week.lead.data.period.label)}</b>`, '', esc(week.coach.title)];
    week.coach.items.slice(0, 6).forEach((i) => L.push(`${dot(i.level)} ${esc(i.text)}`));
    L.push(''); L.push('<b>🎯 Управляющий залом:</b>'); L.push(esc(week.lead.text));
    if (link) { L.push(''); L.push(`<a href="${esc(link)}">Подробнее</a>`); }
    sent = await tgSend(opts.chatId, L.join('\n').slice(0, 4000)).catch(() => false);
  } else if (opts.chatId && mc.items.some((i) => i.level === 'bad')) {
    sent = await tgSend(opts.chatId, '<b>Меню-контроль</b>\n' + mc.items.filter((i) => i.level === 'bad').slice(0, 3).map((i) => '🔴 ' + esc(i.text)).join('\n')).catch(() => false);
  }
  return { mentor: mt, menu: mc, week, sent };
}
module.exports = { dbFor, runAll, save };
