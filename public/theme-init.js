// Runs before the stylesheets paint: apply the saved theme so the app never
// flashes the wrong one. Kept tiny and dependency-free (see src/app/theme.js).
(function () {
  try {
    var t = localStorage.getItem('theta-theme');
    if (t === 'pro' || t === 'playground') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: keep the default */ }
})();
