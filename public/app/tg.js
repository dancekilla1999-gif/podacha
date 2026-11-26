/* Режим Telegram Mini App. Подключается только со страницы /tg/. */
(function () {
  "use strict";
  var PD = window.PD;
  var h = PD.h;
  var PUB = window.PD_TG_PUBLIC || { bot: "trio_podacha_bot", consentVersion: "2026-11-26", consentText: "Согласен на обработку моего Telegram ID, имени и username для входа без пароля" };
  PD.tg = { on: true, plan: null };
  document.documentElement.setAttribute("data-tg", "1");

  function wa() { return window.Telegram && window.Telegram.WebApp; }
  function initData() { var w = wa(); return (w && w.initData) || ""; }
  function botUrl() { return "https://t.me/" + PUB.bot + "/app"; }
  function randomId() {
    var bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function sha256hex(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    });
  }
  function storageGet(key) {
    return new Promise(function (resolve) {
      var w = wa() || {};
      var secure = w.SecureStorage;
      var device = w.DeviceStorage;
      if (secure && secure.getItem) {
        try { secure.getItem(key, function (err, value) { if (value) resolve(value); else fallback(); }); return; } catch (e) {}
      }
      if (device && device.getItem) {
        try { device.getItem(key, function (err, value) { if (value) resolve(value); else fallback(); }); return; } catch (e) {}
      }
      fallback();
      function fallback() {
        var v = null;
        try { v = localStorage.getItem(key); } catch (e) { v = null; }
        if (!v) {
          v = randomId();
          try { localStorage.setItem(key, v); } catch (e2) {}
          if (secure && secure.setItem) { try { secure.setItem(key, v, function () {}); } catch (e3) {} }
          if (device && device.setItem) { try { device.setItem(key, v, function () {}); } catch (e4) {} }
        }
        resolve(v);
      }
    });
  }
  function rememberToken(token) {
    var w = wa() || {};
    if (w.SecureStorage && w.SecureStorage.setItem && token) {
      try { w.SecureStorage.setItem("pd_tg_token", token, function () {}); } catch (e) {}
    }
  }
  function deviceBundle() {
    var platform = (wa() && wa().platform) || "unknown";
    return storageGet("pd_device_id").then(function (id) {
      return sha256hex(platform + String(id)).then(function (key) {
        var label = (/iphone|ios/i.test(platform) ? "iPhone" : /android/i.test(platform) ? "Android" : /tdesktop|macos|web/i.test(platform) ? "Компьютер" : "Устройство") + " · Telegram";
        return { device_key: key, device_label: label };
      });
    });
  }

  function applyTheme(forced) {
    var tp = forced || (wa() && wa().themeParams) || {};
    var root = document.documentElement;
    var map = {
      bg_color: "--tg-theme-bg-color", secondary_bg_color: "--tg-theme-secondary-bg-color",
      text_color: "--tg-theme-text-color", hint_color: "--tg-theme-hint-color",
      link_color: "--tg-theme-link-color", button_color: "--tg-theme-button-color",
      button_text_color: "--tg-theme-button-text-color"
    };
    Object.keys(map).forEach(function (k) { if (tp[k]) root.style.setProperty(map[k], tp[k]); });
    var bg = tp.bg_color || "#f4f6f4";
    var dark = false;
    if (/^#([0-9a-f]{6})$/i.test(bg)) dark = parseInt(bg.slice(1, 3), 16) < 140;
    root.setAttribute("data-theme", dark ? "dark" : "light");
    var w = wa();
    if (w && w.setHeaderColor) { try { w.setHeaderColor(bg); } catch (e) {} }
    if (w && w.setBackgroundColor) { try { w.setBackgroundColor(bg); } catch (e) {} }
  }
  function applyViewport() {
    var w = wa();
    if (!w) return;
    var height = w.viewportStableHeight || w.viewportHeight;
    if (height) document.documentElement.style.setProperty("--tg-viewport-stable-height", height + "px");
    var sa = w.safeAreaInset || {};
    var csa = w.contentSafeAreaInset || {};
    ["top", "right", "bottom", "left"].forEach(function (side) {
      document.documentElement.style.setProperty("--tg-safe-area-inset-" + side, ((sa[side] || 0)) + "px");
      document.documentElement.style.setProperty("--tg-content-safe-area-inset-" + side, ((csa[side] || 0)) + "px");
    });
  }
  function syncChrome() {
    var w = wa();
    if (!w || !w.BackButton) return;
    var path = PD.path();
    var home = path === "/o" || /^\/o\/v\/[^/]+\/menu\/?$/.test(path);
    if (home) w.BackButton.hide(); else w.BackButton.show();
    if (w.disableVerticalSwipes && /\/(menu|report|team)/.test(path)) w.disableVerticalSwipes();
  }

  function tariffLine(plan) {
    if (!plan || plan.status === "expired" || plan.status === "inactive" || plan.active === false) return "Подписка неактивна";
    var until = plan.until || plan.paid_until || plan.trial_until;
    var name = plan.name || "Подача";
    if (!until) return "Тариф: " + name;
    var d = new Date(until);
    if (isNaN(d.getTime())) return "Тариф: " + name;
    var dd = ("0" + d.getDate()).slice(-2);
    var mm = ("0" + (d.getMonth() + 1)).slice(-2);
    return "Тариф: " + name + ", активен до " + dd + "." + mm;
  }
  PD.tg.tariffLine = tariffLine;
  PD.tg.tariffNode = function () {
    return h("div", { class: "card", id: "tariff" }, h("h2", { text: "Тариф" }), h("p", { text: tariffLine(PD.tg.plan) }));
  };

  function gate() {
    PD.mount(h("main", { class: "page narrow tg-gate" },
      h("a", { class: "brand big", href: "/app/", text: "Подача" }),
      h("div", { class: "card" },
        h("h1", { text: "Откройте в Telegram" }),
        h("p", { class: "muted", text: "Кабинет внутри Telegram открывается из бота. В обычном браузере войти по Telegram нельзя." }),
        h("a", { class: "btn primary wide", href: botUrl(), text: "Открыть в Telegram" }),
        h("p", { class: "center" }, h("a", { href: "/app/#/login", text: "Войти на сайте" })))));
  }
  function refreshScreen() {
    PD.mount(h("main", { class: "page narrow" }, h("div", { class: "card" },
      h("h1", { text: "Обновите приложение" }),
      h("p", { class: "muted", text: "Окно открыто слишком давно. Закройте его и откройте кабинет из бота снова — пароль не понадобится." }),
      h("button", { class: "btn primary wide", type: "button", text: "Закрыть", onclick: function () {
        if (wa() && wa().close) wa().close();
      } }))));
  }
  function disabled() {
    if (PD.auth && PD.auth.disabled) PD.auth.disabled();
  }

  function enterCabinet(me) {
    if (PD.onAuth) PD.onAuth();
    var start = (wa() && wa().initDataUnsafe && wa().initDataUnsafe.start_param) || "";
    if (/^r_/.test(start)) {
      PD.go("/o/v/" + start.slice(2) + "/report");
      return;
    }
    if (me && me.venues && me.venues[0]) PD.go("/o/v/" + me.venues[0].id + "/menu");
    else PD.go("/o");
  }

  function consentScreen(code, firstName) {
    var box = h("input", { type: "checkbox", id: "tg-consent" });
    var btn = h("button", { class: "btn primary wide", type: "button", disabled: true, text: code ? "Привязать" : "Войти" });
    var err = h("p", { class: "form-err", role: "alert" });
    var loginBtn = h("button", { class: "btn primary wide", type: "submit", disabled: true, text: "Войти" });
    box.addEventListener("change", function () { btn.disabled = !box.checked; loginBtn.disabled = !box.checked; });
    function submitLogin(email, password) {
      if (!box.checked) return;
      loginBtn.disabled = true;
      post("/api/tg/login", { email: email, password: password, consent: true }).then(function (d) {
        if (d && d.token) { rememberToken(d.token); enterCabinet(d.me); }
      }, function (e) {
        err.textContent = e.message || "Не получилось войти";
        loginBtn.disabled = !box.checked;
      });
    }
    btn.addEventListener("click", function () {
      if (!code) return;
      btn.disabled = true;
      post("/api/tg/link", { code: code, consent: true }).then(function (d) {
        if (d && d.token) { rememberToken(d.token); enterCabinet(d.me); }
      }, function (e) { err.textContent = e.message || "Код не подошёл"; btn.disabled = false; });
    });
    var email = h("input", { type: "email", id: "tg-email", autocomplete: "username", placeholder: "you@example.ru" });
    var pass = h("input", { type: "password", id: "tg-password", autocomplete: "current-password" });
    PD.mount(h("main", { class: "page narrow tg-consent" },
      h("div", { class: "card" },
        h("h1", { text: firstName ? ("Здравствуйте, " + firstName) : "Привязка Telegram" }),
        h("p", { class: "muted", text: code ? "Код с сайта действует несколько минут." : "Проще: на сайте в Настройках нажмите «Привязать Telegram»." }),
        h("label", { class: "tg-check", for: "tg-consent" }, box, h("span", null, PUB.consentText + ". ", h("a", { href: "/legal/telegram.html", text: "Как мы это храним" }))),
        err,
        code ? btn : null,
        code ? null : h("form", { class: "form", onsubmit: function (e) {
          e.preventDefault();
          submitLogin(email.value, pass.value);
        } },
          h("label", { for: "tg-email" }, "Почта", email),
          h("label", { for: "tg-password" }, "Пароль", pass),
          loginBtn),
        h("p", { class: "muted small" }, "Нет аккаунта? ", h("a", { href: "/app/#/register", text: "Зарегистрироваться на сайте" })))));
  }

  var devCache = null;
  function post(path, extra) {
    var w = wa();
    return (devCache ? Promise.resolve(devCache) : deviceBundle().then(function (d) { devCache = d; return d; })).then(function (dev) {
      return fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Authorization: PD.auth && PD.auth.token() ? "Bearer " + PD.auth.token() : "" },
        body: JSON.stringify(Object.assign({ initData: initData(), device_key: dev.device_key, device_label: dev.device_label }, extra || {}))
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.status === 401 && d && d.error === "EXPIRED") { refreshScreen(); var e = new Error("EXPIRED"); e.code = "EXPIRED"; throw e; }
          if (!r.ok) { var e2 = new Error((d && d.error) || "Ошибка"); e2.status = r.status; e2.hint = d && d.hint; throw e2; }
          if (d && d.token && PD.auth) { PD.auth.setAccess(d.token); rememberToken(d.token); }
          return d;
        });
      }, function () {
        if (PD.offline) PD.offline(true);
        var e = new Error("Нет связи"); e.network = true; throw e;
      });
    });
  }

  PD.tg.recover = function () {
    if (!initData()) return Promise.resolve(null);
    return post("/api/tg/auth", {}).then(function (d) {
      if (d && d.token) return d.token;
      if (d && d.need_link) { consentScreen("", d.tg && d.tg.first_name); return null; }
      return null;
    }, function (e) {
      if (e && e.code === "EXPIRED") return null;
      if (e && e.network) return PD.auth && PD.auth.token();
      return null;
    });
  };

  function bootReal() {
    var w = wa();
    if (w) {
      if (w.ready) w.ready();
      if (w.expand) w.expand();
      applyTheme();
      applyViewport();
      if (w.onEvent) {
        w.onEvent("themeChanged", function () { applyTheme(); });
        w.onEvent("viewportChanged", applyViewport);
      }
      if (w.BackButton && w.BackButton.onClick) w.BackButton.onClick(function () { history.back(); });
      if (w.enableClosingConfirmation) {
        document.addEventListener("input", function (e) {
          if (e.target && e.target.form) w.enableClosingConfirmation();
        });
        document.addEventListener("submit", function () { if (w.disableClosingConfirmation) w.disableClosingConfirmation(); });
      }
      document.addEventListener("click", function (e) {
        var a = e.target.closest && e.target.closest("a");
        if (!a) return;
        var href = a.getAttribute("href") || "";
        if (/^https?:\/\/(t\.me|telegram\.me)\//i.test(href) && w.openTelegramLink) { e.preventDefault(); w.openTelegramLink(href); }
        else if (/^https?:/i.test(href) && w.openLink) { e.preventDefault(); w.openLink(href); }
      });
      window.addEventListener("hashchange", syncChrome);
    }
    if (!initData()) { gate(); return; }
    post("/api/tg/auth", {}).then(function (d) {
      if (d && d.hint === "disabled") { disabled(); return; }
      if (d && d.token) {
        PD.tg.plan = d.plan || null;
        enterCabinet(d.me);
        syncChrome();
        return;
      }
      var start = (w && w.initDataUnsafe && w.initDataUnsafe.start_param) || "";
      var code = /^l_/.test(start) ? start.slice(2) : "";
      consentScreen(code, d && d.tg && d.tg.first_name);
    }, function (e) {
      if (e && e.code === "EXPIRED") return;
      if (e && e.hint === "disabled") { disabled(); return; }
      if (PD.offline) PD.offline(true);
    });
  }

  function demoTheme(name) {
    if (name === "dark") {
      applyTheme({ bg_color: "#0d1a15", secondary_bg_color: "#13241d", text_color: "#e7eee9", hint_color: "#a3b4ab", link_color: "#e4c463", button_color: "#e3b26a", button_text_color: "#160e05" });
    } else {
      applyTheme({ bg_color: "#f3f5f1", secondary_bg_color: "#ffffff", text_color: "#12261e", hint_color: "#4e6158", link_color: "#6e540c", button_color: "#1d5a44", button_text_color: "#f3f5f1" });
    }
  }
  function demoApi(fn) {
    if (fn === "pd_owner_me") {
      return Promise.resolve({ email: "demo@podacha.test", name: "Демо", venues: [{ id: "11111111-1111-1111-1111-111111111111", name: "Демо зал", kind: "restaurant", warmup_size: 5, modules: ["service"], items: 2, confirmed: 2, staff: 1 }] });
    }
    if (fn === "pd_menu_get") {
      return Promise.resolve([
        { id: "1", name: "Томлёная говядина", category: "Горячее", description: "С пюре", ingredients: ["говядина", "картофель"], allergens: ["молоко"], price: 890, portion: "250 г", confirmed: true, upsell: "бокал красного" },
        { id: "2", name: "Салат с тунцом", category: "Салаты", description: "Свежий", ingredients: ["тунец", "руккола"], allergens: ["рыба"], price: 640, portion: "180 г", confirmed: false }
      ]);
    }
    if (fn === "pd_team_get") return Promise.resolve([]);
    if (fn === "pd_report") return Promise.resolve({ days: 7, staff_trained: 1, staff_total: 2, trainings: 3, answers: 12, accuracy: 80, accuracy_prev: 70, newbies: [], weak_items: [], weak_cases: [], idle: [], leaders: [] });
    return Promise.resolve({ ok: true });
  }
  function demoCabinet() {
    PD.api = function (fn) { return demoApi(fn); };
    PD.auth.setAccess("demo-memory-token");
    PD.auth.devices = function () {
      return Promise.resolve({
        telegram: { username: "rundego", dispute_open: true, bound_at: new Date().toISOString() },
        devices: [
          { id: "d1", kind: "tg", label: "iPhone · Telegram", created_at: new Date().toISOString(), last_used_at: new Date().toISOString(), current: true },
          { id: "d2", kind: "web", label: "Chrome · Windows", created_at: new Date(Date.now() - 86400000).toISOString(), last_used_at: new Date().toISOString(), current: false }
        ]
      });
    };
    PD.auth.linkCode = function () { return Promise.resolve({ code: "demo", url: botUrl() + "?startapp=l_demo" }); };
    PD.auth.linkStatus = function () { return Promise.resolve({ state: "pending" }); };
    PD.auth.password = function () { return Promise.resolve({ ok: true }); };
    PD.auth.logout = function () { return Promise.resolve({ ok: true }); };
    PD.auth.logoutAll = function () { return Promise.resolve({ ok: true }); };
    PD.auth.unbind = function () { return Promise.resolve({ ok: true }); };
    PD.auth.endDevice = function () { return Promise.resolve({ ok: true }); };
    PD.auth.dispute = function () { return Promise.resolve({ ok: true }); };
    if (PD.onAuth) PD.onAuth();
    PD.go("/o/v/11111111-1111-1111-1111-111111111111/menu");
  }
  function demoScene(name) {
    var q = new URLSearchParams(location.search);
    demoTheme(q.get("theme") === "dark" ? "dark" : "light");
    if (name === "consent") { consentScreen("demo-code", "Егор"); return; }
    if (name === "login") { consentScreen("", "Егор"); return; }
    if (name === "refresh") { refreshScreen(); return; }
    if (name === "disabled") { disabled(); return; }
    if (name === "gate") { gate(); return; }
    if (name === "tariff" || name === "tariff-off") {
      PD.tg.plan = name === "tariff" ? { name: "Подача", status: "active", until: "2026-01-12" } : { status: "expired" };
      PD.mount(h("main", { class: "page narrow" }, PD.tg.tariffNode()));
      return;
    }
    if (name === "devices" || name === "cabinet") {
      PD.tg.plan = { name: "Подача", status: "active", until: "2026-01-12T00:00:00Z" };
      demoCabinet();
      if (name === "devices") PD.go("/o/v/11111111-1111-1111-1111-111111111111/settings");
      return;
    }
    gate();
  }

  var params = new URLSearchParams(location.search);
  if (params.get("demo") === "1") {
    applyViewport();
    var origDispatch = PD.dispatch;
    PD.dispatch = function () {
      var scene = (location.hash.match(/demo\/([a-z0-9-]+)/) || [])[1];
      if (scene) { demoScene(scene); return; }
      return origDispatch();
    };
    demoScene((location.hash.match(/demo\/([a-z0-9-]+)/) || [])[1] || "gate");
  } else {
    bootReal();
  }
})();
