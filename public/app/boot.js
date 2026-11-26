/* Точка входа кабинета: сначала тихий refresh, потом маршруты. */
(function () {
  var boot = (window.PD && PD.auth && PD.auth.boot) ? PD.auth.boot() : Promise.resolve(null);
  boot.then(function () {
    if (window.PD && PD.onAuth) PD.onAuth();
    PD.dispatch();
  }, function () {
    if (window.PD) PD.dispatch();
  });
})();
