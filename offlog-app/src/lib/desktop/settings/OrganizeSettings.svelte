<script lang="ts">
  export let openSpaceManager: () => void;
  export let openTagManager: () => void;
  export let openCustomFieldManager: () => void;
  export let openArchivedProjectsManager: () => void;
</script>

              <div class="setting-group">
                <div class="setting-section-title">Workspace</div>
                <button class="link-row link-row-compact" on:click={openSpaceManager}>
                  <span class="link-row-title">Spaces</span>
                  <svg viewBox="0 0 8 14" width="7" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1 7,7 1,13"/></svg>
                </button>
                <p class="setting-hint compact-hint">The groups your projects live in, like Personal and Work.</p>
                <button class="link-row link-row-compact" on:click={openTagManager}>
                  <span class="link-row-title">Tags</span>
                  <svg viewBox="0 0 8 14" width="7" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1 7,7 1,13"/></svg>
                </button>
                <p class="setting-hint compact-hint">Rename tags or change their colors.</p>
                <button class="link-row link-row-compact" on:click={openCustomFieldManager}>
                  <span class="link-row-title">Fields</span>
                  <svg viewBox="0 0 8 14" width="7" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1 7,7 1,13"/></svg>
                </button>
                <p class="setting-hint compact-hint">Extra fields every task can have.</p>
                <button class="link-row link-row-compact" on:click={openArchivedProjectsManager}>
                  <span class="link-row-title">Archived projects</span>
                  <svg viewBox="0 0 8 14" width="7" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1 7,7 1,13"/></svg>
                </button>
                <p class="setting-hint compact-hint">Bring a project back, or delete it for good.</p>
              </div>

