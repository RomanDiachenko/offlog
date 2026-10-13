<script lang="ts">
  import { otherHostsDetected, syncDataSetAside } from '../../../config';
  import { timeAgo } from '../../utils';
  import type { ConflictInfo } from '../../db';

  export let isAndroid: boolean;
  export let isTauri: boolean;
  export let syncEnabled: boolean;
  export let toggleSyncEnabled: () => void;
  export let connectionStatus: { text: string; tone: string };
  export let showConnectModal: boolean;
  export let showConflictsModal: boolean;
  export let deviceName: string;
  export let saveDeviceName: () => void;
  export let deviceLastSeen: { device: string; lastSeen: string }[];
  export let conflictCount: number;
  export let rejected = 0;
  export let conflictList: ConflictInfo[];
</script>

              <div class="setting-group">
                                <div class="setting-row">
                  <span class="setting-label">{syncEnabled ? 'Sync enabled' : 'Sync paused'}</span>
                  <button class="toggle-btn" class:on={syncEnabled} on:click={toggleSyncEnabled} aria-label="Toggle sync" role="switch" aria-checked={syncEnabled}>
                    <span class="toggle-knob"></span>
                  </button>
                </div>
                <p class="setting-hint" class:setting-hint-warn={connectionStatus.tone === 'warn'} class:success-hint={connectionStatus.tone === 'ok'}>{connectionStatus.text}</p>
                {#if $syncDataSetAside}<p class="setting-hint setting-hint-warn">This PC couldn't open its sync data, so it started it fresh. Your devices are uploading their copies again, and nothing on them was lost. The old data is kept in {$syncDataSetAside}.</p>{/if}
                {#if rejected > 0}<p class="setting-hint setting-hint-warn">Refused {rejected} item{rejected === 1 ? '' : 's'} from the sync server that none of your devices wrote. Nothing was changed.</p>{/if}
                {#if syncEnabled && isTauri && $otherHostsDetected.length}
                  <p class="setting-hint setting-hint-warn">
                    Another Offlog host ("{$otherHostsDetected[0].name}") was found on this
                    network. Running two hosts on the same network means they won't share
                    data — make sure every device pairs with only one.
                  </p>
                {/if}
              </div>

              {#if syncEnabled}
                <div class="setting-group">
                  <div class="setting-section-title">Connect a device</div>
                  {#if isAndroid || isTauri}
                    <button class="link-row link-row-compact" on:click={() => showConnectModal = true}>
                      <span class="link-row-title">Connect a device</span>
                      <svg viewBox="0 0 8 14" width="7" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1 7,7 1,13"/></svg>
                    </button>
                  {:else}
                    <p class="setting-hint">On your phone, open Settings → Sync → Find my computer.</p>
                  {/if}
                  <p class="setting-hint">Using your own server? Set it up in Advanced.</p>
                </div>

                <div class="setting-group">
                  <div class="setting-section-title">This device</div>
                  <label class="field-label">
                    Name
                    <input bind:value={deviceName} placeholder="PC" on:blur={saveDeviceName} enterkeyhint="done"
                      on:keydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
                  </label>
                  <p class="setting-hint">Shown next to changes made here.</p>
                </div>

                {#if deviceLastSeen.length}
                  <div class="setting-group">
                    <div class="setting-section-title">Devices seen recently</div>
                    {#each deviceLastSeen as d (d.device)}
                      <div class="setting-row">
                        <span class="storage-info device-name-row">{d.device}{#if d.device === deviceName}<span class="this-device-tag">this device</span>{/if}</span>
                        <span class="storage-info" style="color: var(--muted)">Last change {timeAgo(d.lastSeen)}</span>
                      </div>
                    {/each}
                  </div>
                {/if}

                {#if conflictCount > 0 || conflictList.length > 0}
                  <div class="setting-group">
                    <div class="setting-section-title">Conflicts</div>
                    <button class="link-row link-row-compact" on:click={() => showConflictsModal = true}>
                      <span class="link-row-title">Resolve conflicts</span>
                      <span class="nav-badge">{conflictList.length || conflictCount}</span>
                    </button>
                  </div>
                {/if}
              {/if}

