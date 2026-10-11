// The Android launch cover (index.html's #launch, switched on by
// public/theme-init.js): the splash's colour and mark, painted from the first
// frame and over the status bar, so Android's splash hands straight over to
// it. It fades out once the app is drawn underneath. No-op anywhere it was
// never shown.
import { launchOutMs } from './motion';

export function endLaunchCover(done: () => void): void {
  const root = document.documentElement;
  const el = document.getElementById('launch');
  const finish = () => { root.classList.remove('launching', 'launch-dark'); el?.remove(); done(); };
  if (!el || !root.classList.contains('launching')) { finish(); return; }
  const ms = launchOutMs();
  if (!ms || typeof el.animate !== 'function') { finish(); return; }
  const easing = 'cubic-bezier(0.3, 0, 0.8, 0.15)'; // --ease-accelerate: an exit
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing, fill: 'forwards' });
  el.firstElementChild?.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.92)' }], { duration: ms, easing, fill: 'forwards' });
  setTimeout(finish, ms);
}
