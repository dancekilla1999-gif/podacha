/* «Подача» — агенты обучения (владелец), совет наставника и тренажёр «ИИ-гость» (сотрудник). */
(function () {
  "use strict";
  var PD = window.PD, h = PD.h;
  function post(path, body) {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = new Error(d.error || "Ошибка сервера"); e.hint = d.hint; throw e; } return d; }); },
        function () { throw new Error("Нет связи с сервером"); });
  }
  function pct(x) { return x == null ? "—" : x + "%"; }

  // ------------------------------------------------------------ владелец: агенты
  PD.agentsView = function (venue, body, agentId) {
    var tok = PD.ownerToken();
    var cfg = {
      title: "Команда учится под присмотром", sub: "Агенты каждый день обновляют личные планы и проверяют меню, по понедельникам — разбирают неделю обучения.",
      lead: "lead", runText: "Проверить сейчас", emptyText: "Сначала создайте заведение и загрузите меню",
      agents: [
        { id: "lead", name: "Управляющий залом", ico: "🎯", role: "План на неделю и ответы на вопросы о команде и меню" },
        { id: "coach", name: "Аналитик обучения", ico: "📊", role: "Кто тренируется, кто пропал, готовы ли новички к смене" },
        { id: "mentor", name: "Наставник", ico: "🧑‍🏫", role: "Личный план каждому сотруднику — он видит его в своём приложении" },
        { id: "menu_check", name: "Меню-контроль", ico: "📋", role: "Составы, неотмеченные аллергены, допродажи и цены в карточках" },
        { id: "guest", name: "ИИ-гость", ico: "🗣", role: "Диалоги официантов с «гостем»: оценки и типичные ошибки" }
      ],
      suggest: ["Кто не тренировался на этой неделе?", "Какие блюда чаще всего путают?", "Готов ли новичок к самостоятельной смене?", "Как поднять допродажи?", "Что исправить в меню?"],
      askTitle: "Спросить управляющего залом", hello: "Здравствуйте! Спросите про команду, обучение, меню или допродажи — отвечу по вашим данным.", placeholder: "Например: кого из официантов подтянуть?",
      href: function (id) { return "#/o/v/" + venue.id + "/agents" + (id ? "/" + id : ""); },
      home: function () { return PD.api("pd_agent", { p_token: tok, p_op: "home", p_args: {} }); },
      get: function (id) { return PD.api("pd_agent", { p_token: tok, p_op: "insight_get", p_args: { agent: id } }); },
      server: function (action, args) { return post("/api/agents", Object.assign({ action: action, token: tok }, args || {})); },
      reload: function () { PD.dispatch(); },
      detail: {
        coach: function (i, hh) {
          return ((i.data && i.data.venues) || []).map(function (v) {
            return hh("section", { class: "card" }, hh("h2", { text: v.name + " · тренировок " + (v.trainings || 0) + " · точность " + pct(v.acc) }),
              (v.people || []).length ? AGUI.table(["Сотрудник", "Роль", "Готовность", "Тренировок", "Точность", "Серия", "ИИ-гость"], v.people.map(function (s) {
                return [s.name + (s.newbie ? " · новичок" : ""), s.role, pct(s.readiness), String(s.tr), pct(s.acc), String(s.streak), s.guest && s.guest.score != null ? s.guest.score + "/100" : "—"];
              }), [2, 3, 4, 5, 6]) : hh("p", { class: "muted", text: "Сотрудников пока нет." }));
          });
        },
        mentor: function (i, hh) {
          var st = (i.data && i.data.staff) || [];
          return st.length ? hh("section", { class: "card" }, hh("h2", { text: "Личные планы" }), AGUI.table(["Сотрудник", "Готовность", "План"], st.map(function (s) {
            return [s.name + " · " + s.role, pct(s.readiness), hh("ol", { style: "margin:0;padding-left:18px" }, s.steps.map(function (x) { return hh("li", { text: x }); }))];
          }), [1])) : null;
        },
        menu_check: function (i, hh) {
          var rows = (i.data && i.data.rows) || [];
          return rows.length ? hh("section", { class: "card" }, hh("h2", { text: "Карточки, которые стоит поправить" }), AGUI.table(["Позиция", "Категория", "Что не так"], rows.map(function (r) { return [r.name + (r.confirmed ? "" : " · не проверена"), r.category || "—", r.problems.join("; ")]; })),
            hh("a", { class: "btn small", href: "#/o/v/" + venue.id + "/menu", text: "Открыть меню →" })) : null;
        },
        guest: function (i, hh) {
          var rows = (i.data && i.data.rows) || [];
          return rows.length ? hh("section", { class: "card" }, hh("h2", { text: "Диалоги за месяц" }), AGUI.table(["Сотрудник", "Оценка", "Режим", "Разбор", "Когда"], rows.map(function (r) {
            return [r.name, r.score != null ? r.score + "/100" : "—", r.mode === "ai" ? "ИИ" : "сценарий", r.summary || "—", new Date(r.at).toLocaleDateString("ru-RU")];
          }), [1])) : null;
        }
      }
    };
    if (agentId) AGUI.detail(body, cfg, agentId); else AGUI.overview(body, cfg);
  };

  // ------------------------------------------------------------ сотрудник: совет наставника на главной
  PD.mentorTip = function (token, box) {
    PD.api("pd_staff_agent", { p_token: token, p_op: "tip", p_args: {} }).then(function (t) {
      if (!t || !t.steps || !t.steps.length) return;
      box.appendChild(h("div", { class: "card mentor-tip" }, h("span", { class: "label", text: "🧑‍🏫 Совет наставника" }),
        h("ol", { class: "small" }, t.steps.map(function (s) { return h("li", { text: s }); }))));
    }).catch(function () {});
  };

  // ------------------------------------------------------------ сотрудник: ИИ-гость
  PD.route("/s/guest", function () {
    var S = PD.staffApp;
    if (!S.token()) { S.lost(); return; }
    PD.mount(PD.loading());
    Promise.all([PD.api("pd_staff_agent", { p_token: S.token(), p_op: "guest_start", p_args: {} }), post("/api/guest", { action: "status" }).catch(function () { return { ai: false }; })]).then(function (r) {
      var st = r[0], aiOn = r[1].ai && st.ai_used < st.ai_limit;
      var box = h("div", { class: "guest" });
      if (!st.items.length) { PD.mount(S.page("ИИ-гость", h("div", { class: "card" }, h("p", { text: "Меню ещё не проверено управляющим — гостю не о чем спрашивать. Пока потренируйтесь на ситуациях из зала." }), h("a", { class: "btn", href: "#/s/cases", text: "Ситуации из зала" })), "#/s")); return; }
      PD.mount(S.page("ИИ-гость", [h("div", { class: "card" }, h("h1", { text: "Гость за столиком" }),
        h("p", { class: "muted", text: aiOn ? "Гость задаёт вопросы по вашему меню — отвечайте, как в зале: состав, аллергены, что посоветовать. В конце — оценка и разбор. Осталось ИИ-диалогов в этом месяце: " + (st.ai_limit - st.ai_used) + "."
          : "Тренировочный гость задаст 5 вопросов по меню. Отвечайте своими словами — проверим состав, аллергены и допродажу." + (r[1].ai ? " Лимит ИИ-диалогов на месяц исчерпан — сейчас сценарный режим." : "") })), box], "#/s"));
      if (aiOn) aiDialog(st, box); else scriptDialog(st, box);
    }).catch(function (e) { if (e.hint === "auth") PD.staffApp.lost(e.message); else PD.fatal(e); });
  });

  function chatUi(box, onSend) {
    var log = h("div", { class: "ag-log", "aria-live": "polite" });
    var inp = h("textarea", { rows: 2, maxlength: 800, placeholder: "Ваш ответ гостю…" });
    var btn = h("button", { class: "btn primary", type: "submit", text: "Ответить" });
    var form = h("form", { class: "ag-form", onsubmit: function (ev) { ev.preventDefault(); var t = inp.value.trim(); if (t.length < 2) return; inp.value = ""; onSend(t); } }, inp, btn);
    box.appendChild(h("div", { class: "card ag-chat" }, log, form));
    return {
      say: function (who, text) { log.appendChild(h("div", { class: "ag-msg " + (who === "guest" ? "assistant" : "user") }, h("span", { text: text }))); log.scrollTop = log.scrollHeight; },
      busy: function (b) { btn.disabled = b; inp.disabled = b; if (!b) inp.focus(); },
      end: function () { form.remove(); }
    };
  }
  function result(box, score, good, fix, facts) {
    box.appendChild(h("div", { class: "card guest-result" }, h("span", { class: "label", text: "Оценка" }), h("h2", { text: score + " / 100" }),
      good ? h("p", null, h("b", { text: "Получилось: " }), good) : null, fix ? h("p", null, h("b", { text: "Исправить: " }), fix) : null, facts ? h("p", { class: "small muted", text: facts }) : null,
      h("div", { class: "row" }, h("a", { class: "btn primary", href: "#/s", text: "На главную" }), h("button", { class: "btn ghost", text: "Ещё раз", onclick: function () { PD.dispatch(); } }))));
  }
  function aiDialog(st, box) {
    var turns = [], tok = PD.staffApp.token(), MAX = 6;
    var ui = chatUi(box, function (t) { turns.push({ who: "staff", text: t }); ui.say("staff", t); next(); });
    function next() {
      ui.busy(true);
      var staffTurns = turns.filter(function (x) { return x.who === "staff"; }).length;
      if (staffTurns >= MAX) { ui.end(); ui.say("guest", "Спасибо, я всё понял(а)!"); judge(); return; }
      post("/api/guest", { action: "reply", token: tok, turns: turns }).then(function (r) {
        if (!r.ai) { box.textContent = ""; scriptDialog(st, box); return; }
        turns.push({ who: "guest", text: r.text }); ui.say("guest", r.text); ui.busy(false);
      }, function (e) { ui.say("guest", "Связь пропала: " + e.message); ui.busy(false); });
    }
    function judge() {
      var wait = h("p", { class: "muted", text: "Тренер разбирает диалог…" }); box.appendChild(wait);
      post("/api/guest", { action: "judge", token: tok, turns: turns }).then(function (r) { wait.remove(); result(box, r.score, r.good, r.fix, r.facts); }, function (e) { wait.textContent = "Не удалось оценить: " + e.message; });
    }
    next();
  }
  // сценарный гость без ИИ: вопросы по составу, аллергенам и допродаже, проверка по ключевым словам
  function words(s) { return String(s || "").toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/).filter(function (w) { return w.length > 3; }); }
  function scriptDialog(st, box) {
    var items = PD.shuffle ? PD.shuffle(st.items.slice()) : st.items.slice();
    var qs = [];
    items.slice(0, 8).forEach(function (m) {
      var ingr = (m.ingredients || []).join(", ") || m.description;
      if (ingr && qs.length < 5) qs.push({ q: "Подскажите, а что входит в «" + m.name + "»?", check: function (a) { var w = words(ingr), aw = words(a); var hit = w.filter(function (x) { return aw.some(function (y) { return y.slice(0, 5) === x.slice(0, 5); }); }).length; return { ok: hit >= Math.min(2, w.length), right: ingr }; } });
      if ((m.allergens || []).length && qs.length < 5) { var al = m.allergens[0]; qs.push({ q: "У меня аллергия на " + al + ". «" + m.name + "» мне можно?", check: function (a) { var no = /нельзя|не\s*стоит|не\s*могу|не\s*советую|содерж|есть\s/i.test(a); return { ok: no, right: "Нельзя: в блюде есть " + m.allergens.join(", ") + ". Предложите альтернативу без аллергена." }; } }); }
      if (m.upsell && qs.length < 5) qs.push({ q: "Возьму «" + m.name + "». Что к нему посоветуете?", check: function (a) { var w = words(m.upsell), aw = words(a); var ok = w.some(function (x) { return aw.some(function (y) { return y.slice(0, 5) === x.slice(0, 5); }); }); return { ok: ok, right: m.upsell }; } });
    });
    if (!qs.length) qs.push({ q: "Что у вас самое популярное?", check: function (a) { return { ok: a.length > 10, right: "Назовите 1–2 блюда и коротко опишите вкус" }; } });
    var i = 0, good = 0, turns = [], misses = [];
    var ui = chatUi(box, function (t) {
      ui.say("staff", t); turns.push({ who: "staff", text: t });
      var r = qs[i].check(t); if (r.ok) good++; else misses.push(r.right);
      i++;
      if (i < qs.length) { ui.say("guest", qs[i].q); turns.push({ who: "guest", text: qs[i].q }); return; }
      ui.end(); ui.say("guest", "Спасибо!");
      var score = Math.round(100 * good / qs.length);
      PD.api("pd_staff_agent", { p_token: PD.staffApp.token(), p_op: "guest_save", p_args: { mode: "script", score: score, summary: misses.length ? "Ошибки: " + misses.slice(0, 3).join(" | ") : "Без ошибок", turns: turns } }).catch(function () {});
      result(box, score, good + " из " + qs.length + " ответов точные", misses.length ? misses.slice(0, 3).join(" · ") : "", "");
    });
    ui.say("guest", qs[0].q); turns.push({ who: "guest", text: qs[0].q });
  }
})();
