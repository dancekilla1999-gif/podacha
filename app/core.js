/* «Подача» — ядро: API, DOM-помощники, роутер, разбор меню, генератор вопросов, тренажёр, QR. */
(function () {
  "use strict";

  var CFG = {
    url: "https://qozyihhlocvgpkchyqsp.supabase.co",
    key: "sb_publishable_Us9CgaJDpwIpAHSQYN7QMg_ADy35Uov",
    xlsxLib: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
  };
  var C = window.PD_CONTENT;
  var PD = window.PD = { cfg: CFG };

  // ------------------------------------------------------------ хранилище (с запасным вариантом в памяти)
  var mem = {};
  PD.store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v === null ? (mem[k] || null) : v; } catch (e) { return mem[k] || null; } },
    set: function (k, v) {
      if (v == null) { delete mem[k]; } else { mem[k] = v; }
      try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* приватный режим */ }
    }
  };

  // ------------------------------------------------------------ API
  PD.api = function (fn, args) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);
    return fetch(CFG.url + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { "apikey": CFG.key, "Content-Type": "application/json" },
      body: JSON.stringify(args || {}),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.text().then(function (txt) {
        clearTimeout(timer);
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var err = new Error((data && data.message) || ("Ошибка сервера (" + r.status + ")"));
          err.hint = data && data.hint;
          err.status = r.status;
          throw err;
        }
        return data;
      });
    }, function (e) {
      clearTimeout(timer);
      var err = new Error(e && e.name === "AbortError" ? "Сервер не отвечает. Проверьте интернет и попробуйте ещё раз" : "Нет связи с сервером. Проверьте интернет");
      err.network = true;
      throw err;
    });
  };

  // ------------------------------------------------------------ DOM
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    if (typeof c === "string" || typeof c === "number") { el.appendChild(document.createTextNode(String(c))); return; }
    el.appendChild(c);
  }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "style") el.style.cssText = v;
        else if (k === "value") el.value = v;
        else if (k === "checked") el.checked = !!v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  PD.h = h;
  PD.add = add;

  PD.mount = function (node) {
    var root = document.getElementById("app");
    root.textContent = "";
    add(root, node);
    window.scrollTo(0, 0);
  };

  PD.loading = function (text) {
    return h("div", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), text || "Загружаю…");
  };

  var toastTimer = null;
  PD.toast = function (text, kind) {
    var t = document.getElementById("toast");
    if (!t) { t = h("div", { id: "toast", role: "status", "aria-live": "polite" }); document.body.appendChild(t); }
    t.textContent = text;
    t.className = "show " + (kind || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ""; }, kind === "bad" ? 6000 : 3500);
  };

  // модальное окно; content — узел, actions — [{text, kind, onclick}]
  PD.modal = function (title, content, actions) {
    var back = h("div", { class: "modal-back", role: "dialog", "aria-modal": "true", "aria-label": title });
    function close() { if (back.parentNode) back.parentNode.removeChild(back); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    var box = h("div", { class: "modal" },
      h("div", { class: "modal-head" }, h("h2", { text: title }), h("button", { class: "icon-btn", "aria-label": "Закрыть", onclick: close, text: "×" })),
      h("div", { class: "modal-body" }, content),
      actions && actions.length ? h("div", { class: "modal-actions" }, actions.map(function (a) {
        return h("button", { class: "btn " + (a.kind || ""), type: "button", onclick: function () { var r = a.onclick ? a.onclick(close) : null; if (r !== false && !a.keep) close(); }, text: a.text });
      })) : null);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    back.appendChild(box);
    document.body.appendChild(back);
    document.addEventListener("keydown", onKey);
    var f = box.querySelector("input, textarea, select, .btn.primary");
    if (f) setTimeout(function () { f.focus(); }, 30);
    return close;
  };

  PD.confirm = function (title, text, okText, onOk, danger) {
    PD.modal(title, h("p", { text: text }), [
      { text: "Отмена", kind: "ghost" },
      { text: okText || "Да", kind: danger ? "danger" : "primary", onclick: function () { onOk(); } }
    ]);
  };

  PD.copy = function (text) {
    function fallback() {
      var ta = h("textarea", { style: "position:fixed;left:-9999px;top:0", value: text });
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      PD.toast(ok ? "Скопировано" : "Не удалось скопировать — выделите текст вручную", ok ? "" : "bad");
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { PD.toast("Скопировано"); }, fallback);
    } else { fallback(); }
  };

  // ------------------------------------------------------------ роутер
  var routes = [];
  PD.route = function (pattern, handler) {
    var keys = [];
    var re = new RegExp("^" + pattern.replace(/:(\w+)/g, function (_, k) { keys.push(k); return "([^/]+)"; }) + "/?$");
    routes.push({ re: re, keys: keys, handler: handler });
  };
  PD.go = function (path) {
    if (location.hash === "#" + path) PD.dispatch(); else location.hash = "#" + path;
  };
  PD.path = function () { return location.hash.replace(/^#/, "") || "/"; };
  PD.dispatch = function () {
    var path = PD.path();
    for (var i = 0; i < routes.length; i++) {
      var m = path.match(routes[i].re);
      if (m) {
        var params = {};
        routes[i].keys.forEach(function (k, j) { params[k] = decodeURIComponent(m[j + 1]); });
        try { routes[i].handler(params); } catch (e) { PD.fatal(e); }
        return;
      }
    }
    PD.go("/");
  };
  window.addEventListener("hashchange", function () { PD.dispatch(); });

  PD.fatal = function (e) {
    if (window.console) console.error(e);
    PD.mount(h("main", { class: "page narrow" }, h("div", { class: "card" },
      h("h1", { text: "Что-то пошло не так" }),
      h("p", { class: "muted", text: (e && e.message) || "Неизвестная ошибка" }),
      h("button", { class: "btn primary", onclick: function () { location.reload(); }, text: "Обновить страницу" }))));
  };

  // ------------------------------------------------------------ текст
  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim(); }
  function words(s) { return norm(s).split(/[^a-zа-я0-9]+/).filter(Boolean); }
  function stem(w) { return w.length > 6 ? w.slice(0, w.length - 2) : (w.length > 4 ? w.slice(0, w.length - 1) : w); }
  PD.norm = norm;

  function itemWords(item) {
    if (!item._w) item._w = words([item.name, item.description, (item.ingredients || []).join(" ")].join(" "));
    return item._w;
  }
  // упоминается ли продукт в позиции (с запасом: лучше лишний раз счесть «упоминается»)
  function mentions(item, term) {
    var tw = words(term).filter(function (w) { return w.length >= 3; });
    var iw = itemWords(item);
    if (!tw.length) return norm([item.name, item.description, (item.ingredients || []).join(" ")].join(" ")).indexOf(norm(term)) >= 0;
    return tw.some(function (t) { var s = stem(t); return iw.some(function (w) { return w.indexOf(s) === 0 || s.indexOf(stem(w)) === 0 && w.length >= 4; }); });
  }
  PD.mentions = mentions;

  PD.fmtPrice = function (n) {
    if (n == null || n === "" || isNaN(Number(n))) return "";
    var v = Number(n);
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: v % 1 ? 2 : 0 }).format(v) + " ₽";
  };
  PD.fmtDate = function (iso, withTime) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var o = { day: "numeric", month: "short" };
    if (withTime) { o.hour = "2-digit"; o.minute = "2-digit"; }
    return d.toLocaleString("ru-RU", o);
  };
  PD.ago = function (iso) {
    if (!iso) return "ещё не занимался";
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 3600) return "только что";
    if (diff < 86400) return "сегодня";
    if (diff < 2 * 86400) return "вчера";
    return Math.floor(diff / 86400) + " дн. назад";
  };
  PD.plural = function (n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };
  PD.shuffle = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

  // ------------------------------------------------------------ аллергены
  PD.ALLERGENS = C.ALLERGENS;
  PD.allergenInfo = function (key) {
    var k = norm(key);
    for (var i = 0; i < C.ALLERGENS.length; i++) if (C.ALLERGENS[i].key === k) return C.ALLERGENS[i];
    return { key: key, on: "на «" + key + "»", what: "«" + key + "»", acc: "«" + key + "»", gen: "«" + key + "»", custom: true };
  };
  PD.detectAllergens = function (item) {
    var text = norm([item.name, item.description, (item.ingredients || []).join(", ")].join(" "));
    text = text.replace(/((?:кокосов|миндальн|овсян|соев|рисов|растительн)\S*)\s+молок\S*/g, "$1 ")
               .replace(/молочн\S*\s+улун/g, "улун").replace(/улун\s+молочн\S*/g, "улун");
    var ws = text.split(/[^a-zа-я0-9-]+/).filter(Boolean);
    var found = [];
    C.ALLERGENS.forEach(function (a) {
      var hit = a.words.some(function (st) { return ws.some(function (w) { return w.indexOf(st) === 0; }); }) ||
                a.phrases.some(function (p) { return text.indexOf(p) >= 0; });
      if (hit) found.push(a.key);
    });
    return found;
  };

  // ------------------------------------------------------------ разбор меню
  function cleanCell(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function looksLikeList(s) {
    s = String(s || "").trim();
    if (/[.!?]\s+\S/.test(s)) return false; // несколько предложений — это описание, а не состав
    var parts = s.replace(/\.$/, "").split(/\s*[,;]\s*/).filter(Boolean);
    return parts.length >= 3 && parts.every(function (p) { return p.length <= 45 && p.split(/\s+/).length <= 5; });
  }
  function splitList(s) {
    return String(s || "").replace(/\.$/, "").split(/\s*[,;]\s*|\s+и\s+(?=[^,]+$)/).map(cleanCell).filter(function (x) { return x && x.length <= 60; });
  }
  var PORTION_RE = /\(?\s*(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?)\s*(гр|г|кг|мл|л|шт|cl|oz)\.?\s*\)?(?=\s|$|[,/])/i;
  function takePortion(name) {
    var m = name.match(PORTION_RE);
    if (!m) return { name: name, portion: "" };
    var unit = m[2].toLowerCase() === "гр" ? "г" : m[2].toLowerCase();
    return { name: cleanCell(name.replace(m[0], " ")).replace(/[,\s]+$/, ""), portion: m[1].replace(/\s+/g, "") + " " + unit };
  }
  function finishItem(it, autoAllergens) {
    it.name = cleanCell(it.name).replace(/^[•·*–—-]\s*/, "");
    it.category = cleanCell(it.category);
    it.description = cleanCell(it.description);
    if (!it.portion) { var p = takePortion(it.name); it.name = p.name; it.portion = p.portion; }
    if (!it.ingredients || !it.ingredients.length) {
      it.ingredients = it.description && looksLikeList(it.description) ? splitList(it.description) : [];
    } else if (typeof it.ingredients === "string") {
      it.ingredients = splitList(it.ingredients);
    }
    if (typeof it.allergens === "string") it.allergens = splitList(it.allergens).map(norm);
    if ((!it.allergens || !it.allergens.length) && autoAllergens) {
      it.allergens = PD.detectAllergens(it);
      it._autoAllergens = it.allergens.length > 0;
    }
    it.allergens = it.allergens || [];
    return it;
  }
  var PRICE_END = /(\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,]\d{1,2})?(?:\s*\/\s*\d[\d  ]*)?\s*(?:₽|р\.|руб\.?|р|rub)?\s*$/i;
  function matchPrice(line) {
    var m = line.match(PRICE_END);
    if (!m) return null;
    var before = line.slice(0, m.index);
    if (before && !/[\s.…·_:–—-]$/.test(before)) return null; // цифры внутри слова, а не цена
    var num = Number(m[1].replace(/[  ]/g, ""));
    if (!num || num > 500000) return null;
    return { price: num, name: before.replace(/[\s.…·_:–—-]+$/, "") };
  }
  function isHeadingLine(s) {
    if (s.length > 40) return false;
    var letters = s.replace(/[^А-Яа-яЁёA-Za-z]/g, "");
    if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
    return /:$/.test(s);
  }
  PD.parseMenuText = function (raw, autoAllergens) {
    var lines = String(raw || "").split(/\r?\n/).map(function (l) { return cleanCell(l.replace(/^[•·*]\s*/, "")); }).filter(Boolean);
    var items = [], cat = "", last = null;
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (/^(меню|menu|стр\.?\s*\d+|\d+)$/i.test(L)) continue;
      var pm = matchPrice(L);
      if (pm && pm.name) {
        var parts = pm.name.split(/\s[—–-]\s/);
        last = { category: cat, name: parts[0], description: parts.slice(1).join(" — "), price: pm.price };
        items.push(last);
        continue;
      }
      if (pm && !pm.name) { // строка только с ценой
        if (last && last.price == null) last.price = pm.price;
        continue;
      }
      var next = lines[i + 1] || "";
      var nextPm = matchPrice(next);
      if (isHeadingLine(L)) {
        cat = cap(L.replace(/:$/, "").toLowerCase());
        last = null;
        continue;
      }
      // название без цены, а цена — следующей строкой
      if (nextPm && !nextPm.name && L.length <= 80) {
        last = { category: cat, name: L, description: "", price: nextPm.price };
        items.push(last);
        i++;
        continue;
      }
      var short = L.length <= 32 && !/[,;.]/.test(L) && L.split(" ").length <= 4;
      if (short && nextPm && nextPm.name && (!last || last.description || /^[А-ЯЁA-Z]/.test(L))) {
        cat = cap(L);
        last = null;
        continue;
      }
      if (last) last.description = last.description ? last.description + " " + L : L;
    }
    return items.map(function (it) { return finishItem(it, autoAllergens); }).filter(function (it) { return it.name; });
  };

  var SYN = {
    name: ["название", "наименование", "блюдо", "позиция", "name", "title", "товар", "напиток"],
    category: ["категория", "раздел", "группа", "category", "section", "тип"],
    price: ["цена", "стоимость", "price", "руб", "₽", "цена, руб", "цена руб"],
    description: ["описание", "description", "desc", "комментарий"],
    ingredients: ["состав", "ингредиенты", "ingredients", "composition"],
    allergens: ["аллергены", "аллерген", "allergens"],
    portion: ["выход", "вес", "объём", "объем", "граммовка", "portion", "weight", "volume", "выход, г"],
    upsell: ["допродажа", "рекомендация", "к чему предложить", "что предложить", "что предложить к позиции", "upsell", "pairing", "сочетание"]
  };
  function headerKey(cell) {
    var c = norm(cell).replace(/[*:]/g, "");
    var keys = Object.keys(SYN);
    for (var i = 0; i < keys.length; i++) {
      if (SYN[keys[i]].some(function (s) { return c === s || (s.length > 3 && c.indexOf(s) === 0); })) return keys[i];
    }
    return null;
  }
  PD.parseRows = function (rows, autoAllergens) {
    rows = rows.map(function (r) { return (r || []).map(cleanCell); }).filter(function (r) { return r.some(Boolean); });
    if (!rows.length) return [];
    var hi = -1, map = {};
    for (var i = 0; i < Math.min(rows.length, 10); i++) {
      var m = {};
      rows[i].forEach(function (cell, j) { var k = headerKey(cell); if (k && m[k] == null) m[k] = j; });
      if (m.name != null) { hi = i; map = m; break; }
    }
    if (hi < 0) { // без заголовков: первое текстовое поле — название, число — цена
      map = { name: 0 };
      var r0 = rows[0];
      for (var j = r0.length - 1; j > 0; j--) if (/^\d[\d\s.,]*\s*(₽|р)?$/.test(r0[j])) { map.price = j; break; }
      var longest = -1, len = 0;
      r0.forEach(function (c, j2) { if (j2 !== 0 && j2 !== map.price && c.length > len) { len = c.length; longest = j2; } });
      if (longest > 0 && len > 15) map.description = longest;
    }
    var out = [];
    rows.slice(hi + 1).forEach(function (r) {
      var it = {};
      Object.keys(map).forEach(function (k) { it[k] = r[map[k]] || ""; });
      if (!it.name) return;
      it.price = it.price ? Number(String(it.price).replace(/[^\d.,]/g, "").replace(",", ".")) || null : null;
      out.push(finishItem(it, autoAllergens));
    });
    return out;
  };

  PD.parseCSV = function (text) {
    text = String(text || "").replace(/^﻿/, "");
    var first = text.split(/\r?\n/)[0] || "";
    var counts = { ";": (first.match(/;/g) || []).length, ",": (first.match(/,/g) || []).length, "\t": (first.match(/\t/g) || []).length };
    var d = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  };

  PD.parseJSONMenu = function (data, autoAllergens) {
    var list = Array.isArray(data) ? data : (data && (data.menu || data.items || data.dishes)) || [];
    if (!Array.isArray(list)) return [];
    return list.filter(function (x) { return x && typeof x === "object"; }).map(function (x) {
      var it = {};
      Object.keys(x).forEach(function (k) { var key = headerKey(k) || (SYN[k] ? k : null); if (key && it[key] == null) it[key] = x[k]; });
      if (Array.isArray(it.ingredients)) it.ingredients = it.ingredients.map(cleanCell);
      if (Array.isArray(it.allergens)) it.allergens = it.allergens.map(norm);
      if (it.price != null && typeof it.price !== "number") it.price = Number(String(it.price).replace(/\s/g, "").replace(/[^\d.,]/g, "").replace(",", ".")) || null;
      it.name = cleanCell(it.name);
      return finishItem(it, autoAllergens);
    }).filter(function (it) { return it.name; });
  };

  var xlsxPromise = null;
  PD.loadXLSX = function () {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxPromise) {
      xlsxPromise = new Promise(function (res, rej) {
        var s = document.createElement("script");
        s.src = CFG.xlsxLib;
        s.onload = function () { window.XLSX ? res(window.XLSX) : rej(new Error("xlsx")); };
        s.onerror = function () { xlsxPromise = null; rej(new Error("xlsx")); };
        document.head.appendChild(s);
      });
    }
    return xlsxPromise;
  };

  // ------------------------------------------------------------ генератор вопросов
  function opt(text, correct) { return { text: String(text), correct: !!correct }; }
  function distinct(list) { var seen = {}; return list.filter(function (x) { var k = norm(x); if (!k || seen[k]) return false; seen[k] = 1; return true; }); }
  function others(item, items) {
    var same = items.filter(function (o) { return o.id !== item.id && o.category === item.category; });
    var rest = items.filter(function (o) { return o.id !== item.id && o.category !== item.category; });
    return PD.shuffle(same).concat(PD.shuffle(rest));
  }
  function composition(item) {
    return item.ingredients && item.ingredients.length ? item.ingredients.join(", ") : (item.description || "");
  }

  var GEN = {
    ingredient: function (item, items) {
      if (!item.ingredients || !item.ingredients.length) return null;
      var good = pick(item.ingredients);
      var pool = distinct(others(item, items).reduce(function (acc, o) { return acc.concat(o.ingredients || []); }, []))
        .filter(function (ing) { return !mentions(item, ing) && norm(ing) !== norm(good); });
      if (pool.length < 2) return null;
      return {
        text: "Что входит в «" + item.name + "»?",
        options: [opt(good, true), opt(pool[0]), opt(pool[1])],
        explain: "Состав «" + item.name + "»: " + composition(item) + "."
      };
    },
    dish: function (item, items) {
      if (!item.ingredients || !item.ingredients.length) return null;
      var cands = PD.shuffle(item.ingredients).filter(function (ing) {
        return words(ing).some(function (w) { return w.length >= 4; }) &&
          items.filter(function (o) { return mentions(o, ing); }).length <= 2;
      });
      if (!cands.length) return null;
      var ing = cands[0];
      var pool = others(item, items).filter(function (o) { return !mentions(o, ing); });
      if (pool.length < 2) return null;
      var isDrink = /напит|бар|коктейл|чай|кофе|лимонад|вино|пиво/i.test(item.category);
      return {
        text: "В " + (isDrink ? "какой позиции" : "каком блюде") + " есть " + ing.toLowerCase() + "?",
        options: [opt(item.name, true), opt(pool[0].name), opt(pool[1].name)],
        explain: "«" + ing + "» есть в «" + item.name + "». Состав: " + composition(item) + "."
      };
    },
    allergen: function (item, items) {
      var al = (item.allergens || []).map(norm).filter(Boolean);
      var hasInfo = (item.ingredients && item.ingredients.length) || (item.description || "").length >= 20;
      var positive = al.length && (Math.random() < 0.65 || !hasInfo);
      if (positive) {
        var a = PD.allergenInfo(pick(al));
        return {
          text: "Гость с аллергией " + a.on + " спрашивает про «" + item.name + "». Что ответить?",
          options: [opt("«К сожалению, нельзя: в этом блюде есть " + a.what + ". Давайте подберу другое»", true),
                    opt("«Можно, попросим кухню убрать " + a.acc + "»"),
                    opt("«Можно, там этого нет»")],
          explain: "По техкарте в «" + item.name + "» есть " + a.what + ". Не обещайте убрать аллерген — предложите другую позицию."
        };
      }
      if (!hasInfo) return null;
      var all = {};
      items.forEach(function (o) { (o.allergens || []).forEach(function (x) { all[norm(x)] = 1; }); });
      var absent = Object.keys(all).filter(function (k) { return al.indexOf(k) < 0; });
      if (!absent.length) return null;
      var b = PD.allergenInfo(pick(absent));
      return {
        text: "Гость с аллергией " + b.on + " спрашивает про «" + item.name + "». Что ответить?",
        options: [opt("«По составу " + b.gen + " нет. Сейчас уточню на кухне про следы и перекрёстный контакт»", true),
                  opt("«Нельзя, там есть " + b.what + "»"),
                  opt("«Точно можно, у нас всё безопасно»")],
        explain: "В составе «" + item.name + "» " + b.gen + " нет, но при аллергии всегда уточняйте у кухни: возможны следы."
      };
    },
    price: function (item, items) {
      var p = Number(item.price);
      if (!p) return null;
      var pool = distinct(others(item, items).map(function (o) { return o.price ? String(Number(o.price)) : ""; }))
        .map(Number).filter(function (x) { return x && Math.abs(x - p) / p >= 0.08 && Math.abs(x - p) / p <= 1.2; });
      while (pool.length < 2) {
        var f = pick([0.75, 0.82, 1.18, 1.3, 0.65, 1.45]);
        var v = Math.round(p * f / 10) * 10;
        if (v > 0 && v !== p && pool.indexOf(v) < 0) pool.push(v);
      }
      return {
        text: "Сколько стоит «" + item.name + "»" + (item.portion ? " (" + item.portion + ")" : "") + "?",
        options: [opt(PD.fmtPrice(p), true), opt(PD.fmtPrice(pool[0])), opt(PD.fmtPrice(pool[1]))],
        explain: "«" + item.name + "» — " + PD.fmtPrice(p) + "."
      };
    },
    portion: function (item, items) {
      if (!item.portion) return null;
      var m = item.portion.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
      if (!m) return null;
      var unit = m[2], num = Number(m[1].replace(",", "."));
      var pool = distinct(others(item, items).map(function (o) { return o.portion || ""; }))
        .filter(function (x) { return x && norm(x) !== norm(item.portion) && x.indexOf(unit) >= 0; });
      [0.6, 1.5, 0.75, 1.3].forEach(function (f) {
        var v = num * f; v = v >= 10 ? Math.round(v / 10) * 10 : Math.round(v * 10) / 10;
        var s = String(v).replace(".", ",") + " " + unit;
        if (pool.length < 2 && v > 0 && norm(s) !== norm(item.portion) && pool.indexOf(s) < 0) pool.push(s);
      });
      if (pool.length < 2) return null;
      var vol = /мл|л|cl|oz/i.test(unit) && !/^г|кг|шт/i.test(unit);
      return {
        text: (vol ? "Какой объём у «" : "Какой выход у «") + item.name + "»?",
        options: [opt(item.portion, true), opt(pool[0]), opt(pool[1])],
        explain: "«" + item.name + "» — " + item.portion + "."
      };
    },
    upsell: function (item, items) {
      if (!item.upsell) return null;
      var pool = distinct(others(item, items).map(function (o) { return o.upsell || ""; }))
        .filter(function (x) { return x && norm(x) !== norm(item.upsell); });
      others(item, items).forEach(function (o) { if (pool.length < 2 && norm(o.name) !== norm(item.upsell) && o.category !== item.category) pool.push(o.name); });
      if (pool.length < 2) return null;
      return {
        text: "Гость заказал «" + item.name + "». Что уместно предложить к нему?",
        options: [opt(item.upsell, true), opt(pool[0]), opt(pool[1])],
        explain: "К «" + item.name + "» в заведении рекомендуют: " + item.upsell + "."
      };
    },
    describe: function (item, items) {
      if (!item.description || item.description.length < 15) return null;
      var pool = others(item, items).filter(function (o) { return o.description && o.description.length >= 15 && norm(o.description) !== norm(item.description); });
      if (pool.length < 2) return null;
      function cut(s) { return s.length > 110 ? s.slice(0, 107).replace(/\s+\S*$/, "") + "…" : s; }
      return {
        text: "Как описать гостю «" + item.name + "»?",
        options: [opt(cut(item.description), true), opt(cut(pool[0].description)), opt(cut(pool[1].description))],
        explain: "«" + item.name + "»: " + item.description
      };
    },
    category: function (item, items) {
      var cats = distinct(items.map(function (o) { return o.category; })).filter(function (c) { return norm(c) !== norm(item.category); });
      if (!item.category || cats.length < 2) return null;
      var pool = PD.shuffle(cats);
      return {
        text: "В каком разделе меню «" + item.name + "»?",
        options: [opt(item.category, true), opt(pool[0]), opt(pool[1])],
        explain: "«" + item.name + "» — в разделе «" + item.category + "»."
      };
    }
  };
  var WEIGHTS = { ingredient: 3, dish: 2, allergen: 3, price: 2, portion: 1, upsell: 2, describe: 1, category: 0.4 };

  PD.questionFor = function (item, items, usedTypes) {
    var types = Object.keys(GEN);
    var bag = [];
    types.forEach(function (t) {
      var w = WEIGHTS[t] / (1 + 1.5 * ((usedTypes && usedTypes[t]) || 0));
      bag.push({ t: t, w: w * (0.5 + Math.random()) });
    });
    bag.sort(function (a, b) { return b.w - a.w; });
    for (var i = 0; i < bag.length; i++) {
      var q = GEN[bag[i].t](item, items);
      if (q) {
        q.meta = { item_id: item.id, qtype: bag[i].t };
        q.options = PD.shuffle(q.options);
        if (usedTypes) usedTypes[bag[i].t] = (usedTypes[bag[i].t] || 0) + 1;
        return q;
      }
    }
    return null;
  };

  PD.caseQuestion = function (c) {
    return {
      text: c.q,
      label: "Ситуация из зала",
      options: PD.shuffle(c.o.map(function (t, i) { return opt(t, i === c.a); })),
      explain: c.e,
      meta: { case_id: c.id, qtype: "case" }
    };
  };
  PD.pickCases = function (modules, n, avoid) {
    var mods = modules && modules.length ? modules : ["service"];
    var pool = C.CASES.filter(function (c) { return mods.indexOf(c.module) >= 0; });
    var fresh = pool.filter(function (c) { return !avoid || avoid.indexOf(c.id) < 0; });
    var list = PD.shuffle(fresh).concat(PD.shuffle(pool.filter(function (c) { return fresh.indexOf(c) < 0; })));
    return list.slice(0, n);
  };
  PD.caseTitle = function (id) {
    for (var i = 0; i < C.CASES.length; i++) if (C.CASES[i].id === id) return C.CASES[i].title;
    return id;
  };

  // разминка: позиции «к повторению» → новые → остальные; плюс одна ситуация
  PD.buildWarmup = function (items, progress, today, size, modules, recentCases, casesCount) {
    var prog = {};
    (progress || []).forEach(function (p) { prog[p.item_id] = p; });
    var due = items.filter(function (it) { return prog[it.id] && prog[it.id].due <= today; })
      .sort(function (a, b) { return prog[a.id].box - prog[b.id].box || (prog[a.id].due < prog[b.id].due ? -1 : 1); });
    var fresh = PD.shuffle(items.filter(function (it) { return !prog[it.id]; }).slice(0, 40));
    var later = PD.shuffle(items.filter(function (it) { return prog[it.id] && prog[it.id].due > today; }));
    var order = due.concat(fresh, later);
    var qs = [], used = {};
    for (var i = 0; i < order.length && qs.length < size; i++) {
      var q = PD.questionFor(order[i], items, used);
      if (q) qs.push(q);
    }
    var nCases = casesCount != null ? casesCount : (qs.length ? 1 : 5);
    PD.pickCases(modules, nCases, recentCases).forEach(function (c) { qs.push(PD.caseQuestion(c)); });
    return qs;
  };

  // ------------------------------------------------------------ тренажёр
  // questions: [{text, label?, options:[{text, correct}], explain, meta}]; opts: {title, onFinish(results)}
  PD.runQuiz = function (root, questions, opts) {
    var i = 0, results = [], answered = false;
    function render() {
      root.textContent = "";
      if (i >= questions.length) { opts.onFinish(results); return; }
      var q = questions[i];
      var bar = h("div", { class: "qbar", "aria-hidden": "true" });
      questions.forEach(function (_, k) {
        var r = results[k];
        bar.appendChild(h("i", { class: k < i ? (r && r.correct ? "ok" : "bad") : (k === i ? "now" : "") }));
      });
      var list = h("div", { class: "opts" });
      var explainBox = h("div", { class: "explain", hidden: true, "aria-live": "polite" });
      var nextBtn = h("button", { class: "btn primary next", hidden: true, type: "button", text: i < questions.length - 1 ? "Дальше" : "Готово",
        onclick: function () { i++; answered = false; render(); var f = root.querySelector(".opt"); if (f) f.focus(); } });
      q.options.forEach(function (o, k) {
        var b = h("button", { class: "opt", type: "button", id: "opt-" + i + "-" + k, text: o.text, onclick: function () {
          if (answered) return;
          answered = true;
          results[i] = Object.assign({ question: q.text, correct: o.correct }, q.meta || {});
          Array.prototype.forEach.call(list.children, function (btn, j) {
            btn.disabled = true;
            if (q.options[j].correct) btn.classList.add("right");
            else if (j === k) btn.classList.add("wrong");
          });
          explainBox.textContent = (o.correct ? "Верно. " : "Не совсем. ") + q.explain;
          explainBox.className = "explain " + (o.correct ? "is-ok" : "is-bad");
          explainBox.hidden = false;
          nextBtn.hidden = false;
          nextBtn.focus();
        } });
        list.appendChild(b);
      });
      root.appendChild(h("div", { class: "quiz" },
        h("div", { class: "quiz-top" }, h("span", { text: (q.label ? q.label + " · " : "") + "Вопрос " + (i + 1) + " из " + questions.length }), bar),
        h("h2", { class: "qtext", text: q.text }),
        list, explainBox, h("div", { class: "quiz-actions" }, nextBtn)));
    }
    render();
  };

  PD.quizSummary = function (results) {
    var ok = results.filter(function (r) { return r.correct; }).length;
    var wrong = results.map(function (r, k) { return { r: r, k: k }; }).filter(function (x) { return !x.r.correct; });
    return { ok: ok, total: results.length, wrong: wrong };
  };

  // ------------------------------------------------------------ QR-код (байтовый режим, уровень M, версии 1–10)
  var QR_DATA = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
  var QR_EC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var QR_BLOCKS = [[1, 16, 0], [1, 28, 0], [1, 44, 0], [2, 32, 0], [2, 43, 0], [4, 27, 0], [4, 31, 0], [2, 38, 2], [3, 36, 2], [4, 43, 1]];
  var QR_ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  function gfMul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
  function rsDivisor(deg) {
    var r = []; for (var i = 0; i < deg - 1; i++) r.push(0); r.push(1);
    var root = 1;
    for (var k = 0; k < deg; k++) {
      for (var j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= gfMul(c, f); });
    });
    return r;
  }
  PD.qr = function (text) {
    var bytes = Array.prototype.slice.call(new TextEncoder().encode(text));
    var ver = 0;
    for (var v = 1; v <= 10; v++) {
      var ccBits = v < 10 ? 8 : 16;
      if (4 + ccBits + 8 * bytes.length <= QR_DATA[v - 1] * 8) { ver = v; break; }
    }
    if (!ver) return null;
    var bits = [];
    function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    var capBits = QR_DATA[ver - 1] * 8;
    put(0, Math.min(4, capBits - bits.length));
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    for (var pad = 0xEC; data.length < QR_DATA[ver - 1]; pad ^= 0xEC ^ 0x11) data.push(pad);
    // блоки и коррекция ошибок
    var spec = QR_BLOCKS[ver - 1], ecLen = QR_EC[ver - 1], div = rsDivisor(ecLen);
    var blocks = [], pos = 0;
    for (var g = 0; g < spec[0] + spec[2]; g++) {
      var len = spec[1] + (g >= spec[0] ? 1 : 0);
      var d = data.slice(pos, pos + len); pos += len;
      blocks.push({ d: d, e: rsRemainder(d, div) });
    }
    var all = [];
    var maxD = spec[1] + (spec[2] ? 1 : 0);
    for (var x = 0; x < maxD; x++) blocks.forEach(function (bl) { if (x < bl.d.length) all.push(bl.d[x]); });
    for (var y = 0; y < ecLen; y++) blocks.forEach(function (bl) { all.push(bl.e[y]); });
    // матрица
    var size = 17 + 4 * ver;
    var mod = [], fn = [];
    for (var r = 0; r < size; r++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setF(cx, cy, dark) { mod[cy][cx] = dark; fn[cy][cx] = true; }
    for (var t = 0; t < size; t++) { setF(6, t, t % 2 === 0); setF(t, 6, t % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var xx = c[0] + dx, yy = c[1] + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) { var dist = Math.max(Math.abs(dx), Math.abs(dy)); setF(xx, yy, dist !== 2 && dist !== 4); }
      }
    });
    var al = QR_ALIGN[ver - 1], na = al.length;
    for (var ai = 0; ai < na; ai++) for (var aj = 0; aj < na; aj++) {
      if ((ai === 0 && aj === 0) || (ai === 0 && aj === na - 1) || (ai === na - 1 && aj === 0)) continue;
      for (var ey = -2; ey <= 2; ey++) for (var ex = -2; ex <= 2; ex++) setF(al[ai] + ex, al[aj] + ey, Math.max(Math.abs(ex), Math.abs(ey)) !== 1);
    }
    function drawFormat(mask) {
      var dat = (0 << 3) | mask, rem = dat; // уровень M = 00
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fb = ((dat << 10) | rem) ^ 0x5412;
      function bit(n) { return ((fb >>> n) & 1) !== 0; }
      for (var k1 = 0; k1 <= 5; k1++) setF(8, k1, bit(k1));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (var k2 = 9; k2 < 15; k2++) setF(14 - k2, 8, bit(k2));
      for (var k3 = 0; k3 < 8; k3++) setF(size - 1 - k3, 8, bit(k3));
      for (var k4 = 8; k4 < 15; k4++) setF(8, size - 15 + k4, bit(k4));
      setF(8, size - 8, true);
    }
    drawFormat(0);
    if (ver >= 7) {
      var vr = ver;
      for (var k5 = 0; k5 < 12; k5++) vr = (vr << 1) ^ ((vr >>> 11) * 0x1F25);
      var vb = (ver << 12) | vr;
      for (var k6 = 0; k6 < 18; k6++) {
        var on = ((vb >>> k6) & 1) !== 0, a = size - 11 + k6 % 3, bb = Math.floor(k6 / 3);
        setF(a, bb, on); setF(bb, a, on);
      }
    }
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var jj = 0; jj < 2; jj++) {
        var cx = right - jj, up = ((right + 1) & 2) === 0, cy = up ? size - 1 - vert : vert;
        if (!fn[cy][cx] && bi < all.length * 8) { mod[cy][cx] = ((all[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
      }
    }
    function maskOn(m, mx, my) {
      switch (m) {
        case 0: return (mx + my) % 2 === 0;
        case 1: return my % 2 === 0;
        case 2: return mx % 3 === 0;
        case 3: return (mx + my) % 3 === 0;
        case 4: return (Math.floor(mx / 3) + Math.floor(my / 2)) % 2 === 0;
        case 5: return (mx * my) % 2 + (mx * my) % 3 === 0;
        case 6: return ((mx * my) % 2 + (mx * my) % 3) % 2 === 0;
        default: return ((mx + my) % 2 + (mx * my) % 3) % 2 === 0;
      }
    }
    function applyMask(m) { for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) if (!fn[yy][xx] && maskOn(m, xx, yy)) mod[yy][xx] = !mod[yy][xx]; }
    function penalty() {
      var p = 0, dark = 0;
      for (var yy = 0; yy < size; yy++) {
        var runR = 1, runC = 1;
        for (var xx = 0; xx < size; xx++) {
          if (mod[yy][xx]) dark++;
          if (xx > 0) {
            if (mod[yy][xx] === mod[yy][xx - 1]) { runR++; if (runR === 5) p += 3; else if (runR > 5) p++; } else runR = 1;
            if (mod[xx][yy] === mod[xx - 1][yy]) { runC++; if (runC === 5) p += 3; else if (runC > 5) p++; } else runC = 1;
          }
          if (xx > 0 && yy > 0) {
            var c0 = mod[yy][xx];
            if (c0 === mod[yy][xx - 1] && c0 === mod[yy - 1][xx] && c0 === mod[yy - 1][xx - 1]) p += 3;
          }
        }
      }
      var total = size * size;
      p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
      return p;
    }
    var best = 0, bestP = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var pp = penalty();
      if (pp < bestP) { bestP = pp; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return { size: size, modules: mod };
  };
  PD.qrSvg = function (text, px) {
    var q = PD.qr(text);
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    if (!q) return svg;
    var n = q.size + 8;
    svg.setAttribute("viewBox", "0 0 " + n + " " + n);
    svg.setAttribute("width", px || 200);
    svg.setAttribute("height", px || 200);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR-код ссылки");
    svg.setAttribute("shape-rendering", "crispEdges");
    var bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", n); bg.setAttribute("height", n); bg.setAttribute("fill", "#fff");
    svg.appendChild(bg);
    var d = "";
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.modules[y][x]) d += "M" + (x + 4) + "," + (y + 4) + "h1v1h-1z";
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", d); path.setAttribute("fill", "#000");
    svg.appendChild(path);
    return svg;
  };
})();
