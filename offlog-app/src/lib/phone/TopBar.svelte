<script lang="ts">
  import { back, actions } from './nav';
  import { I } from './icons';
  import { onDestroy } from 'svelte';
  import { claimStatusBar } from '../theme';

  export let title: string;
  export let sub = '';
  // A tab's first screen has no back arrow and carries the Settings gear.
  export let root = false;
  // Opt-in: a long title wraps to two lines instead of truncating at one.
  export let wrap = false;
  // A main screen's header: a glass panel on a stage lit faintly by `space`
  // (else the accent), the desktop views' look. Expects the screen's 16px gutter.
  export let panel = false;
  export let space: string | null = null;
  // Every screen has one TopBar, so it decides the strip under the clock: a
  // glowing header carries its tint up there, any other screen the plain strip.
  const strip = claimStatusBar(panel ? { lightIcons: false, glow: true } : null);
  onDestroy(() => strip.release());
</script>

<div class="wrap-stage" class:stage={panel} style:--space={panel ? space : null}>
<div class:head={panel} class:glass={panel} class:fluid-panel={panel}>
<header class="bar">
  {#if !root}<button class="ib back" on:click={back} aria-label="Back">{@html I.back}</button>{/if}
  <h1 class:root class:wrap>{title}</h1>
  <span class="acts">
    <slot />
    {#if root}<button class="ib" on:click={() => actions.openSettings()} aria-label="Settings">{@html I.gear}</button>{/if}
  </span>
</header>
{#if sub}<p class="sub"><slot name="sub-lead" />{sub}<slot name="sub-end" /></p>{/if}
</div>
</div>

<style>
  .bar { display: flex; align-items: center; gap: 4px; min-height: 64px; }
  h1 { flex: 1; min-width: 0; margin: 0; font-size: var(--p-fs-t); font-weight: 700; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  h1.root { margin-left: 2px; }
  h1.wrap { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; line-height: 1.2; overflow-wrap: anywhere; padding: 6px 0; }
  .acts { display: flex; gap: 2px; flex-shrink: 0; }
  .ib, .acts :global(.ib) {
    width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: none; border: 0; padding: 0; cursor: pointer; color: var(--muted);
    transition: background var(--dur-hover) var(--ease-hover), color var(--dur-hover) var(--ease-hover);
  }
  .back { margin-left: -10px; color: var(--text); }
  .back :global(svg) { width: 24px; height: 24px; }
  .ib:active, .acts :global(.ib:active) { background: var(--col-bg); }
  /* 48px touch target around the 44px visual. */
  .ib, .acts :global(.ib) { position: relative; }
  .ib::before, .acts :global(.ib::before) { content: ''; position: absolute; inset: -2px; border-radius: 50%; }
  .acts :global(.ib.on) { color: var(--accent-ink); background: color-mix(in srgb, var(--accent) 14%, var(--surface)); }
  .sub { font-size: var(--p-fs-s); color: var(--faint); margin: -6px 2px 16px; display: flex; align-items: center; gap: 6px; }
  /* Without a panel the wrappers drop out of layout. */
  .wrap-stage:not(.stage), .wrap-stage:not(.stage) > div { display: contents; }
  /* Sticks to the top of the screen's scroller, so Back and the screen's
     actions stay in reach and the list passes under the glass. */
  .stage {
    position: sticky; top: 0; z-index: 3;
    margin: 0 -16px 14px; padding: 10px 12px 6px;
    background:
      radial-gradient(70% 110% at 10% 55%, color-mix(in srgb, var(--space, var(--accent)) 9%, transparent), transparent 70%),
      radial-gradient(50% 100% at 90% 50%, color-mix(in srgb, var(--accent) 5%, transparent), transparent 70%),
      linear-gradient(var(--top-tint), var(--bg));
  }
  .head { padding: 2px 10px 2px 14px; }
  .head .sub { margin-bottom: 12px; }
  .head h1.root { margin-left: 0; }
  /* Sideways, a page keeps a centred column with a wider gutter (PhoneApp),
     so the stage stays inside it; a project screen keeps the 16px gutter. */
  @media (orientation: landscape) and (max-height: 500px) {
    .stage { margin-inline: 0; padding-inline: 0; }
    :global(.screen.board) .stage { margin-inline: -16px; padding-inline: 12px; }
  }
</style>
