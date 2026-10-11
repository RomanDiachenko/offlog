<script lang="ts">
  // Settings → Advanced → Privacy; the content lives in shared/privacyPoints.ts.
  import { I } from '../icons';
  import { ICON } from '../../shared/iconPaths';
  import { PRIVATE, LIMITS } from '../../shared/privacyPoints';
  import { openLink, PRIVACY_URL } from '../openLink';
  import TopBar from '../TopBar.svelte';
</script>

<TopBar title="Privacy" />

{#each [{ label: 'What stays private', points: PRIVATE }, { label: 'Limits to know', points: LIMITS }] as g (g.label)}
  <div class="p-lab">{g.label}</div>
  <div class="p-group">
    {#each g.points as p (p.title)}
      <div class="p-row pt">
        <span class="ri"><svg class="i" viewBox="0 0 24 24" aria-hidden="true">{@html ICON[p.icon]}</svg></span>
        <span class="p-k"><span>{p.title}</span><span class="p-sub">{p.text}</span></span>
      </div>
    {/each}
  </div>
{/each}
<div class="p-group">
  <button class="p-row" on:click={() => openLink(PRIVACY_URL)}>
    <span class="ri">{@html I.shield}</span>
    <span class="p-k"><span>Full privacy policy</span></span>
    <span class="chev">{@html I.ext}</span>
  </button>
</div>

<style>
  .ri { width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--muted); background: var(--col-bg); }
  .pt { cursor: default; align-items: flex-start; }
  .p-row.pt:active { background: none; }
  .pt .p-k > span:first-child { white-space: normal; }
  .chev { display: flex; margin-left: auto; color: var(--faint); }
</style>
