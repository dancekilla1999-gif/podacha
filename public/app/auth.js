/* Сессия сайта: access только в памяти, refresh только в cookie. */
(function () {
  "use strict";
  var PD = window.PD;
  var access = null;

  function token() { return access; }
  function setAccess(t) { access = t || null; }

  function send(path, body, method) {
    var headers = { "Content-Type": "application/json" };
    if (access) headers.Authorization = "Bearer " + access;
    return fetch(path, {
      method: method || "POST",
      credentials: "same-origin",
      headers: headers,
      body: method === "GET" ? undefined : JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var err = new Error((d && d.error) || "Ошибка сервера");
          err.status = r.status;
          err.hint = (d && (d.hint || (d.error === "EXPIRED" ? "expired" : d.error === "REPLAY" ? "replay" : null))) || null;
          if (d && d.error === "EXPIRED") err.code = "EXPIRED";
          if (d && d.error === "REPLAY") err.code = "REPLAY";
          if (r.status >= 500) err.network = true;
          throw err;
        }
        if (d && d.token) setAccess(d.token);
        return d;
      });
    }, function () {
      var err = new Error("Нет связи");
      err.network = true;
      throw err;
    });
  }

  function disabledScreen() {
    PD.mount(PD.h("main", { class: "page narrow" }, PD.h("div", { class: "card" },
      PD.h("h1", { text: "Аккаунт отключён" }),
      PD.h("p", { class: "muted", text: "Вход закрыт. Если это ошибка, напишите тому, кто выдавал доступ." }))));
  }

  function recover() {
    if (window.PD && PD.tg && PD.tg.recover) return PD.tg.recover();
    return send("/api/auth/refresh", {}).then(function (d) { return d && d.token; }, function () { return null; });
  }

  function withSession(run, retried) {
    return run().catch(function (e) {
      if (e && (e.network || (e.status && e.status >= 500))) {
        if (PD.offline) PD.offline(true);
        return Promise.reject(e);
      }
      if (PD.offline) PD.offline(false);
      if (e && e.hint === "disabled") { disabledScreen(); return Promise.reject(e); }
      if (e && e.hint === "expired" && !retried) {
        return recover().then(function (t) {
          if (!t) {
            setAccess(null);
            if (!(PD.tg)) PD.go("/login");
            return Promise.reject(e);
          }
          return withSession(run, true);
        });
      }
      if (e && (e.hint === "revoked" || e.hint === "auth") && !retried) {
        if (PD.tg && PD.tg.recover) {
          return PD.tg.recover().then(function (t) {
            if (t) return withSession(run, true);
            return Promise.reject(e);
          });
        }
        setAccess(null);
        PD.go("/login");
        return Promise.reject(e);
      }
      return Promise.reject(e);
    });
  }

  function boot() {
    var old = null;
    try { old = localStorage.getItem("pd_owner"); } catch (e) { old = null; }
    if (old) {
      return send("/api/auth/migrate", { token: old }).then(function () {
        try { localStorage.removeItem("pd_owner"); } catch (e) {}
        return access;
      }, function (e) {
        if (e && e.status === 401) { try { localStorage.removeItem("pd_owner"); } catch (e2) {} }
        return null;
      });
    }
    return send("/api/auth/refresh", {}).then(function (d) { return d && d.token; }, function () { return null; });
  }

  PD.auth = {
    token: token,
    setAccess: setAccess,
    boot: boot,
    recover: recover,
    withSession: withSession,
    disabled: disabledScreen,
    login: function (email, password) { return send("/api/auth/login", { email: email, password: password }); },
    register: function (email, password, name, invite) {
      return send("/api/auth/register", { email: email, password: password, name: name, invite: invite });
    },
    logout: function () { return send("/api/auth/logout", {}).then(function (d) { setAccess(null); return d; }, function (e) { setAccess(null); throw e; }); },
    logoutAll: function () { return send("/api/auth/logout-all", {}).then(function (d) { setAccess(null); return d; }); },
    password: function (current, next) { return send("/api/auth/password", { current: current, "new": next }); },
    linkCode: function () { return send("/api/auth/link-code", {}); },
    linkStatus: function (code) { return send("/api/auth/link-status?code=" + encodeURIComponent(code), null, "GET"); },
    dispute: function () { return send("/api/auth/link-dispute", {}); },
    devices: function () { return send("/api/auth/devices", null, "GET"); },
    endDevice: function (id) { return send("/api/auth/devices/" + id + "/end", {}); },
    unbind: function () { return send("/api/tg/unbind", {}); }
  };
})();
