<script lang="ts">
  // The task-pin mark: a pushpin, the same shape as the phone's I.pin.
  // One shared shape — don't re-hardcode it in CardDetail/KanbanBoard/ListView.
  export let size = 11;
  export let filled = true;
  export let stroked = false; // CardDetail's toggle button keeps an outline even when unfilled
</script>

<svg viewBox="0 0 24 24" width={size} height={size}
  fill={filled ? 'currentColor' : 'none'}
  stroke={stroked ? 'currentColor' : 'none'}
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 16v5M8.5 3h7l-.7 6 3.2 3v2H6v-2l3.2-3z"/>
</svg>
