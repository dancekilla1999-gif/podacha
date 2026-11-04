// Агенты «Подачи»: обучение зала. Цифры — из базы, тексты-советы — ИИ (если подключён).
const ai = require('./ai');
const ALLERGENS = require('./allergens.json');

const AGENTS = {
  lead: { name: 'Управляющий залом', role: 'План на неделю по обучению и ответы на вопросы о команде и меню' },
  coach: { name: 'Аналитик обучения', role: 'Кто тренируется, кто пропал, как растут знания меню, готовы ли новички' },
  mentor: { name: 'Наставник', role: 'Личный план каждому сотруднику: какие блюда и ситуации подтянуть' },
  menu_check: { name: 'Меню-контроль', role: 'Проверяет карточки меню: составы, аллергены, допродажи, цены' },
  guest: { name: 'ИИ-гость', role: 'Тренирует официантов живым диалогом с «гостем» и оценивает ответы' }
};
const QT = { ingredients: 'состав', allergen: 'аллергены', allergens: 'аллергены', price: 'цены', upsell: 'допродажа', portion: 'выход', category: 'категории', case: 'ситуации из зала', cases: 'ситуации из зала', other: 'прочее' };

function isoAdd(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dow(day) { return new Date(day + 'T12:00:00Z').getUTCDay(); }
function dayRu(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); }
function weekOf(day) { const d = dow(day); const mon = isoAdd(day, d === 0 ? -6 : 1 - d); return { from: mon, to: isoAdd(mon, 6), key: 'w' + mon }; }
function levelOf(items) { return items.some((i) => i.level === 'bad') ? 'bad' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok'; }
function plural(n, a, b, c) { const m = Math.abs(n) % 100, l = m % 10; return m > 10 && m < 20 ? c : l > 1 && l < 5 ? b : l === 1 ? a : c; }
function daysAgo(iso, today) { return iso ? Math.floor((Date.parse(today + 'T12:00:00Z') - Date.parse(iso)) / 86400000) : null; }

// ------------------------------------------------------------------ Аналитик обучения
function coach(ctx, pkey) {
  const items = [], venues = [];
  (ctx.venues || []).forEach((v) => {
    const pre = ctx.venues.length > 1 ? v.name + ': ' : '';
    const st = v.staff || [];
    const active = st.filter((s) => s.tr > 0);
    const idle = st.filter((s) => !s.tr && daysAgo(s.joined_at, ctx.today) >= 3);
    venues.push({ id: v.id, name: v.name, staff: st.length, active: active.length, trainings: v.trainings, trainings_prev: v.trainings_prev, acc: v.acc, acc_prev: v.acc_prev, weak_items: v.weak_items, weak_cases: v.weak_cases,
      people: st.map((s) => ({ name: s.name, role: s.role, newbie: s.is_newbie, readiness: s.readiness, tr: s.tr, acc: s.acc, streak: s.streak, last: s.last_tr, guest: (s.guest || [])[0] || null })) });
    if (!st.length) { items.push({ level: 'warn', text: `${pre}сотрудники ещё не подключены — отправьте ссылку-приглашение в чат команды (раздел «Команда»)` }); return; }
    if (!(v.items || []).some((m) => m.confirmed)) items.push({ level: 'bad', text: `${pre}меню не проверено — сотрудники тренируются только на ситуациях. Откройте «Меню» и нажмите «Проверено»` });
    const share = st.length ? active.length / st.length : 0;
    if (share < 0.6) items.push({ level: share < 0.3 ? 'bad' : 'warn', text: `${pre}тренировались ${active.length} из ${st.length} за ${ctx.days} ${plural(ctx.days, 'день', 'дня', 'дней')}` });
    if (idle.length) items.push({ level: 'warn', text: `${pre}не заходили: ${idle.slice(0, 6).map((s) => s.name).join(', ')}${idle.length > 6 ? ' и др.' : ''} — напомните на планёрке, разминка занимает 5 минут` });
    if (v.acc != null && v.acc_prev != null && v.acc - v.acc_prev <= -7) items.push({ level: 'warn', text: `${pre}точность ответов упала: ${v.acc}% против ${v.acc_prev}% неделей раньше — возможно, обновилось меню` });
    else if (v.acc != null && v.acc_prev != null && v.acc - v.acc_prev >= 5) items.push({ level: 'ok', text: `${pre}точность выросла до ${v.acc}% (было ${v.acc_prev}%)` });
    st.filter((s) => s.is_newbie).forEach((s) => {
      const days = daysAgo(s.joined_at, ctx.today);
      if (s.readiness >= 80) items.push({ level: 'ok', text: `${pre}новичок ${s.name} знает меню на ${s.readiness}% — можно ставить на самостоятельную смену и снять отметку «новичок»` });
      else if (days >= 7 && s.readiness < 50) items.push({ level: 'warn', text: `${pre}новичок ${s.name}: ${days} ${plural(days, 'день', 'дня', 'дней')} в команде, а меню знает на ${s.readiness}% — нужен наставник на смене` });
    });
    (v.weak_items || []).slice(0, 3).forEach((w) => { if (w.wrong >= 3) items.push({ level: 'warn', text: `${pre}«${w.name}» — ${w.wrong} ${plural(w.wrong, 'ошибка', 'ошибки', 'ошибок')} из ${w.attempts}: разберите блюдо на планёрке (состав, подача, с чем предложить)` }); });
    const leaders = active.slice().sort((a, b) => b.tr - a.tr || (b.acc || 0) - (a.acc || 0)).slice(0, 3);
    if (leaders.length) items.push({ level: 'ok', text: `${pre}лидеры недели: ${leaders.map((s) => `${s.name} (${s.tr} ${plural(s.tr, 'тренировка', 'тренировки', 'тренировок')}${s.acc != null ? ', ' + s.acc + '%' : ''})`).join(', ')} — отметьте их перед командой` });
  });
  const tot = venues.reduce((s, v) => ({ staff: s.staff + v.staff, active: s.active + v.active, tr: s.tr + (v.trainings || 0) }), { staff: 0, active: 0, tr: 0 });
  const title = tot.staff ? `Обучение: тренировались ${tot.active} из ${tot.staff}, ${tot.tr} ${plural(tot.tr, 'тренировка', 'тренировки', 'тренировок')} за ${ctx.days} ${plural(ctx.days, 'день', 'дня', 'дней')}` : 'Обучение: команда ещё не подключена';
  return { agent: 'coach', pkey, level: levelOf(items), title, data: { venues, days: ctx.days }, items, text: title + '.' };
}

// ------------------------------------------------------------------ Наставник: личные планы
function mentor(ctx, pkey) {
  const staff = [], items = [];
  (ctx.venues || []).forEach((v) => (v.staff || []).forEach((s) => {
    const weakT = Object.keys(s.by_type || {}).filter((k) => s.by_type[k] < 70).sort((a, b) => s.by_type[a] - s.by_type[b]);
    const steps = [];
    if (!s.tr) steps.push('Пройти разминку сегодня перед сменой — 5 минут');
    (s.weak || []).slice(0, 3).forEach((w) => steps.push(`Повторить «${w.item}» в разделе «Учить меню» (ошибок: ${w.wrong})`));
    weakT.slice(0, 2).forEach((k) => steps.push(`Подтянуть тему «${QT[k] || k}» — точность ${s.by_type[k]}%`));
    if (s.is_newbie && s.readiness < 80) steps.push(`Цель новичка — 80% по меню, сейчас ${s.readiness}%: проходить разминку каждый день`);
    const g = (s.guest || [])[0];
    if (!g) steps.push('Попробовать тренажёр «ИИ-гость» — живой диалог с гостем по вашему меню');
    else if (g.score != null && g.score < 70) steps.push(`Повторить «ИИ-гость»: прошлый результат ${g.score}/100`);
    if (!steps.length) steps.push('Отличная форма — держать серию и помогать новичкам');
    staff.push({ id: s.id, venue: v.name, name: s.name, role: s.role, readiness: s.readiness, acc: s.acc, streak: s.streak, steps: steps.slice(0, 4), tip: steps[0] });
  }));
  staff.forEach((s) => { if (s.acc != null && s.acc < 60) items.push({ level: 'warn', text: `${s.name}: точность ${s.acc}% — план: ${s.steps.slice(0, 2).join('; ')}` }); });
  const title = staff.length ? `Наставник: личные планы для ${staff.length} ${plural(staff.length, 'сотрудника', 'сотрудников', 'сотрудников')}` : 'Наставник: команды пока нет';
  return { agent: 'mentor', pkey, level: levelOf(items), title, data: { staff }, items, text: title + '. Каждый видит свой план в приложении сотрудника.' };
}

// ------------------------------------------------------------------ Меню-контроль
function norm(s) { return ' ' + String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/(кокосов|овсян|рисов)\S*\s+(молок|сливк)\S*/g, ' ').replace(/безлактоз\S*|без\s+глютен\S*/g, ' ') + ' '; }
function detectAllergens(text) {
  const t = norm(text), found = [];
  ALLERGENS.forEach((a) => { if (a.phrases.some((p) => t.indexOf(' ' + p) >= 0) || a.words.some((w) => t.indexOf(' ' + w) >= 0)) found.push(a); });
  return found;
}
function menuCheck(ctx, pkey) {
  const items = [], rows = [];
  (ctx.venues || []).forEach((v) => {
    const pre = ctx.venues.length > 1 ? v.name + ': ' : '';
    const list = v.items || [];
    if (!list.length) { items.push({ level: 'bad', text: `${pre}меню пустое — загрузите его в разделе «Меню» (можно вставить текстом или из таблицы)` }); return; }
    const unconf = list.filter((m) => !m.confirmed);
    if (unconf.length) items.push({ level: unconf.length === list.length ? 'bad' : 'warn', text: `${pre}${unconf.length} ${plural(unconf.length, 'позиция не проверена', 'позиции не проверены', 'позиций не проверено')} — сотрудники их не учат. Проверьте состав и нажмите «Проверено»` });
    list.forEach((m) => {
      const problems = [];
      const ingr = (m.ingredients || []).join(', ');
      if (!ingr && !m.description) problems.push('нет состава');
      const declared = (m.allergens || []).map((x) => String(x).toLowerCase());
      const missed = detectAllergens(ingr + ' ' + m.description + ' ' + m.name).filter((a) => declared.indexOf(a.key) < 0).map((a) => a.key);
      if (missed.length) problems.push('возможно, не указаны аллергены: ' + missed.join(', '));
      if (!m.upsell) problems.push('нет подсказки для допродажи');
      if (m.price == null) problems.push('нет цены');
      if (problems.length) rows.push({ venue: v.name, name: m.name, category: m.category, problems, confirmed: m.confirmed });
    });
    const allergenRisk = rows.filter((r) => r.venue === v.name && r.problems.some((p) => p.indexOf('аллерген') >= 0));
    if (allergenRisk.length) items.push({ level: 'bad', text: `${pre}у ${allergenRisk.length} ${plural(allergenRisk.length, 'позиции', 'позиций', 'позиций')} по составу есть аллергены, которые не отмечены: ${allergenRisk.slice(0, 4).map((r) => r.name).join(', ')} — гостю с аллергией официант ответит неправильно` });
    const noUp = rows.filter((r) => r.venue === v.name && r.problems.indexOf('нет подсказки для допродажи') >= 0);
    if (noUp.length >= Math.max(3, list.length * 0.3)) items.push({ level: 'warn', text: `${pre}у ${noUp.length} ${plural(noUp.length, 'позиции', 'позиций', 'позиций')} нет подсказки «что предложить к блюду» — это прямые потери среднего чека` });
    const noComp = rows.filter((r) => r.venue === v.name && r.problems.indexOf('нет состава') >= 0);
    if (noComp.length) items.push({ level: 'warn', text: `${pre}без состава: ${noComp.slice(0, 5).map((r) => r.name).join(', ')}${noComp.length > 5 ? ' и др.' : ''}` });
  });
  const total = (ctx.venues || []).reduce((s, v) => s + (v.items || []).length, 0);
  const title = total ? `Меню-контроль: ${total} ${plural(total, 'позиция', 'позиции', 'позиций')}, ${rows.length ? 'требуют внимания: ' + rows.length : 'всё заполнено'}` : 'Меню-контроль: меню ещё не загружено';
  return { agent: 'menu_check', pkey, level: levelOf(items), title, data: { rows: rows.slice(0, 200) }, items, text: title + '.' };
}

// ------------------------------------------------------------------ ИИ-гость: статистика для владельца
function guestStats(ctx, pkey) {
  const items = [], rows = [];
  (ctx.venues || []).forEach((v) => (v.staff || []).forEach((s) => (s.guest || []).forEach((g) => rows.push({ venue: v.name, name: s.name, score: g.score, mode: g.mode, summary: g.summary, at: g.at }))));
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + (r.score || 0), 0) / rows.length) : null;
  const low = rows.filter((r) => r.score != null && r.score < 60);
  if (!rows.length) items.push({ level: 'warn', text: 'Никто ещё не пробовал тренажёр «ИИ-гость». Он есть в приложении сотрудника — попросите каждого пройти один диалог на этой неделе' });
  if (low.length) items.push({ level: 'warn', text: `Слабые диалоги с гостем: ${[...new Set(low.map((r) => r.name))].slice(0, 5).join(', ')} — разберите ошибки вместе` });
  const title = rows.length ? `ИИ-гость: ${rows.length} ${plural(rows.length, 'диалог', 'диалога', 'диалогов')} за месяц, средняя оценка ${avg}/100` : 'ИИ-гость: диалогов ещё не было';
  return { agent: 'guest', pkey, level: levelOf(items), title, data: { rows: rows.slice(0, 60), avg }, items, text: title + '.' };
}

// ------------------------------------------------------------------ Управляющий залом
const LEAD_SYS = 'Ты — управляющий залом и тренер официантов в сервисе «Подача». Тебе приходят выводы агентов об обучении команды и состоянии меню. ' +
  'Напиши владельцу короткий план на неделю: 1–2 предложения, как идёт обучение, и 3–5 конкретных действий (кому что сделать, с цифрами из данных). На «вы», до 1000 знаков, без вступлений.';
async function lead(period, results, opts = {}) {
  const items = [];
  results.filter(Boolean).forEach((r) => (r.items || []).forEach((i) => { if (i.level !== 'ok' || /лидеры|можно ставить/.test(i.text)) items.push({ agent: r.agent, level: i.level, text: i.text }); }));
  items.sort((a, b) => ({ bad: 0, warn: 1, ok: 2 }[a.level] - { bad: 0, warn: 1, ok: 2 }[b.level]));
  const facts = { период: period.label, выводы: items.slice(0, 16).map((i) => `[${AGENTS[i.agent] ? AGENTS[i.agent].name : i.agent}/${i.level}] ${i.text}`) };
  let text = opts.noAi ? null : await ai.write(LEAD_SYS, facts, { maxTokens: 800 });
  const byAi = !!text;
  if (!text) { const top = items.filter((i) => i.level !== 'ok').slice(0, 5); text = top.length ? 'Что сделать на этой неделе:\n' + top.map((i, n) => `${n + 1}. ${i.text}`).join('\n') : 'Команда тренируется, меню в порядке — держим темп.'; }
  return { agent: 'lead', pkey: period.key, level: levelOf(items), title: `План на неделю после ${period.label}`, data: { period, actions: items.slice(0, 12), by_ai: byAi }, items: items.slice(0, 12), text };
}

const ASK_SYS = 'Ты — управляющий залом и тренер персонала в сервисе «Подача» (обучение официантов, барменов и кальянщиков по меню заведения). Отвечай владельцу по-русски, на «вы», коротко и практично, опираясь на данные. ' +
  'Можешь давать советы по сервису, допродажам, стандартам обслуживания и мотивации команды. Не выдумывай цифры. До 1200 знаков, без markdown-таблиц.';
function compactCtx(ctx) {
  const ins = {};
  (ctx.insights || []).forEach((i) => { ins[i.agent] = { title: i.title, выводы: ((i.data && i.data.items) || []).map((x) => x.text).slice(0, 10), текст: i.agent === 'lead' ? i.text : undefined }; });
  return { заведения: (ctx.venues || []).map((v) => ({ name: v.name, позиций_в_меню: (v.items || []).length, проверено: (v.items || []).filter((m) => m.confirmed).length, тренировок: v.trainings, точность: v.acc,
    сотрудники: (v.staff || []).map((s) => `${s.name} (${s.role}${s.is_newbie ? ', новичок' : ''}): готовность ${s.readiness}%, тренировок ${s.tr}, точность ${s.acc ?? '—'}%`),
    слабые_блюда: (v.weak_items || []).map((w) => `${w.name}: ${w.wrong}/${w.attempts}`), слабые_ситуации: (v.weak_cases || []).map((w) => w.question) })), агенты: ins };
}
async function answer(question, ctx) {
  const q = String(question || '').trim().slice(0, 1500);
  if (ai.enabled()) {
    const msgs = [{ role: 'system', content: ASK_SYS + '\n\nДанные (JSON):\n' + JSON.stringify(compactCtx(ctx)).slice(0, 24000) }];
    (ctx.chat || []).slice(-6).forEach((m) => msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text).slice(0, 1500) }));
    msgs.push({ role: 'user', content: q });
    try { return { text: ai.clean(await ai.chat(msgs, { maxTokens: 900 })), by_ai: true }; } catch (e) { console.error('answer', e.message); }
  }
  const l = q.toLowerCase(), ins = {};
  (ctx.insights || []).forEach((i) => { ins[i.agent] = i; });
  const pick = (/меню|аллерг|состав|допрод/.test(l) && 'menu_check') || (/гост|диалог/.test(l) && 'guest') || (/план|кому|личн/.test(l) && 'mentor') || (/трениру|новичк|кто|точност|команд/.test(l) && 'coach') || 'lead';
  const i = ins[pick] || ins.lead || ins.coach;
  const head = 'ИИ пока не подключён администратором сервиса, поэтому отвечаю выводами агентов.';
  if (!i) return { text: head + ' Агенты ещё не работали — нажмите «Проверить сейчас».', by_ai: false };
  return { text: `${head}\n\n${AGENTS[i.agent].name}: ${i.title}\n` + ((i.data && i.data.items) || []).slice(0, 5).map((x) => '• ' + x.text).join('\n'), by_ai: false };
}

// ------------------------------------------------------------------ ИИ-гость: диалог
const GUEST_SYS = (venue, items, staff) => 'Ты играешь ГОСТЯ в заведении «' + venue.name + '». С тобой говорит ' + staff.role + ' ' + staff.name + ', он тренируется. ' +
  'Веди себя как реальный гость: задавай по одному короткому вопросу или реплике за раз (1–2 предложения), разговорным языком. Темы: состав и аллергены блюд, что посоветовать, с чем взять, время ожидания, иногда лёгкая претензия. ' +
  'Опирайся только на это меню; иногда проверяй знание состава и аллергенов. Не подсказывай правильные ответы и не выходи из роли. Меню (JSON): ' + JSON.stringify(items.slice(0, 80).map((m) => ({ n: m.name, c: m.category, s: (m.ingredients || []).join(', ') || m.description, a: m.allergens, p: m.price, up: m.upsell })));
const JUDGE_SYS = 'Ты — строгий, но доброжелательный тренер официантов. Оцени диалог сотрудника с гостем по меню заведения: точность ответов о составе и аллергенах, вежливость, допродажа, умение снять претензию. ' +
  'Ответь строго JSON без пояснений: {"score": число 0–100, "good": "что получилось, 1–2 предложения", "fix": "что исправить, 1–3 конкретных пункта через ; ", "facts": "ошибки по меню, если были"}.';
async function guestReply(venue, items, staff, turns) {
  const msgs = [{ role: 'system', content: GUEST_SYS(venue, items, staff) }];
  turns.forEach((t) => msgs.push({ role: t.who === 'guest' ? 'assistant' : 'user', content: String(t.text).slice(0, 800) }));
  if (!turns.length) msgs.push({ role: 'user', content: '(Сотрудник подошёл к столу: «Здравствуйте! Меня зовут ' + staff.name + ', я ваш ' + staff.role + '.»)' });
  return ai.clean(await ai.chat(msgs, { temperature: 0.8, maxTokens: 200 }));
}
async function guestJudge(venue, items, turns) {
  const t = await ai.chat([{ role: 'system', content: JUDGE_SYS }, { role: 'user', content: 'Меню: ' + JSON.stringify(items.slice(0, 80).map((m) => ({ n: m.name, s: (m.ingredients || []).join(', ') || m.description, a: m.allergens, up: m.upsell }))) + '\n\nДиалог:\n' + turns.map((x) => (x.who === 'guest' ? 'Гость: ' : 'Сотрудник: ') + x.text).join('\n') }], { temperature: 0.1, maxTokens: 400 });
  const m = t.match(/\{[\s\S]*\}/);
  let j = null; try { j = JSON.parse(m ? m[0] : t); } catch (e) { j = null; }
  if (!j || typeof j.score !== 'number') return { score: 0, good: '', fix: 'Не удалось оценить диалог — попробуйте ещё раз', facts: '' };
  return { score: Math.max(0, Math.min(100, Math.round(j.score))), good: String(j.good || ''), fix: String(j.fix || ''), facts: String(j.facts || '') };
}

module.exports = { AGENTS, coach, mentor, menuCheck, guestStats, lead, answer, guestReply, guestJudge, detectAllergens, weekOf, isoAdd, dow, dayRu };
