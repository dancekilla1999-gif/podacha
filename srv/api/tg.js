// Вебхук Telegram-бота Подачи: привязка чата (/start КОД), команды и вопросы управляющему залом
const crypto = require('node:crypto');
const { rpc } = require('../lib/sb');
const { hookSecret, send, readBody, publicUrl, tgSend } = require('../lib/common');
const { dbFor } = require('../lib/pipeline');
const A = require('../lib/agents');

const HELP = 'Я — управляющий залом «Подачи». По понедельникам присылаю, как команда тренировалась, кто отстаёт и что подтянуть в меню.\n\n' +
  'Спрашивайте: «кто не тренировался?», «какие блюда путают?», «готов ли новичок к смене?»\n\nКоманды: /team — обучение, /plan — план на неделю, /menu — проверка меню, /guest — ИИ-гость.';
const CMD = { '/team': 'coach', '/plan': 'lead', '/menu': 'menu_check', '/guest': 'guest', '/mentor': 'mentor' };
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const got = String(req.headers['x-telegram-bot-api-secret-token'] || ''), want = hookSecret();
  if (!process.env.CRON_SECRET || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return send(res, 401, { error: 'unauthorized' });
  const m = (await readBody(req)).message;
  if (!m || !m.chat) return send(res, 200, { ok: true });
  const text = String(m.text || '').trim(), secret = process.env.CRON_SECRET;
  const code = (text.match(/^\/start\s+([a-f0-9]{18})$/i) || [])[1];
  if (code) {
    const r = await rpc('pd_agent_sys', { p_secret: secret, p_owner: null, p_op: 'tg_bind', p_args: { code: code.toLowerCase(), chat: m.chat.id, title: m.chat.title || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') } }).catch(() => ({ ok: false }));
    await tgSend(m.chat.id, r.ok ? '✅ Готово! Чат подключён к «Подаче».\n\n' + HELP : 'Код не подошёл или устарел. Нажмите «Подключить Telegram» в кабинете ещё раз.');
    return send(res, 200, { ok: true });
  }
  if (!text) return send(res, 200, { ok: true });
  const o = await rpc('pd_agent_sys', { p_secret: secret, p_owner: null, p_op: 'tg_owner', p_args: { chat: m.chat.id } }).catch(() => ({}));
  if (!o.owner_id) { await tgSend(m.chat.id, 'Это бот «Подачи». Чтобы подключить чат, нажмите «Подключить Telegram» в разделе «Агенты» кабинета.'); return send(res, 200, { ok: true }); }
  const isGroup = m.chat.type === 'group' || m.chat.type === 'supergroup';
  if (isGroup && !text.startsWith('/') && !(m.reply_to_message && m.reply_to_message.from && m.reply_to_message.from.is_bot) && !/@\w*bot\b/i.test(text)) return send(res, 200, { ok: true });
  const db = dbFor({ secret, owner: o.owner_id });
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  try {
    if (cmd === '/help' || cmd === '/start') await tgSend(m.chat.id, HELP);
    else if (CMD[cmd]) {
      const i = await db.op('insight_get', { agent: CMD[cmd] }).catch(() => null);
      await tgSend(m.chat.id, i ? `<b>${esc(A.AGENTS[i.agent].name)} · ${esc(i.title)}</b>\n\n` + (i.agent === 'lead' ? esc(i.text) : (((i.data && i.data.items) || []).slice(0, 8).map((x) => (x.level === 'bad' ? '🔴 ' : x.level === 'warn' ? '🟡 ' : '🟢 ') + esc(x.text)).join('\n') || '✅ Замечаний нет')) + `\n\n<a href="${publicUrl(req)}/app/#/o/agents">Открыть в кабинете</a>` : 'Агент ещё не работал — подождите утреннего отчёта.');
    } else {
      const q = text.replace(/@\w+/g, '').trim().slice(0, 1500);
      const ctx = await db.op('ctx', { days: 14 });
      await db.op('chat_add', { role: 'user', text: q, via: 'tg' });
      const ans = await A.answer(q, ctx);
      await db.op('chat_add', { role: 'assistant', text: ans.text, via: 'tg' });
      await tgSend(m.chat.id, esc(ans.text));
    }
  } catch (e) { await tgSend(m.chat.id, 'Не получилось ответить: ' + esc(String(e.message).slice(0, 200))); }
  return send(res, 200, { ok: true });
};
