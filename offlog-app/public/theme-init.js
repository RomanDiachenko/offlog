(function () {
  var m = localStorage.getItem('theme_mode');
  if (!m) m = localStorage.getItem('dark') ? 'dark' : 'system';
  var dark = m === 'dark' || (m === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.body.classList.add('dark');
  // Pre-paint so mobile browser chrome never flashes the wrong colour;
  // applyTheme() keeps it in step from then on. Must match
  // --statusbar-fill's two values in app.css.
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#181a20' : '#f6f7f9');
  if (localStorage.getItem('high_contrast')) document.body.classList.add('high-contrast');
  // The launch cover (index.html #launch, ended by launch.ts) continues
  // Android's splash on a phone-sized screen. Same query as phone/nav.ts's
  // PHONE_QUERY; never in a browser or the desktop app.
  var cap = window.Capacitor;
  var phone = window.matchMedia && window.matchMedia('(max-width: 768px), (max-height: 500px) and (orientation: landscape)').matches;
  if (cap && cap.isNativePlatform && cap.isNativePlatform() && phone) {
    document.documentElement.classList.add('launching');
    if (dark) document.documentElement.classList.add('launch-dark');
  }
})();
