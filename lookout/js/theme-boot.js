// Lookout · theme boot. A classic (render-blocking) same-origin script so the
// saved theme applies before first paint — CSP forbids inline scripts, and
// module scripts run too late to avoid a flash. Storage may be unavailable.
(function () {
  'use strict';
  try {
    var mode = window.localStorage.getItem('lookout.theme');
    if (mode === 'dark' || mode === 'light') document.documentElement.setAttribute('data-theme', mode);
  } catch (e) {
    /* storage blocked: follow the system theme */
  }
}());
