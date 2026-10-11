<script lang="ts">
  import { ICON } from '../shared/iconPaths';
  // The task-pin mark; desktop views use this, never their own pin path.
  export let size = 11;
  export let filled = true;
  export let stroked = false; // CardDetail's toggle button keeps an outline even when unfilled
</script>

<svg viewBox="0 0 24 24" width={size} height={size}
  fill={filled ? 'currentColor' : 'none'}
  stroke={stroked ? 'currentColor' : 'none'}
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  {@html ICON.pin}
</svg>
