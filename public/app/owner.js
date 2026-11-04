/* «Подача» — кабинет владельца: вход, меню, команда, отчёт, настройки. */
(function () {
  "use strict";
  var PD = window.PD, h = PD.h;
  var KIND = { cafe: "Кафе", bar: "Бар", hookah: "Кальянная / лаунж", restaurant: "Ресторан" };
  var MODULES = { service: "Сервис в зале", bar: "Бар", hookah: "Кальян" };

  var S = { token: PD.store.get("pd_owner"), me: null };

  function ownerApi(fn, args) {
    return PD.api(fn, Object.assign({ p_token: S.token }, args || {})).catch(function (e) {
      if (e.hint === "auth") { setToken(null); PD.toast(e.message, "bad"); PD.go("/login"); }
      throw e;
    });
  }
  function setToken(t) { S.token = t; S.me = null; PD.store.set("pd_owner", t); }
  function fail(e) { if (e && e.hint !== "auth") PD.toast(e.message || "Ошибка", "bad"); }
  PD.ownerToken = function () { return S.token; };

  function loadMe(force) {
    if (S.me && !force) return Promise.resolve(S.me);
    return ownerApi("pd_owner_me").then(function (me) { S.me = me; return me; });
  }
  function venueById(id) {
    return (S.me && S.me.venues || []).filter(function (v) { return v.id === id; })[0];
  }
  function inviteUrl(code) { return location.origin + location.pathname + "#/join/" + code; }
  PD.inviteUrl = inviteUrl;

  // ------------------------------------------------------------ оболочка
  function shell(venue, tab, body) {
    var tabs = [["menu", "Меню"], ["team", "Команда"], ["report", "Отчёт"], ["agents", "✦ Агенты"], ["settings", "Настройки"]];
    var venues = S.me ? S.me.venues : [];
    var pickerNode = venues.length > 1 ? h("select", { class: "venue-select", "aria-label": "Заведение", onchange: function (e) {
      if (e.target.value === "__new") PD.go("/o/new"); else PD.go("/o/v/" + e.target.value + "/" + tab);
    } }, venues.map(function (v) { return h("option", { value: v.id, selected: v.id === venue.id ? "selected" : null, text: v.name }); }),
      h("option", { value: "__new", text: "+ Новое заведение" })) : h("span", { class: "venue-name", text: venue.name });
    return h("div", { class: "shell" },
      h("header", { class: "topbar" },
        h("div", { class: "wrap topbar-in" },
          h("a", { class: "brand", href: "#/o", text: "Подача" }),
          pickerNode),
        h("nav", { class: "wrap tabs", "aria-label": "Разделы" },
          tabs.map(function (t) {
            return h("a", { href: "#/o/v/" + venue.id + "/" + t[0], class: "tab" + (t[0] === tab ? " on" : ""), "aria-current": t[0] === tab ? "page" : null, text: t[1] });
          }))),
      h("main", { class: "wrap page", id: "main" }, body));
  }

  function withVenue(params, tab, render) {
    if (!S.token) { PD.go("/login"); return; }
    PD.mount(PD.loading());
    loadMe(true).then(function () {
      var v = venueById(params.id);
      if (!v) { PD.go("/o"); return; }
      var body = h("div", null, PD.loading());
      PD.mount(shell(v, tab, body));
      render(v, body);
    }).catch(function (e) { if (e.hint !== "auth") PD.fatal(e); });
  }

  // ------------------------------------------------------------ вход и регистрация
  function authPage(mode) {
    if (S.token) { PD.go("/o"); return; }
    var email = h("input", { type: "email", id: "email", autocomplete: "username", required: true, placeholder: "you@example.ru" });
    var pass = h("input", { type: "password", id: "password", autocomplete: mode === "login" ? "current-password" : "new-password", required: true, minlength: "8" });
    var name = h("input", { type: "text", id: "name", autocomplete: "name", placeholder: "Как к вам обращаться" });
    var err = h("p", { class: "form-err", role: "alert" });
    var btn = h("button", { class: "btn primary wide", type: "submit", text: mode === "login" ? "Войти" : "Создать аккаунт" });
    var form = h("form", { class: "card form", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      err.textContent = "";
      if (!email.value || !pass.value) { err.textContent = "Заполните почту и пароль"; return; }
      btn.disabled = true;
      var call = mode === "login"
        ? PD.api("pd_owner_login", { p_email: email.value, p_password: pass.value })
        : PD.api("pd_owner_register", { p_email: email.value, p_password: pass.value, p_name: name.value });
      call.then(function (r) {
        if (r && r.error) { err.textContent = r.error; btn.disabled = false; return; }
        setToken(r.token);
        PD.go("/o");
      }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; });
    } },
      h("h1", { text: mode === "login" ? "Вход для владельца" : "Регистрация заведения" }),
      h("p", { class: "muted", text: mode === "login" ? "Кабинет владельца или управляющего: меню, команда, отчёты." : "Две минуты — и можно загружать меню и приглашать команду." }),
      mode === "register" ? h("label", { for: "name" }, "Имя", name) : null,
      h("label", { for: "email" }, "Почта", email),
      h("label", { for: "password" }, mode === "login" ? "Пароль" : "Пароль (от 8 символов)", pass),
      err, btn,
      h("p", { class: "muted small center" }, mode === "login"
        ? ["Нет аккаунта? ", h("a", { href: "#/register", text: "Зарегистрироваться" })]
        : ["Уже есть аккаунт? ", h("a", { href: "#/login", text: "Войти" })]),
      h("p", { class: "muted small center" }, ["Вы сотрудник? Откройте ссылку-приглашение от управляющего или ", h("a", { href: "#/code", text: "введите код" })]));
    PD.mount(h("main", { class: "page narrow" }, h("a", { class: "brand big", href: "#/", text: "Подача" }), form));
  }
  PD.route("/login", function () { authPage("login"); });
  PD.route("/register", function () { authPage("register"); });

  // ------------------------------------------------------------ список заведений / создание
  PD.route("/o", function () {
    if (!S.token) { PD.go("/login"); return; }
    PD.mount(PD.loading());
    loadMe(true).then(function (me) {
      if (!me.venues.length) { PD.go("/o/new"); return; }
      var last = PD.store.get("pd_last_venue");
      var v = venueById(last) || me.venues[0];
      PD.go("/o/v/" + v.id + "/menu");
    }).catch(function (e) { if (e.hint !== "auth") PD.fatal(e); });
  });

  PD.route("/o/new", function () {
    if (!S.token) { PD.go("/login"); return; }
    var name = h("input", { type: "text", id: "vname", required: true, maxlength: "80", placeholder: "Например, Смок Дог" });
    var kind = h("select", { id: "vkind" }, Object.keys(KIND).map(function (k) { return h("option", { value: k, text: KIND[k] }); }));
    var err = h("p", { class: "form-err", role: "alert" });
    var btn = h("button", { class: "btn primary wide", type: "submit", text: "Создать" });
    PD.mount(h("main", { class: "page narrow" }, h("a", { class: "brand big", href: "#/o", text: "Подача" }),
      h("form", { class: "card form", onsubmit: function (e) {
        e.preventDefault();
        btn.disabled = true;
        ownerApi("pd_venue_create", { p_name: name.value, p_kind: kind.value }).then(function (v) {
          S.me = null;
          PD.store.set("pd_last_venue", v.id);
          PD.go("/o/v/" + v.id + "/menu");
        }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; });
      } },
        h("h1", { text: "Ваше заведение" }),
        h("p", { class: "muted", text: "От формата зависят ситуации из зала в тренировках: сервис, бар, кальян. Потом можно поменять в настройках." }),
        h("label", { for: "vname" }, "Название", name),
        h("label", { for: "vkind" }, "Формат", kind),
        err, btn)));
  });

  // ------------------------------------------------------------ меню
  function chip(text, cls) { return h("span", { class: "chip " + (cls || ""), text: text }); }

  function menuView(v, body) {
    PD.store.set("pd_last_venue", v.id);
    ownerApi("pd_menu_get", { p_venue: v.id }).then(function (items) {
      var q = "";
      var unconfirmed = items.filter(function (i) { return !i.confirmed; }).length;
      var filter = PD.store.get("pd_menu_filter") || "all";
      if (filter === "todo" && !unconfirmed) { filter = "all"; PD.store.set("pd_menu_filter", "all"); }
      var listBox = h("div", { class: "menu-list" });
      var search = h("input", { type: "search", placeholder: "Найти позицию", "aria-label": "Поиск по меню", oninput: function (e) { q = PD.norm(e.target.value); draw(); } });
      var filterSel = h("div", { class: "seg", role: "group", "aria-label": "Фильтр" }, [["all", "Все"], ["todo", "Проверить"], ["ok", "Проверенные"]].map(function (f) {
        return h("button", { type: "button", class: f[0] === filter ? "on" : "", "aria-pressed": String(f[0] === filter), text: f[1], onclick: function () {
          filter = f[0]; PD.store.set("pd_menu_filter", filter);
          Array.prototype.forEach.call(filterSel.children, function (b) { b.className = b.textContent === f[1] ? "on" : ""; b.setAttribute("aria-pressed", String(b.textContent === f[1])); });
          draw();
        } });
      }));
      function draw() {
        listBox.textContent = "";
        var shown = items.filter(function (it) {
          if (filter === "todo" && it.confirmed) return false;
          if (filter === "ok" && !it.confirmed) return false;
          if (q && PD.norm(it.name + " " + it.category + " " + it.description + " " + (it.ingredients || []).join(" ")).indexOf(q) < 0) return false;
          return true;
        });
        if (!shown.length) { listBox.appendChild(h("p", { class: "muted pad", text: items.length ? "Ничего не найдено" : "Меню пока пустое" })); return; }
        var cats = {};
        var order = [];
        shown.forEach(function (it) { var c = it.category || "Без раздела"; if (!cats[c]) { cats[c] = []; order.push(c); } cats[c].push(it); });
        order.forEach(function (c) {
          listBox.appendChild(h("h3", { class: "cat", text: c + " · " + cats[c].length }));
          cats[c].forEach(function (it) {
            listBox.appendChild(h("div", { class: "item" + (it.confirmed ? "" : " todo") },
              h("div", { class: "item-main" },
                h("div", { class: "item-title" }, h("b", { text: it.name }),
                  it.portion ? h("span", { class: "muted", text: " · " + it.portion }) : null,
                  it.price != null ? h("span", { class: "price", text: PD.fmtPrice(it.price) }) : null),
                it.ingredients && it.ingredients.length ? h("div", { class: "muted small", text: it.ingredients.join(", ") }) :
                  (it.description ? h("div", { class: "muted small", text: it.description }) : h("div", { class: "muted small warn-text", text: "Состав не указан — вопросов по составу не будет" })),
                h("div", { class: "chips" },
                  (it.allergens || []).map(function (a) { return chip(a, "al"); }),
                  it.upsell ? chip("к позиции: " + it.upsell, "up") : null,
                  it.confirmed ? chip("проверено", "ok") : chip("нужно проверить", "todo"))),
              h("button", { class: "btn small ghost", type: "button", text: "Изменить", "aria-label": "Изменить «" + it.name + "»", onclick: function () { editItem(v, it, items, reload); } })));
          });
        });
      }
      function reload() { menuView(v, body); }
      body.textContent = "";
      if (!items.length) {
        body.appendChild(onboarding(v));
        return;
      }
      body.appendChild(h("div", { class: "page-head" },
        h("div", null, h("h1", { text: "Меню" }),
          h("p", { class: "muted", text: items.length + " " + PD.plural(items.length, "позиция", "позиции", "позиций") + " · проверено " + (items.length - unconfirmed) + ". Команда тренируется только по проверенным позициям." })),
        h("div", { class: "row" },
          h("a", { class: "btn", href: "#/o/v/" + v.id + "/import", text: "Загрузить меню" }),
          h("button", { class: "btn", type: "button", text: "Добавить позицию", onclick: function () { editItem(v, null, items, reload); } }),
          h("a", { class: "btn ghost", href: "#/o/v/" + v.id + "/try", text: "Пройти разминку" }))));
      if (unconfirmed) {
        body.appendChild(h("div", { class: "notice" },
          h("div", null, h("b", { text: "Проверьте " + unconfirmed + " " + PD.plural(unconfirmed, "позицию", "позиции", "позиций") + "." }),
            " Особенно аллергены: часть из них определена автоматически по составу. Пока позиция не проверена, она не попадает в тренировки."),
          h("button", { class: "btn primary", type: "button", text: "Всё верно — подтвердить все", onclick: function () {
            PD.confirm("Подтвердить меню", "Состав, цены и аллергены всех " + unconfirmed + " позиций проверены? После этого команда начнёт по ним тренироваться.", "Подтвердить", function () {
              ownerApi("pd_menu_confirm", { p_venue: v.id, p_ids: null, p_value: true }).then(function () { PD.store.set("pd_menu_filter", "all"); PD.toast("Меню подтверждено. Теперь пригласите команду"); reload(); }).catch(fail);
            });
          } })));
      }
      body.appendChild(h("div", { class: "toolbar" }, search, filterSel));
      body.appendChild(listBox);
      draw();
    }).catch(fail);
  }

  function onboarding(v) {
    return h("div", { class: "onboard" },
      h("h1", { text: "Три шага до первой тренировки" }),
      h("ol", { class: "steps-list" },
        h("li", null, h("b", { text: "Загрузите меню." }), " Вставьте текст меню, загрузите таблицу или начните с демо-меню."),
        h("li", null, h("b", { text: "Проверьте состав и аллергены." }), " Без вашей проверки к команде ничего не уходит."),
        h("li", null, h("b", { text: "Пригласите команду." }), " Сотрудник открывает ссылку на телефоне, пишет имя — и сразу проходит разминку.")),
      h("div", { class: "row" },
        h("a", { class: "btn primary", href: "#/o/v/" + v.id + "/import", text: "Загрузить меню" }),
        h("a", { class: "btn ghost", href: "#/o/v/" + v.id + "/team", text: "Сначала пригласить команду" })));
  }

  function editItem(v, it, items, done) {
    var isNew = !it;
    it = it || { category: "", name: "", price: null, portion: "", ingredients: [], allergens: [], description: "", upsell: "", confirmed: true };
    var cats = [];
    items.forEach(function (x) { if (x.category && cats.indexOf(x.category) < 0) cats.push(x.category); });
    var f = {
      category: h("input", { id: "f-cat", list: "f-cats", value: it.category, maxlength: "80" }),
      name: h("input", { id: "f-name", value: it.name, maxlength: "120", required: true }),
      price: h("input", { id: "f-price", inputmode: "decimal", value: it.price != null ? String(Number(it.price)) : "" }),
      portion: h("input", { id: "f-portion", value: it.portion, maxlength: "40", placeholder: "250 г, 0,5 л" }),
      ingredients: h("textarea", { id: "f-ing", rows: "2", value: (it.ingredients || []).join(", "), placeholder: "через запятую" }),
      description: h("textarea", { id: "f-desc", rows: "2", value: it.description, maxlength: "600" }),
      upsell: h("input", { id: "f-up", value: it.upsell, maxlength: "200", placeholder: "Например: бокал белого вина" }),
      confirmed: h("input", { type: "checkbox", id: "f-ok", checked: true }),
      custom: h("input", { id: "f-al-custom", placeholder: "другие через запятую" })
    };
    var current = (it.allergens || []).map(PD.norm);
    var std = PD.ALLERGENS.map(function (a) { return a.key; });
    var boxes = PD.ALLERGENS.map(function (a) {
      var cb = h("input", { type: "checkbox", value: a.key, checked: current.indexOf(a.key) >= 0 });
      return h("label", { class: "check" }, cb, " " + a.key);
    });
    f.custom.value = current.filter(function (a) { return std.indexOf(a) < 0; }).join(", ");
    var suggest = h("button", { class: "btn small ghost", type: "button", text: "Определить по составу", onclick: function () {
      var found = PD.detectAllergens({ name: f.name.value, description: f.description.value, ingredients: f.ingredients.value.split(",") });
      boxes.forEach(function (lb) { var cb = lb.querySelector("input"); if (found.indexOf(cb.value) >= 0) cb.checked = true; });
      PD.toast(found.length ? "Отмечено: " + found.join(", ") + ". Проверьте!" : "По составу аллергенов не нашлось");
    } });
    var form = h("div", { class: "form grid2" },
      h("datalist", { id: "f-cats" }, cats.map(function (c) { return h("option", { value: c }); })),
      h("label", { for: "f-name", class: "span2" }, "Название", f.name),
      h("label", { for: "f-cat" }, "Раздел меню", f.category),
      h("label", { for: "f-price" }, "Цена, ₽", f.price),
      h("label", { for: "f-portion" }, "Выход / объём", f.portion),
      h("label", { for: "f-up" }, "Что предложить к позиции", f.upsell),
      h("label", { for: "f-ing", class: "span2" }, "Состав", f.ingredients),
      h("fieldset", { class: "span2 allergens" }, h("legend", { text: "Аллергены" }), h("div", { class: "checks" }, boxes), f.custom, suggest),
      h("label", { for: "f-desc", class: "span2" }, "Описание для гостя", f.description),
      h("label", { class: "check span2" }, f.confirmed, " Проверено — можно использовать в тренировках"));
    var actions = [];
    if (!isNew) actions.push({ text: "Удалить", kind: "danger left", keep: true, onclick: function (close) {
      PD.confirm("Удалить позицию", "Удалить «" + it.name + "» из меню?", "Удалить", function () {
        ownerApi("pd_menu_item_delete", { p_venue: v.id, p_item: it.id }).then(function () { close(); PD.toast("Удалено"); done(); }).catch(fail);
      }, true);
      return false;
    } });
    actions.push({ text: "Отмена", kind: "ghost" });
    actions.push({ text: "Сохранить", kind: "primary", keep: true, onclick: function (close) {
      if (!f.name.value.trim()) { PD.toast("Укажите название", "bad"); return false; }
      var al = boxes.map(function (lb) { return lb.querySelector("input"); }).filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; })
        .concat(f.custom.value.split(",").map(function (s) { return PD.norm(s); }).filter(Boolean));
      var payload = { id: it.id || null, name: f.name.value, category: f.category.value, price: f.price.value, portion: f.portion.value,
        ingredients: f.ingredients.value.split(/\s*[,;]\s*/).filter(Boolean), allergens: al, description: f.description.value,
        upsell: f.upsell.value, confirmed: f.confirmed.checked };
      ownerApi("pd_menu_item_save", { p_venue: v.id, p_item: payload }).then(function () { close(); PD.toast("Сохранено"); done(); }).catch(fail);
      return false;
    } });
    PD.modal(isNew ? "Новая позиция" : "Позиция меню", form, actions);
  }

  // ------------------------------------------------------------ загрузка меню
  function importView(v, body) {
    var parsed = [];
    var auto = h("input", { type: "checkbox", id: "auto-al", checked: true });
    var preview = h("div", { class: "preview" });
    var status = h("p", { class: "muted", role: "status" });
    var tabsBox = h("div", { class: "seg", role: "tablist" });
    var panel = h("div", { class: "card" });
    var current = "text";

    function setParsed(list, source) {
      parsed = list;
      preview.textContent = "";
      if (!list.length) { status.textContent = "Не удалось найти позиции. Проверьте формат или вставьте текст по образцу."; return; }
      status.textContent = "Найдено " + list.length + " " + PD.plural(list.length, "позиция", "позиции", "позиций") + (source ? " · " + source : "") + ". Проверьте перед загрузкой:";
      var table = h("table", { class: "table" },
        h("thead", null, h("tr", null, ["Раздел", "Название", "Цена", "Выход", "Состав", "Аллергены"].map(function (t) { return h("th", { text: t }); }))),
        h("tbody", null, list.slice(0, 80).map(function (it) {
          return h("tr", null, h("td", { text: it.category }), h("td", { text: it.name }), h("td", { text: it.price != null ? PD.fmtPrice(it.price) : "—" }),
            h("td", { text: it.portion || "" }), h("td", { text: (it.ingredients || []).join(", ") || it.description || "" }),
            h("td", null, (it.allergens || []).map(function (a) { return chip(a, it._autoAllergens ? "al auto" : "al"); })));
        })));
      var replace = h("input", { type: "checkbox", id: "replace", checked: v.items > 0 ? false : null });
      preview.appendChild(h("div", { class: "table-box" }, table));
      if (list.length > 80) preview.appendChild(h("p", { class: "muted small", text: "Показаны первые 80, загрузятся все." }));
      if (v.items > 0) preview.appendChild(h("label", { class: "check" }, replace, " Заменить текущее меню (" + v.items + " поз.). Иначе позиции добавятся к существующим."));
      preview.appendChild(h("button", { class: "btn primary", type: "button", text: "Загрузить " + list.length + " " + PD.plural(list.length, "позицию", "позиции", "позиций"), onclick: function (e) {
        e.target.disabled = true;
        var payload = parsed.map(function (it) {
          return { category: it.category, name: it.name, description: it.description, ingredients: it.ingredients, allergens: it.allergens,
            price: it.price, portion: it.portion, upsell: it.upsell || "" };
        });
        ownerApi("pd_menu_import", { p_venue: v.id, p_items: payload, p_replace: !!replace.checked }).then(function (r) {
          PD.toast("Загружено позиций: " + r.imported);
          PD.store.set("pd_menu_filter", "todo");
          PD.go("/o/v/" + v.id + "/menu");
        }).catch(function (err) { fail(err); e.target.disabled = false; });
      } }));
    }

    var PANELS = {
      text: function () {
        var ta = h("textarea", { rows: "12", id: "menu-text", placeholder: "САЛАТЫ\nЦезарь с курицей 690\nромано, курица, пармезан, гренки, соус цезарь\nГреческий салат — томаты, огурцы, фета, оливки — 590\n\nНАПИТКИ\nЛимонад маракуйя 1 л ...... 690" });
        return [h("p", { class: "muted", text: "Скопируйте меню из PDF, с сайта или из документа. Разделы — отдельной строкой, у позиции цена в конце строки, состав — на строке ниже или через тире." }),
          h("label", { for: "menu-text" }, "Текст меню", ta),
          h("button", { class: "btn primary", type: "button", text: "Разобрать", onclick: function () { setParsed(PD.parseMenuText(ta.value, auto.checked), "из текста"); } })];
      },
      file: function () {
        var inp = h("input", { type: "file", id: "menu-file", accept: ".csv,.txt,.json,.xlsx,.xls,text/csv,application/json" });
        inp.addEventListener("change", function () {
          var file = inp.files && inp.files[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) { PD.toast("Файл больше 5 МБ", "bad"); return; }
          var name = file.name.toLowerCase();
          status.textContent = "Читаю файл…";
          if (/\.xlsx?$/.test(name)) {
            PD.loadXLSX().then(function (X) {
              return file.arrayBuffer().then(function (buf) {
                var wb = X.read(buf, { type: "array" });
                var ws = wb.Sheets[wb.SheetNames[0]];
                setParsed(PD.parseRows(X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }), auto.checked), file.name);
              });
            }).catch(function () { status.textContent = "Не удалось открыть Excel. Сохраните файл как CSV (Файл → Сохранить как → CSV UTF-8) и загрузите снова."; });
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            var text = String(reader.result || "");
            if (/\.json$/.test(name)) {
              try { setParsed(PD.parseJSONMenu(JSON.parse(text), auto.checked), file.name); } catch (e) { status.textContent = "Файл JSON не читается"; }
            } else if (/\.csv$/.test(name) || /[;\t]/.test(text.split("\n")[0])) {
              setParsed(PD.parseRows(PD.parseCSV(text), auto.checked), file.name);
            } else { setParsed(PD.parseMenuText(text, auto.checked), file.name); }
          };
          reader.readAsText(file, "utf-8");
        });
        return [h("p", { class: "muted", text: "Таблица Excel или CSV: первая строка — заголовки. Понимаем колонки «Раздел», «Название», «Состав», «Аллергены», «Цена», «Выход», «Описание», «Что предложить»." }),
          h("label", { for: "menu-file", class: "file" }, "Выберите файл", inp),
          h("button", { class: "btn small ghost", type: "button", text: "Скачать образец таблицы", onclick: function () {
            var csv = "﻿Раздел;Название;Состав;Аллергены;Цена;Выход;Что предложить\nСалаты;Цезарь с курицей;романо, курица, пармезан, гренки, соус цезарь;молоко, рыба, яйца, глютен;690;250 г;Лимонад\n";
            var a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: "podacha_menu_obrazec.csv" });
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
          } })];
      },
      site: function () {
        var url = h("input", { type: "url", id: "menu-url", placeholder: "https://…/menu.json" });
        function load(u) {
          status.textContent = "Загружаю…";
          fetch(u).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
            .then(function (data) { setParsed(PD.parseJSONMenu(data, auto.checked), u.replace(/^https?:\/\//, "")); })
            .catch(function () { status.textContent = "Не удалось загрузить меню по ссылке. Нужен файл меню в формате JSON с разрешённым доступом. Можно скопировать меню с сайта текстом."; });
        }
        return [h("p", { class: "muted", text: "Если меню на сайте отдаётся файлом JSON, вставьте ссылку на него." }),
          h("label", { for: "menu-url" }, "Ссылка на JSON-меню", url),
          h("div", { class: "row" },
            h("button", { class: "btn primary", type: "button", text: "Загрузить", onclick: function () { if (url.value) load(url.value); } }),
            h("button", { class: "btn ghost", type: "button", text: "Меню Smoke Dog (sd.msk.ru)", onclick: function () { url.value = "https://sd.msk.ru/restaurant.json"; load(url.value); } }))];
      },
      demo: function () {
        return [h("p", { class: "muted", text: "Вымышленное меню лаунж-бара: 18 позиций с составом, аллергенами и допродажами. Подходит, чтобы посмотреть, как работают тренировки, до загрузки своего меню." }),
          h("button", { class: "btn primary", type: "button", text: "Показать демо-меню", onclick: function () {
            setParsed(window.PD_CONTENT.DEMO_MENU.map(function (x) { return JSON.parse(JSON.stringify(x)); }), "демо");
          } })];
      }
    };
    function show(key) {
      current = key;
      Array.prototype.forEach.call(tabsBox.children, function (b) { b.className = b.dataset.k === key ? "on" : ""; b.setAttribute("aria-selected", String(b.dataset.k === key)); });
      panel.textContent = "";
      PD.add(panel, PANELS[key]());
    }
    [["text", "Вставить текст"], ["file", "Файл"], ["site", "По ссылке"], ["demo", "Демо-меню"]].forEach(function (t) {
      var b = h("button", { type: "button", role: "tab", text: t[1], onclick: function () { show(t[0]); } });
      b.dataset.k = t[0];
      tabsBox.appendChild(b);
    });
    body.textContent = "";
    body.appendChild(h("div", { class: "page-head" }, h("div", null, h("h1", { text: "Загрузка меню" }),
      h("p", { class: "muted", text: "После загрузки проверьте состав и аллергены — без вашей проверки позиции не попадут в тренировки." })),
      h("a", { class: "btn ghost", href: "#/o/v/" + v.id + "/menu", text: "← К меню" })));
    body.appendChild(tabsBox);
    body.appendChild(panel);
    body.appendChild(h("label", { class: "check" }, auto, " Подсказать аллергены по составу (их всё равно нужно проверить)"));
    body.appendChild(status);
    body.appendChild(preview);
    show(current);
  }

  // ------------------------------------------------------------ команда
  function teamView(v, body) {
    ownerApi("pd_team_get", { p_venue: v.id }).then(function (staff) {
      body.textContent = "";
      var link = inviteUrl(v.invite_code);
      var qrBox = h("div", { class: "qr" }, PD.qrSvg(link, 168));
      body.appendChild(h("div", { class: "page-head" }, h("div", null, h("h1", { text: "Команда" }),
        h("p", { class: "muted", text: "Сотрудник открывает ссылку или QR-код на телефоне, пишет имя — и сразу попадает в разминку. Ничего устанавливать не нужно." }))));
      body.appendChild(h("div", { class: "card invite" },
        qrBox,
        h("div", { class: "invite-main" },
          h("h2", { text: "Приглашение в «" + v.name + "»" }),
          h("div", { class: "invite-link", text: link }),
          h("p", { class: "muted small" }, "Код для ввода вручную: ", h("b", { class: "code", text: v.invite_code })),
          h("div", { class: "row" },
            h("button", { class: "btn primary", type: "button", text: "Скопировать ссылку", onclick: function () { PD.copy(link); } }),
            navigator.share ? h("button", { class: "btn", type: "button", text: "Поделиться", onclick: function () {
              navigator.share({ title: "Подача — " + v.name, text: "Тренировки по меню «" + v.name + "». Откройте ссылку и напишите своё имя:", url: link }).catch(function () {});
            } }) : null,
            h("button", { class: "btn ghost", type: "button", text: "Новая ссылка", onclick: function () {
              PD.confirm("Новая ссылка-приглашение", "Старая ссылка и код перестанут работать для новых сотрудников. Те, кто уже подключился, останутся.", "Создать новую", function () {
                ownerApi("pd_venue_new_invite", { p_venue: v.id }).then(function () { PD.toast("Новая ссылка готова"); PD.dispatch(); }).catch(fail);
              });
            } })),
          h("p", { class: "muted small", text: "Совет: распечатайте QR-код и повесьте в служебном помещении." }))));
      if (!staff.length) {
        body.appendChild(h("p", { class: "muted pad", text: "Пока никто не подключился. Отправьте ссылку команде в рабочий чат." }));
        return;
      }
      var rows = staff.map(function (s) {
        return h("tr", { class: s.active ? "" : "off" },
          h("td", null, h("b", { text: s.name }), h("div", { class: "muted small", text: s.role + (s.active ? "" : " · отключён") })),
          h("td", null, h("div", { class: "meter", title: "Готовность по меню" }, h("i", { style: "width:" + Math.min(100, s.readiness) + "%" })), h("span", { class: "small", text: s.readiness + "%" })),
          h("td", { text: s.trainings_7d ? String(s.trainings_7d) : "—" }),
          h("td", { text: s.accuracy_7d != null ? s.accuracy_7d + "%" : "—" }),
          h("td", { text: s.streak ? s.streak + " " + PD.plural(s.streak, "день", "дня", "дней") : "—" }),
          h("td", { class: "small", text: PD.ago(s.last_training) }),
          h("td", null, h("label", { class: "check small" }, h("input", { type: "checkbox", checked: s.is_newbie, onchange: function (e) {
            ownerApi("pd_staff_update", { p_venue: v.id, p_staff: s.id, p_patch: { is_newbie: e.target.checked } }).then(function () { PD.toast(e.target.checked ? "Отмечен как новичок" : "Снята отметка «новичок»"); }).catch(fail);
          } }), " новичок")),
          h("td", { class: "actions" },
            h("button", { class: "btn small ghost", type: "button", text: "Личная ссылка", onclick: function () {
              PD.confirm("Личная ссылка для «" + s.name + "»", "Создать новую личную ссылку? Пригодится, если сотрудник сменил телефон. На старом устройстве вход перестанет работать.", "Создать", function () {
                ownerApi("pd_staff_new_link", { p_venue: v.id, p_staff: s.id }).then(function (r) {
                  var u = location.origin + location.pathname + "#/s/login/" + r.token;
                  PD.modal("Личная ссылка", h("div", null, h("p", { class: "muted", text: "Отправьте эту ссылку только " + s.name + ". По ней открываются его тренировки." }),
                    h("div", { class: "invite-link", text: u })), [{ text: "Скопировать", kind: "primary", onclick: function () { PD.copy(u); } }]);
                  PD.dispatch();
                }).catch(fail);
              });
            } }),
            h("button", { class: "btn small ghost", type: "button", text: s.active ? "Отключить" : "Вернуть", onclick: function () {
              ownerApi("pd_staff_update", { p_venue: v.id, p_staff: s.id, p_patch: { active: !s.active } }).then(function () { PD.dispatch(); }).catch(fail);
            } })));
      });
      body.appendChild(h("div", { class: "table-box" }, h("table", { class: "table team" },
        h("thead", null, h("tr", null, ["Сотрудник", "Готовность", "Тренировок за 7 дн.", "Точность", "Серия", "Последняя", "", ""].map(function (t) { return h("th", { text: t }); }))),
        h("tbody", null, rows))));
      body.appendChild(h("p", { class: "muted small", text: "Готовность — насколько сотрудник знает проверенные позиции меню: каждую нужно правильно ответить три раза в разные дни." }));
    }).catch(fail);
  }

  // ------------------------------------------------------------ отчёт
  function reportView(v, body) {
    var days = Number(PD.store.get("pd_report_days") || 7);
    ownerApi("pd_report", { p_venue: v.id, p_days: days }).then(function (r) {
      body.textContent = "";
      var period = h("div", { class: "seg", role: "group", "aria-label": "Период" }, [7, 30].map(function (d) {
        return h("button", { type: "button", class: d === days ? "on" : "", "aria-pressed": String(d === days), text: d + " дней", onclick: function () { PD.store.set("pd_report_days", String(d)); PD.dispatch(); } });
      }));
      var delta = r.accuracy != null && r.accuracy_prev != null ? r.accuracy - r.accuracy_prev : null;
      body.appendChild(h("div", { class: "page-head" }, h("div", null, h("h1", { text: "Отчёт" }), h("p", { class: "muted", text: "«" + v.name + "» · последние " + r.days + " " + PD.plural(r.days, "день", "дня", "дней") })), period));
      body.appendChild(h("div", { class: "stats" },
        stat("Занимались", r.staff_trained + " из " + r.staff_total, "сотрудников"),
        stat("Тренировок", String(r.trainings), r.answers + " " + PD.plural(r.answers, "ответ", "ответа", "ответов")),
        stat("Средний балл", r.accuracy != null ? r.accuracy + "%" : "—", delta != null ? (delta >= 0 ? "+" : "") + delta + " п. к прошлому периоду" : "нет данных за прошлый период"),
        stat("Новички", String(r.newbies.length), r.newbies.length ? "готовность в среднем " + Math.round(r.newbies.reduce(function (s, n) { return s + n.readiness; }, 0) / r.newbies.length) + "%" : "нет новичков")));
      var cols = h("div", { class: "two" });
      cols.appendChild(h("div", { class: "card" }, h("h2", { text: "Слабые места в меню" }),
        r.weak_items.length ? h("ul", { class: "plain" }, r.weak_items.map(function (w) {
          return h("li", null, h("b", { text: w.name }), h("span", { class: "muted", text: " · ошибок " + w.wrong + " из " + w.attempts + (w.category ? " · " + w.category : "") }));
        })) : h("p", { class: "muted", text: "Ошибок по меню пока нет — или мало данных." })));
      cols.appendChild(h("div", { class: "card" }, h("h2", { text: "Ситуации, где ошибаются" }),
        r.weak_cases.length ? h("ul", { class: "plain" }, r.weak_cases.map(function (w) {
          return h("li", null, h("b", { text: PD.caseTitle(w.case_id) }), h("span", { class: "muted", text: " · ошибок " + w.wrong + " из " + w.attempts }));
        })) : h("p", { class: "muted", text: "Ошибок в ситуациях нет." })));
      cols.appendChild(h("div", { class: "card" }, h("h2", { text: "Новички" }),
        r.newbies.length ? h("ul", { class: "plain" }, r.newbies.map(function (n) {
          return h("li", null, h("b", { text: n.name }), h("span", { class: "muted", text: " · готовность " + n.readiness + "%" + (n.readiness >= 80 ? " — можно ставить в смену" : "") + " · тренировок " + n.trainings }));
        })) : h("p", { class: "muted", text: "Отметьте новичков на вкладке «Команда»." })));
      cols.appendChild(h("div", { class: "card" }, h("h2", { text: "Не занимались" }),
        r.idle.length ? h("p", { text: r.idle.join(", ") }) : h("p", { class: "muted", text: "Занимались все." }),
        r.leaders.length ? [h("h3", { text: "Активнее всех" }), h("ul", { class: "plain" }, r.leaders.map(function (l) {
          return h("li", null, h("b", { text: l.name }), h("span", { class: "muted", text: " · тренировок " + l.trainings + (l.accuracy != null ? " · точность " + l.accuracy + "%" : "") }));
        }))] : null));
      body.appendChild(cols);
      body.appendChild(h("div", { class: "row" }, h("button", { class: "btn", type: "button", text: "Скопировать отчёт текстом", onclick: function () {
        var lines = ["Отчёт «Подачи» · " + v.name + " · " + r.days + " дн.",
          "Занимались: " + r.staff_trained + " из " + r.staff_total,
          "Тренировок: " + r.trainings + ", средний балл: " + (r.accuracy != null ? r.accuracy + "%" : "—") + (delta != null ? " (" + (delta >= 0 ? "+" : "") + delta + " п.)" : "")];
        if (r.weak_items.length) lines.push("Слабые позиции: " + r.weak_items.slice(0, 5).map(function (w) { return w.name; }).join(", "));
        if (r.weak_cases.length) lines.push("Ситуации с ошибками: " + r.weak_cases.map(function (w) { return PD.caseTitle(w.case_id); }).join(", "));
        if (r.newbies.length) lines.push("Новички: " + r.newbies.map(function (n) { return n.name + " " + n.readiness + "%"; }).join(", "));
        if (r.idle.length) lines.push("Не занимались: " + r.idle.join(", "));
        PD.copy(lines.join("\n"));
      } })));
    }).catch(fail);
    function stat(label, value, sub) { return h("div", { class: "stat" }, h("span", { class: "label", text: label }), h("b", { text: value }), h("span", { class: "muted small", text: sub })); }
  }

  // ------------------------------------------------------------ настройки
  function settingsView(v, body) {
    body.textContent = "";
    var name = h("input", { id: "s-name", value: v.name, maxlength: "80" });
    var kind = h("select", { id: "s-kind" }, Object.keys(KIND).map(function (k) { return h("option", { value: k, selected: k === v.kind ? "selected" : null, text: KIND[k] }); }));
    var size = h("input", { id: "s-size", type: "number", min: "3", max: "10", value: String(v.warmup_size) });
    var mods = Object.keys(MODULES).map(function (k) {
      return h("label", { class: "check" }, h("input", { type: "checkbox", value: k, checked: v.modules.indexOf(k) >= 0 }), " " + MODULES[k]);
    });
    body.appendChild(h("div", { class: "page-head" }, h("h1", { text: "Настройки" })));
    body.appendChild(h("form", { class: "card form", onsubmit: function (e) {
      e.preventDefault();
      var m = mods.map(function (l) { return l.querySelector("input"); }).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      ownerApi("pd_venue_update", { p_venue: v.id, p_patch: { name: name.value, kind: kind.value, warmup_size: size.value, modules: m } })
        .then(function () { PD.toast("Сохранено"); S.me = null; PD.dispatch(); }).catch(fail);
    } },
      h("h2", { text: "Заведение" }),
      h("label", { for: "s-name" }, "Название", name),
      h("label", { for: "s-kind" }, "Формат", kind),
      h("label", { for: "s-size" }, "Вопросов по меню в разминке (3–10). Новичкам — на 3 больше.", size),
      h("fieldset", null, h("legend", { text: "Ситуации из зала в тренировках" }), h("div", { class: "checks" }, mods)),
      h("button", { class: "btn primary", type: "submit", text: "Сохранить" })));
    var oldp = h("input", { type: "password", id: "p-old", autocomplete: "current-password" });
    var newp = h("input", { type: "password", id: "p-new", autocomplete: "new-password", minlength: "8" });
    body.appendChild(h("form", { class: "card form", onsubmit: function (e) {
      e.preventDefault();
      ownerApi("pd_owner_password", { p_old: oldp.value, p_new: newp.value }).then(function () { PD.toast("Пароль изменён"); oldp.value = ""; newp.value = ""; }).catch(fail);
    } },
      h("h2", { text: "Аккаунт" }),
      h("p", { class: "muted", text: "Вы вошли как " + (S.me ? S.me.email : "") }),
      h("label", { for: "p-old" }, "Текущий пароль", oldp),
      h("label", { for: "p-new" }, "Новый пароль", newp),
      h("div", { class: "row" },
        h("button", { class: "btn", type: "submit", text: "Сменить пароль" }),
        h("a", { class: "btn ghost", href: "#/o/new", text: "Добавить заведение" }),
        h("button", { class: "btn ghost", type: "button", text: "Выйти", onclick: function () {
          PD.api("pd_owner_logout", { p_token: S.token }).catch(function () {});
          setToken(null); PD.go("/login");
        } }))));
    body.appendChild(h("p", { class: "muted small", text: "Мы храним почту владельца, имена сотрудников и результаты тренировок. Данные пилота размещены у облачного провайдера Supabase (Франкфурт, ЕС)." }));
  }

  // ------------------------------------------------------------ пробная разминка владельца
  function tryView(v, body) {
    ownerApi("pd_menu_get", { p_venue: v.id }).then(function (items) {
      var ok = items.filter(function (i) { return i.confirmed; });
      body.textContent = "";
      body.appendChild(h("div", { class: "page-head" }, h("div", null, h("h1", { text: "Разминка глазами сотрудника" }),
        h("p", { class: "muted", text: "Так выглядит ежедневная тренировка. Ваши ответы не сохраняются." })),
        h("a", { class: "btn ghost", href: "#/o/v/" + v.id + "/menu", text: "← К меню" })));
      if (!ok.length) body.appendChild(h("div", { class: "notice" }, "Проверенных позиций пока нет, поэтому разминка — только из ситуаций в зале. Подтвердите меню, чтобы появились вопросы по нему."));
      var box = h("div");
      body.appendChild(box);
      var qs = PD.buildWarmup(ok, [], "9999-12-31", v.warmup_size, v.modules, [], ok.length ? 1 : 5);
      PD.runQuiz(box, qs, { onFinish: function (res) {
        var s = PD.quizSummary(res);
        box.textContent = "";
        box.appendChild(h("div", { class: "card result" }, h("span", { class: "label", text: "Результат" }), h("div", { class: "score", text: s.ok + " из " + s.total }),
          h("div", { class: "row" },
            h("button", { class: "btn primary", type: "button", text: "Ещё раз", onclick: function () { PD.dispatch(); } }),
            h("a", { class: "btn ghost", href: "#/o/v/" + v.id + "/team", text: "Пригласить команду" }))));
      } });
    }).catch(fail);
  }

  PD.route("/o/v/:id/menu", function (p) { withVenue(p, "menu", menuView); });
  PD.route("/o/v/:id/import", function (p) { withVenue(p, "menu", importView); });
  PD.route("/o/v/:id/try", function (p) { withVenue(p, "menu", tryView); });
  PD.route("/o/v/:id/team", function (p) { withVenue(p, "team", teamView); });
  PD.route("/o/v/:id/report", function (p) { withVenue(p, "report", reportView); });
  PD.route("/o/v/:id/settings", function (p) { withVenue(p, "settings", settingsView); });
  PD.route("/o/v/:id/agents", function (p) { withVenue(p, "agents", function (v, body) { PD.agentsView(v, body, null); }); });
  PD.route("/o/v/:id/agents/:agent", function (p) { withVenue(p, "agents", function (v, body) { PD.agentsView(v, body, p.agent); }); });
})();
