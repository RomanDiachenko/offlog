<script lang="ts">
  // Settings → Privacy; the content lives in shared/privacyPoints.ts. The
  // desktop app has no way to open a web page, so the full policy's address
  // is shown to copy instead.
  import { ICON } from '../../shared/iconPaths';
  import { PRIVATE, LIMITS, PRIVACY_URL } from '../../shared/privacyPoints';
  import { showError } from '../../store';

  let copied = false;
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(PRIVACY_URL);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      showError('Could not copy the address. Please try again.');
    }
  }
</script>

              {#each [{ label: 'What stays private', points: PRIVATE }, { label: 'Limits to know', points: LIMITS }] as g (g.label)}
                <div class="setting-group">
                  <div class="setting-section-title">{g.label}</div>
                  {#each g.points as p (p.title)}
                    <div class="pv-row">
                      <span class="pv-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{@html ICON[p.icon]}</svg></span>
                      <span class="pv-k"><span class="pv-t">{p.title}</span><span class="pv-s">{p.text}</span></span>
                    </div>
                  {/each}
                </div>
              {/each}
              <div class="setting-group">
                <div class="setting-section-title">Full privacy policy</div>
                <div class="pv-link">
                  <span class="pv-url">{PRIVACY_URL}</span>
                  <button class="export-btn" on:click={copyAddress}>{copied ? 'Copied' : 'Copy'}</button>
                </div>
              </div>

<style>
  .pv-row { display: flex; gap: 12px; align-items: flex-start; }
  .pv-row + .pv-row { border-top: 1px solid var(--line); padding-top: .6rem; }
  .pv-ic { width: 30px; height: 30px; border-radius: var(--r-s); flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--muted); background: var(--field-bg); }
  .pv-k { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .pv-t { font-size: var(--fs-m); font-weight: 600; color: var(--text); }
  .pv-s { font-size: var(--fs-s); color: var(--muted); line-height: 1.45; }
  .pv-link { display: flex; align-items: center; gap: .75rem; }
  .pv-url { flex: 1; min-width: 0; font-size: var(--fs-s); color: var(--muted); overflow-wrap: anywhere; user-select: text; }
</style>
