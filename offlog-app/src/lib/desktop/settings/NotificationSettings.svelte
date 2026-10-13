<script lang="ts">
  import { slide } from 'svelte/transition';
  import { revealIn, revealOut } from '../../motion';
  import TimePicker from '../TimePicker.svelte';
  import type { QuietHours } from '../../../config';
  import { requestPermission, permissionState, exactAlarmState, requestExactAlarmPermission } from '../../notifications';

  export let isAndroid: boolean;
  export let isTauri: boolean;
  export let notificationsEnabled: boolean;
  export let toggleNotificationsEnabled: () => void;
  export let defaultReminderTime: string;
  export let saveDefaultReminderTime: (e: CustomEvent<string>) => void;
  export let quietHours: QuietHours;
  export let saveQuietHours: (patch: Partial<QuietHours>) => void;
</script>


              <div class="setting-group">
                                <div class="setting-row">
                  <span class="setting-label">{notificationsEnabled ? 'Task reminders enabled' : 'Task reminders off'}</span>
                  <button class="toggle-btn" class:on={notificationsEnabled} on:click={toggleNotificationsEnabled} aria-label="Toggle task reminders" role="switch" aria-checked={notificationsEnabled}>
                    <span class="toggle-knob"></span>
                  </button>
                </div>
                <p class="setting-hint">Off means no reminders at all, whatever the system allows.</p>
              </div>

              {#if notificationsEnabled}
              <div class="reveal-wrap" in:slide={revealIn} out:slide={revealOut}>
              <div class="setting-group">
                <div class="setting-section-title">Permission</div>
                <div class="setting-row">
                  <span class="setting-label">
                    {#if $permissionState === 'granted'}Enabled — task reminders will notify you
                    {:else if $permissionState === 'denied'}Blocked — {isTauri ? 'allow notifications for Offlog in Windows Settings → Notifications' : 'allow notifications for this site in your browser settings'}
                    {:else if $permissionState === 'unsupported'}Not supported in this browser
                    {:else}Not enabled yet{/if}
                  </span>
                  {#if $permissionState !== 'granted' && $permissionState !== 'unsupported'}
                    <button class="export-btn" on:click={() => requestPermission()}>Enable</button>
                  {/if}
                </div>
                {#if isAndroid}
                  <div class="setting-row">
                    <span class="setting-label">
                      {#if $exactAlarmState === 'granted'}Precise timing enabled — reminders fire exactly on time
                      {:else if $exactAlarmState === 'denied'}Not enabled — reminders may arrive a few minutes late
                      {:else}Checking…{/if}
                    </span>
                    {#if $exactAlarmState === 'denied'}
                      <button class="export-btn" on:click={() => requestExactAlarmPermission()}>Enable</button>
                    {/if}
                  </div>
                  <p class="setting-hint">
                    Android's "Alarms & reminders" permission. Without it, reminders still come, a few minutes late.
                  </p>
                {/if}
              </div>

              <div class="setting-group">
                <div class="setting-section-title">Reminder timing</div>
                <label class="field-label">
                  Default "remind me on the due date" time
                  <TimePicker value={defaultReminderTime} label="Default reminder time" on:change={saveDefaultReminderTime} />
                </label>
                <p class="setting-hint">For tasks set to remind on their due date.</p>
              </div>

              <div class="setting-group">
                <div class="setting-section-title">Quiet hours</div>
                <div class="setting-row">
                  <span class="setting-label">Delay reminders until quiet hours end</span>
                  <button class="toggle-btn" class:on={quietHours.enabled} on:click={() => saveQuietHours({ enabled: !quietHours.enabled })} aria-label="Toggle quiet hours" role="switch" aria-checked={quietHours.enabled}>
                    <span class="toggle-knob"></span>
                  </button>
                </div>
                {#if quietHours.enabled}
                  <div class="setting-row" in:slide={revealIn} out:slide={revealOut}>
                    <span class="setting-label">From</span>
                    <TimePicker value={quietHours.start} label="Quiet hours start" placement="up" on:change={(e) => saveQuietHours({ start: e.detail })} />
                    <span class="setting-label">to</span>
                    <TimePicker value={quietHours.end} label="Quiet hours end" placement="up" on:change={(e) => saveQuietHours({ end: e.detail })} />
                  </div>
                {/if}
                <p class="setting-hint">Reminders due in this window wait until it ends.</p>
              </div>
              </div>
              {/if}
