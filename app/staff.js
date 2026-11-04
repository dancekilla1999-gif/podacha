/* «Подача» — приложение сотрудника: подключение, разминка, ситуации, меню. */
(function () {
  "use strict";
  var PD = window.PD, h = PD.h;
  var ROLES = ["официант", "бармен", "кальянщик", "хостес", "менеджер", "другое"];
  var T = { token: PD.store.get("pd_staff"), home: null };

  function setToken(t) { T.token = t; T.home = null; PD.store.set("pd_staff", t); }
  function staffApi(fn, args) {
    return PD.api(fn, Object.assign({ p_token: T.token }, args || {})).catch(function (e) {
      if (e.hint === "auth") { setToken(null); lostLink(e.message); }
      throw e;
    });
  }
  function lostLink(msg) {
    PD.mount(h("main", { class: "page narrow" }, h("div", { class: "card center" },
      h("h1", { text: "Нужна новая ссылка" }),
      h("p", { class: "muted", text: msg || "Попросите у управляющего ссылку-приглашение или личную ссылку." }),
      h("a", { class: "btn primary", href: "#/code", text: "Ввести код приглашения" }))));
  }
  PD.staffApp = { token: function () { return T.token; }, page: function () { return staffPage.apply(null, arguments); }, lost: function (m) { lostLink(m); } };
  function staffPage(title, content, back) {
    return h("div", { class: "shell staff" },
      h("header", { class: "topbar" }, h("div", { class: "wrap topbar-in" },
        back ? h("a", { class: "back", href: back, "aria-label": "Назад", text: "←" }) : h("span", { class: "brand", text: "Подача" }),
        h("span", { class: "venue-name", text: title }))),
      h("main", { class: "wrap page staff-page" }, content));
  }

  // ------------------------------------------------------------ очередь неотправленных результатов
  function pending() { try { return JSON.parse(PD.store.get("pd_pending") || "[]"); } catch (e) { return []; } }
  function savePending(list) { PD.store.set("pd_pending", list.length ? JSON.stringify(list.slice(-20)) : null); }
  function flushPending() {
    var list = pending();
    if (!list.length || !T.token) return Promise.resolve();
    var item = list[0];
    return PD.api("pd_staff_submit", { p_token: T.token, p_kind: item.kind, p_answers: item.answers }).then(function () {
      savePending(list.slice(1));
      return flushPending();
    }, function (e) { if (!e.network) savePending(list.slice(1)); });
  }

  // ------------------------------------------------------------ подключение
  function joinPage(code) {
    var name = h("input", { id: "j-name", autocomplete: "given-name", maxlength: "40", required: true, placeholder: "Например, Анна" });
    var role = h("select", { id: "j-role" }, ROLES.map(function (r) { return h("option", { value: r, text: r.charAt(0).toUpperCase() + r.slice(1) }); }));
    var err = h("p", { class: "form-err", role: "alert" });
    var btn = h("button", { class: "btn primary wide", type: "submit", text: "Начать" });
    PD.mount(h("main", { class: "page narrow" }, h("span", { class: "brand big", text: "Подача" }),
      h("form", { class: "card form", onsubmit: function (e) {
        e.preventDefault();
        if (!name.value.trim()) { err.textContent = "Напишите своё имя"; return; }
        btn.disabled = true;
        PD.api("pd_staff_join", { p_code: code, p_name: name.value, p_role: role.value }).then(function (r) {
          setToken(r.token);
          PD.toast("Добро пожаловать в «" + r.venue + "»!");
          PD.go("/s");
        }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; });
      } },
        h("h1", { text: "Тренировки по меню" }),
        h("p", { class: "muted", text: "Пять минут перед сменой: вопросы по меню и ситуации из зала. Напишите имя — так управляющий увидит ваш прогресс." }),
        h("label", { for: "j-name" }, "Ваше имя", name),
        h("label", { for: "j-role" }, "Должность", role),
        err, btn,
        h("p", { class: "muted small", text: "Мы сохраним только имя и результаты тренировок." }))));
  }
  PD.route("/join/:code", function (p) {
    if (T.token) {
      staffApi("pd_staff_home").then(function () { PD.go("/s"); }, function () { joinPage(p.code); });
      return;
    }
    joinPage(p.code);
  });
  PD.route("/code", function () {
    var code = h("input", { id: "c-code", maxlength: "12", autocomplete: "off", style: "text-transform:uppercase;letter-spacing:.12em", placeholder: "ABCD2345" });
    PD.mount(h("main", { class: "page narrow" }, h("a", { class: "brand big", href: "#/", text: "Подача" }),
      h("form", { class: "card form", onsubmit: function (e) {
        e.preventDefault();
        var c = code.value.replace(/\s/g, "").toUpperCase();
        if (c) PD.go("/join/" + c);
      } },
        h("h1", { text: "Код приглашения" }),
        h("p", { class: "muted", text: "Код из 8 символов вам даст управляющий. Он же есть в ссылке-приглашении." }),
        h("label", { for: "c-code" }, "Код", code),
        h("button", { class: "btn primary wide", type: "submit", text: "Дальше" }))));
  });
  PD.route("/s/login/:token", function (p) {
    setToken(p.token);
    history.replaceState(null, "", location.pathname + "#/s");
    PD.dispatch();
  });

  // ------------------------------------------------------------ главная сотрудника
  function loadHome() {
    return staffApi("pd_staff_home").then(function (d) { T.home = d; return d; });
  }
  PD.route("/s", function () {
    if (!T.token) { lostLink(); return; }
    PD.mount(PD.loading());
    flushPending().then(loadHome).then(function (d) {
      var st = d.stats, items = d.items;
      var size = Math.min(10, d.venue.warmup_size + (d.staff.is_newbie ? 3 : 0));
      var hello = h("div", { class: "hello" },
        h("h1", { text: "Привет, " + d.staff.name + "!" }),
        h("p", { class: "muted", text: d.venue.name + " · " + d.staff.role }));
      var main = h("div", { class: "card warm" + (st.done_today ? " done" : "") },
        h("span", { class: "label", text: st.done_today ? "Сегодня разминка пройдена ✓" : "Разминка перед сменой" }),
        h("h2", { text: items.length ? size + " " + PD.plural(size, "вопрос", "вопроса", "вопросов") + " по меню и " + (d.staff.is_newbie ? "две ситуации" : "ситуация") + " из зала" : "Ситуации из зала" }),
        h("p", { class: "muted", text: items.length ? "Около пяти минут. Ошибки вернутся в следующих разминках, пока не закрепятся." : "Меню заведения ещё не проверено управляющим, поэтому пока только ситуации." }),
        h("a", { class: "btn primary wide", href: "#/s/warmup", text: st.done_today ? "Пройти ещё раз" : "Начать разминку" }));
      var stats = h("div", { class: "stats" },
        stat("Готовность по меню", st.readiness + "%", d.staff.is_newbie ? "цель новичка — 80%" : "держим выше 80%"),
        stat("Серия", st.streak + " " + PD.plural(st.streak, "день", "дня", "дней"), "дней подряд с тренировкой"),
        stat("Точность за неделю", st.accuracy_7d != null ? st.accuracy_7d + "%" : "—", "правильных ответов"));
      var newbie = d.staff.is_newbie ? h("div", { class: "notice" },
        h("b", { text: "Трек новичка. " }),
        st.readiness >= 80 ? "Вы знаете меню на " + st.readiness + "% — управляющий увидит, что вы готовы к смене." :
          "Проходите разминку каждый день: каждую позицию нужно правильно ответить три раза в разные дни. Сейчас " + st.readiness + "%.") : null;
      var more = h("div", { class: "tiles" },
        h("a", { class: "tile", href: "#/s/cases" }, h("b", { text: "Ситуации из зала" }), h("span", { class: "muted small", text: "Жалоба, аллергия, долгое ожидание — как ответить" })),
        h("a", { class: "tile", href: "#/s/study" }, h("b", { text: "Учить меню" }), h("span", { class: "muted small", text: items.length + " " + PD.plural(items.length, "позиция", "позиции", "позиций") + " с составом и аллергенами" })),
        h("a", { class: "tile", href: "#/s/guest" }, h("b", { text: "✦ ИИ-гость" }), h("span", { class: "muted small", text: "Живой диалог с «гостем» по вашему меню и оценка ответов" })));
      var tipBox = h("div");
      if (PD.mentorTip) PD.mentorTip(T.token, tipBox);
      PD.mount(staffPage(d.venue.name, [hello, main, tipBox, newbie, stats, more,
        h("p", { class: "muted small center" }, h("a", { href: "#/s/logout", text: "Выйти на этом устройстве" }))]));
    }).catch(function (e) { if (e.hint !== "auth") PD.fatal(e); });
    function stat(label, value, sub) { return h("div", { class: "stat" }, h("span", { class: "label", text: label }), h("b", { text: value }), h("span", { class: "muted small", text: sub })); }
  });

  PD.route("/s/logout", function () {
    PD.confirm("Выйти", "На этом устройстве вход пропадёт. Вернуться можно по ссылке-приглашению или личной ссылке от управляющего.", "Выйти", function () {
      setToken(null); PD.go("/");
    });
    if (T.token) PD.go("/s");
  });

  // ------------------------------------------------------------ тренировки
  function training(kind) {
    if (!T.token) { lostLink(); return; }
    PD.mount(PD.loading());
    var p = T.home ? Promise.resolve(T.home) : loadHome();
    p.then(function (d) {
      var qs;
      if (kind === "warmup") {
        var size = Math.min(10, d.venue.warmup_size + (d.staff.is_newbie ? 3 : 0));
        qs = PD.buildWarmup(d.items, d.progress, d.today, size, d.venue.modules, d.recent_cases, d.items.length ? (d.staff.is_newbie ? 2 : 1) : 5);
      } else {
        qs = PD.pickCases(d.venue.modules, 5, d.recent_cases).map(PD.caseQuestion);
      }
      var box = h("div");
      PD.mount(staffPage(kind === "warmup" ? "Разминка" : "Ситуации из зала", box, "#/s"));
      PD.runQuiz(box, qs, { onFinish: function (res) { finish(kind, res, box); } });
    }).catch(function (e) { if (e.hint !== "auth") PD.fatal(e); });
  }
  function finish(kind, res, box) {
    var s = PD.quizSummary(res);
    var answers = res.map(function (r) { return { item_id: r.item_id || null, case_id: r.case_id || null, qtype: r.qtype, question: r.question, correct: r.correct }; });
    var saved = h("p", { class: "muted small", role: "status", text: "Сохраняю результат…" });
    box.textContent = "";
    box.appendChild(h("div", { class: "card result" },
      h("span", { class: "label", text: kind === "warmup" ? "Разминка завершена" : "Тренировка завершена" }),
      h("div", { class: "score", text: s.ok + " из " + s.total }),
      h("p", { text: s.ok === s.total ? "Отлично! Так держать." : "Ошибки вернутся в следующих разминках, пока не закрепятся." }),
      s.wrong.length ? h("div", { class: "mistakes" }, h("h3", { text: "Разбор ошибок" }), h("ul", { class: "plain" }, s.wrong.map(function (x) {
        return h("li", null, h("b", { text: x.r.question }));
      }))) : null,
      saved,
      h("div", { class: "row" }, h("a", { class: "btn primary", href: "#/s", text: "На главную" }), h("a", { class: "btn ghost", href: "#/s/study", text: "Учить меню" }))));
    T.home = null;
    staffApi("pd_staff_submit", { p_kind: kind, p_answers: answers }).then(function (r) {
      saved.textContent = "Результат сохранён · готовность по меню " + r.readiness + "% · серия " + r.streak + " " + PD.plural(r.streak, "день", "дня", "дней");
    }).catch(function (e) {
      if (e.network) {
        var list = pending(); list.push({ kind: kind, answers: answers }); savePending(list);
        saved.textContent = "Нет интернета — результат отправится автоматически, когда связь появится.";
      } else if (e.hint !== "auth") { saved.textContent = e.message; }
    });
  }
  PD.route("/s/warmup", function () { training("warmup"); });
  PD.route("/s/cases", function () { training("cases"); });

  // ------------------------------------------------------------ учить меню
  PD.route("/s/study", function () {
    if (!T.token) { lostLink(); return; }
    PD.mount(PD.loading());
    (T.home ? Promise.resolve(T.home) : loadHome()).then(function (d) {
      var q = "";
      var list = h("div", { class: "study" });
      var search = h("input", { type: "search", placeholder: "Найти блюдо или продукт", "aria-label": "Поиск по меню", oninput: function (e) { q = PD.norm(e.target.value); draw(); } });
      var prog = {};
      d.progress.forEach(function (p) { prog[p.item_id] = p; });
      function draw() {
        list.textContent = "";
        var cats = {}, order = [];
        d.items.forEach(function (it) {
          if (q && PD.norm(it.name + " " + it.category + " " + (it.ingredients || []).join(" ") + " " + (it.allergens || []).join(" ") + " " + it.description).indexOf(q) < 0) return;
          var c = it.category || "Меню";
          if (!cats[c]) { cats[c] = []; order.push(c); }
          cats[c].push(it);
        });
        if (!order.length) { list.appendChild(h("p", { class: "muted pad", text: d.items.length ? "Ничего не найдено" : "Управляющий ещё не проверил меню." })); return; }
        order.forEach(function (c) {
          list.appendChild(h("h3", { class: "cat", text: c }));
          cats[c].forEach(function (it) {
            var p = prog[it.id];
            var level = p ? Math.min(3, p.box) : 0;
            list.appendChild(h("div", { class: "card dish" },
              h("div", { class: "item-title" }, h("b", { text: it.name }), it.portion ? h("span", { class: "muted", text: " · " + it.portion }) : null,
                it.price != null ? h("span", { class: "price", text: PD.fmtPrice(it.price) }) : null),
              it.ingredients && it.ingredients.length ? h("p", { class: "small", text: "Состав: " + it.ingredients.join(", ") }) : null,
              it.description ? h("p", { class: "muted small", text: it.description }) : null,
              h("div", { class: "chips" },
                (it.allergens || []).length ? (it.allergens || []).map(function (a) { return h("span", { class: "chip al", text: a }); }) : h("span", { class: "chip ok", text: "аллергенов не указано" }),
                it.upsell ? h("span", { class: "chip up", text: "предложить: " + it.upsell }) : null,
                h("span", { class: "chip lvl", title: "Как хорошо вы знаете позицию", text: ["новая", "знакомая", "почти выучена", "выучена"][level] }))));
          });
        });
      }
      PD.mount(staffPage("Меню", [h("div", { class: "toolbar" }, search), list], "#/s"));
      draw();
    }).catch(function (e) { if (e.hint !== "auth") PD.fatal(e); });
  });

  // ------------------------------------------------------------ стартовая
  PD.route("/", function () {
    if (PD.ownerToken()) { PD.go("/o"); return; }
    if (T.token) { PD.go("/s"); return; }
    PD.mount(h("main", { class: "page narrow" },
      h("a", { class: "brand big", href: "../", text: "Подача" }),
      h("div", { class: "card" },
        h("h1", { text: "AI-тренер для зала" }),
        h("p", { class: "muted", text: "Ежедневные пятиминутные тренировки персонала по меню вашего заведения." }),
        h("div", { class: "choice" },
          h("a", { class: "tile", href: "#/register" }, h("b", { text: "Я владелец или управляющий" }), h("span", { class: "muted small", text: "Загрузить меню, пригласить команду, смотреть отчёты" })),
          h("a", { class: "tile", href: "#/login" }, h("b", { text: "Войти в кабинет" }), h("span", { class: "muted small", text: "У меня уже есть аккаунт" })),
          h("a", { class: "tile", href: "#/code" }, h("b", { text: "Я сотрудник" }), h("span", { class: "muted small", text: "У меня есть код приглашения" }))))));
  });

  window.addEventListener("online", function () { flushPending(); });
})();
