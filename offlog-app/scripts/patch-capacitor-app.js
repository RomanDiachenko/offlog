// Runs on `npm install` (postinstall). @capacitor/app's
// toggleBackButtonHandler() flips its OnBackPressedCallback from the plugin
// thread; androidx then re-registers the window's OnBackInvokedCallback off
// the main thread and Android can keep its own "leave the app" callback on
// top, so Back exits instead of reaching the app. Running the flip on the UI
// thread fixes it. Idempotent; drop this script once the plugin does it itself.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const file = 'node_modules/@capacitor/app/android/src/main/java/com/capacitorjs/plugins/app/AppPlugin.java';
if (!existsSync(file)) process.exit(0);

const src = readFileSync(file, 'utf8');
const from = /(\n\s*)this\.onBackPressedCallback\.setEnabled\(enabled\);\s*\n(\s*)call\.resolve\(\);/;
// Already on the UI thread (ours, or upstream's own fix in any formatting):
// leave it alone rather than nest a second runOnUiThread.
const method = src.slice(src.indexOf('toggleBackButtonHandler('), src.indexOf('getAppLanguage('));
if (/runOnUiThread/.test(method)) process.exit(0);
const m = src.match(from);
// Fails the install rather than warning: a warning scrolls past in CI, and
// the release APK would quietly exit the app on Back again.
if (!m) {
  console.error('patch-capacitor-app: toggleBackButtonHandler changed upstream and the patch no longer applies. Check whether @capacitor/app now runs it on the UI thread, then update or remove this script.');
  process.exit(1);
}
const out = src.replace(from,
  '\n        getActivity().runOnUiThread(() -> {\n            this.onBackPressedCallback.setEnabled(enabled);\n            call.resolve();\n        });');
writeFileSync(file, out);
console.log('patch-capacitor-app: toggleBackButtonHandler now runs on the UI thread');
