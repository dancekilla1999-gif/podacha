/* «Трио» — общий экран команды агентов для Журналки и Подачи: обзор, подробности, вопросы ИИ, Telegram.
   Подключение: AGUI.screen(root, cfg). cfg = { title, sub, agents:[{id,name,ico,role}], lead:'chef', suggest:[...],
   home: () => Promise(home), server: (action, args) => Promise, detail: { agentId: (insight, h) => node }, onBack } */
(function () {
  "use strict";
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "class") el.className = v; else if (k === "text") el.textContent = v; else if (k === "style") el.style.cssText = v;
      else if (k === "value") el.value = v; else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function lvl(l) { return l === "bad" ? "bad" : l === "warn" ? "warn" : "ok"; }
  function dot(l) { return h("span", { class: "ag-dot " + lvl(l), "aria-hidden": "true" }); }
  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return "только что"; if (s < 3600) return Math.round(s / 60) + " мин назад"; if (s < 86400) return Math.round(s / 3600) + " ч назад";
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  }
  function items(list) {
    list = list || [];
    if (!list.length) return h("div", { class: "ag-item ok" }, dot("ok"), h("span", { text: "Замечаний нет." }));
    return h("div", { class: "ag-items" }, list.map(function (i) { return h("div", { class: "ag-item " + lvl(i.level) }, dot(i.level), h("span", { text: i.text })); }));
  }
  function toast(t, bad) {
    var el = document.getElementById("ag-toast"); if (!el) { el = h("div", { id: "ag-toast", role: "status", "aria-live": "polite" }); document.body.appendChild(el); }
    el.textContent = t; el.className = "show" + (bad ? " bad" : ""); clearTimeout(el._t); el._t = setTimeout(function () { el.className = ""; }, 4000);
  }

  function chatBox(cfg, history, aiOn) {
    var log = h("div", { class: "ag-log", "aria-live": "polite" });
    function bubble(role, text) { log.appendChild(h("div", { class: "ag-msg " + role }, h("span", { text: text }))); log.scrollTop = log.scrollHeight; }
    (history || []).forEach(function (m) { bubble(m.role, m.text); });
    if (!(history || []).length) bubble("assistant", cfg.hello || "Здравствуйте! Спросите что угодно — отвечу по вашим данным.");
    var inp = h("textarea", { rows: 2, maxlength: 1500, placeholder: cfg.placeholder || "Ваш вопрос…" });
    var btn = h("button", { class: "btn primary", type: "submit", text: "Спросить" });
    function ask(q) {
      q = String(q || "").trim(); if (q.length < 2) return;
      bubble("user", q); inp.value = ""; btn.disabled = true;
      var wait = h("div", { class: "ag-msg assistant wait" }, "Смотрю данные…"); log.appendChild(wait); log.scrollTop = log.scrollHeight;
      cfg.server("ask", { question: q }).then(function (r) { wait.remove(); bubble("assistant", r.text); btn.disabled = false; },
        function (e) { wait.remove(); bubble("assistant", "Не получилось ответить: " + e.message); btn.disabled = false; });
    }
    return h("section", { class: "card ag-chat" },
      h("div", { class: "ag-row" }, h("h2", { text: cfg.askTitle || "Спросить" }), h("span", { class: "small muted", text: aiOn ? "YandexGPT · по вашим данным" : "пока без ИИ — отвечаю выводами агентов" })),
      log,
      h("div", { class: "ag-chips" }, (cfg.suggest || []).map(function (s) { return h("button", { class: "ag-chip", type: "button", text: s, onclick: function () { ask(s); } }); })),
      h("form", { class: "ag-form", onsubmit: function (ev) { ev.preventDefault(); ask(inp.value); } }, inp, btn));
  }

  function tgBox(cfg, tg, st) {
    var box = h("section", { class: "card ag-tg" });
    if (tg && tg.bound) {
      add(box, [h("div", null, h("b", { text: "Telegram подключён" }), h("p", { class: "small muted", text: "Отчёты агентов приходят в чат «" + (tg.title || "Telegram") + "». Туда же можно писать вопросы." })),
        h("button", { class: "btn small ghost", text: "Отключить", onclick: function () { cfg.server("tg_unbind").then(function () { toast("Telegram отключён"); cfg.reload(); }, function (e) { toast(e.message, true); }); } })]);
    } else {
      add(box, [h("div", null, h("b", { text: "Получайте отчёты агентов в Telegram" }), h("p", { class: "small muted", text: st.tg ? "Каждое утро — коротко и по делу, плюс можно задавать вопросы прямо в чате." : "Бот ещё не настроен администратором сервиса." })),
        st.tg ? h("button", { class: "btn small primary", text: "Подключить", onclick: function (ev) {
          ev.target.disabled = true;
          cfg.server("tg_link").then(function (r) { ev.target.disabled = false; if (!r.enabled) { toast("Бот ещё не настроен", true); return; } window.open(r.url, "_blank", "noopener"); box.appendChild(h("p", { class: "small" }, "Если бот не открылся: ", h("a", { href: r.url, target: "_blank", rel: "noopener", text: r.url }), ". После «Старт» обновите страницу.")); },
            function (e) { ev.target.disabled = false; toast(e.message, true); });
        } }) : null]);
    }
    return box;
  }

  function overview(cfg, d, st) {
    var ins = {}; (d.insights || []).forEach(function (i) { ins[i.agent] = i; });
    var lead = ins[cfg.lead];
    var run = h("button", { class: "btn small", text: cfg.runText || "Проверить сейчас" });
    run.addEventListener("click", function () {
      run.disabled = true; run.textContent = "Агенты работают…";
      cfg.server("run").then(function (r) { toast(r.empty ? (cfg.emptyText || "Пока нет данных для агентов") : "Готово — агенты обновили выводы"); cfg.reload(); }, function (e) { run.disabled = false; run.textContent = cfg.runText || "Проверить сейчас"; toast(e.message, true); });
    });
    return h("div", { class: "ag" },
      h("div", { class: "page-head" }, h("div", null, h("span", { class: "label", text: "Команда агентов" }), h("h1", { text: cfg.title }), h("p", { class: "muted small", text: cfg.sub + (st.ai ? "" : " ИИ-тексты появятся, когда администратор сервиса подключит YandexGPT; проверки и правила работают уже сейчас.") })),
        h("div", { class: "ag-row" }, run)),
      lead ? h("section", { class: "card ag-brief " + lvl(lead.level) }, h("div", { class: "ag-row" }, h("span", { class: "label", text: (cfg.agents.filter(function (a) { return a.id === cfg.lead; })[0] || {}).ico + " " + lead.title }), h("a", { class: "small", href: cfg.href(cfg.lead), text: "Подробнее" })), h("div", { class: "ag-text", text: lead.text }))
        : h("div", { class: "notice" }, h("div", null, h("b", { text: "Плана пока нет. " }), "Он появится в понедельник утром — или нажмите «" + (cfg.runText || "Проверить сейчас") + "».")),
      chatBox(cfg, d.chat, st.ai),
      h("div", { class: "ag-grid" }, cfg.agents.filter(function (a) { return a.id !== cfg.lead; }).map(function (a) {
        var i = ins[a.id];
        var top = i && i.data && i.data.items ? i.data.items.filter(function (x) { return x.level !== "ok"; }).slice(0, 2) : [];
        return h("a", { class: "card ag-card " + (i ? lvl(i.level) : ""), href: cfg.href(a.id) },
          h("div", { class: "ag-head" }, h("span", { class: "ag-ico", text: a.ico, "aria-hidden": "true" }), h("div", null, h("h2", { text: a.name }), h("p", { class: "small muted", text: a.role }))),
          i ? h("div", { class: "ag-body" }, h("p", { class: "ag-title" }, dot(i.level), h("b", { text: i.title })), top.map(function (x) { return h("p", { class: "small", text: "• " + x.text }); }), h("span", { class: "small muted", text: "обновлено " + ago(i.created_at) }))
            : h("p", { class: "small muted", text: "Ещё не работал — появится после утренней проверки." }));
      })),
      tgBox(cfg, d.tg, st));
  }

  function detail(cfg, a, i) {
    var extra = cfg.detail && cfg.detail[a.id] ? cfg.detail[a.id](i, h) : null;
    return h("div", { class: "ag" },
      h("div", { class: "page-head" }, h("div", null, h("span", { class: "label", text: a.ico + " Агент «" + a.name + "»" }), h("h1", { text: i.title }), h("p", { class: "small muted", text: a.role + " · обновлено " + ago(i.created_at) })),
        h("div", { class: "ag-row no-print" }, h("a", { class: "btn ghost small", href: cfg.href(), text: "← Все агенты" }), h("button", { class: "btn small", text: "Печать / PDF", onclick: function () { window.print(); } }))),
      a.id === cfg.lead ? h("section", { class: "card ag-brief " + lvl(i.level) }, h("div", { class: "ag-text", text: i.text })) : null,
      h("section", { class: "card" }, h("h2", { text: a.id === cfg.lead ? "На чём основан план" : "Выводы" }), items((i.data && (i.data.items || i.data.actions)) || [])),
      extra);
  }

  window.AGUI = {
    h: h, items: items, toast: toast,
    // обзор: root — контейнер, куда монтировать
    overview: function (root, cfg) {
      root.textContent = ""; root.appendChild(h("p", { class: "muted", text: "Собираю выводы агентов…" }));
      Promise.all([cfg.home(), cfg.server("status").catch(function () { return {}; })]).then(function (r) {
        root.textContent = ""; root.appendChild(overview(cfg, r[0], r[1]));
      }, function (e) { root.textContent = ""; root.appendChild(h("div", { class: "card" }, h("p", { text: e.message }))); });
    },
    detail: function (root, cfg, agentId) {
      var a = cfg.agents.filter(function (x) { return x.id === agentId; })[0];
      if (!a) { location.hash = cfg.href().slice(1); return; }
      root.textContent = ""; root.appendChild(h("p", { class: "muted", text: "Загружаю…" }));
      cfg.get(agentId).then(function (i) { root.textContent = ""; root.appendChild(detail(cfg, a, i)); },
        function (e) { root.textContent = ""; root.appendChild(h("div", { class: "card" }, h("h1", { text: a.ico + " " + a.name }), h("p", { class: "muted", text: e.hint === "not_found" ? "Агент ещё не работал — нажмите «Проверить сейчас» на странице агентов." : e.message }), h("a", { class: "btn", href: cfg.href(), text: "← К агентам" }))); });
    },
    table: function (head, rows, num) {
      num = num || [];
      return h("div", { class: "ag-tbl" }, h("table", null, h("thead", null, h("tr", null, head.map(function (x, i) { return h("th", { class: num.indexOf(i) >= 0 ? "num" : null, text: x }); }))),
        h("tbody", null, rows.map(function (r) { return h("tr", null, r.map(function (x, i) { return h("td", { class: num.indexOf(i) >= 0 ? "num" : null }, x); })); }))));
    }
  };
})();
