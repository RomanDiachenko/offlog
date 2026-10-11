// Command palette: deliberately a small, fixed list of navigation/action
// shortcuts plus one 'Go to project' entry per project, not a plugin
// system. Matched against GlobalSearch's existing query box by plain
// substring on label+keywords, the same matching style as searchAllTasks()
// in db.ts — no fuzzy-matching library.
import type { ProjectDoc, SpaceDoc } from '../types';
import { ICON } from '../shared/iconPaths';
export interface Command {
  id: string;
  label: string;
  keywords: string; // lowercase, space-separated extra match terms
  run: () => void;
  icon: keyof typeof ICON;
  // True for commands whose run() opens another closeOnBack()-tracked
  // overlay (QuickAdd/Settings/History/Recycle bin) rather than just navigating
  // or toggling a setting. GlobalSearch.svelte must close itself via
  // discardTop() rather than requestClose() for these: requestClose()'s real
  // history.back() races the new overlay's own pushState, and the new overlay
  // then never appears. See modalStack.ts's discardTop() comment.
  opensOverlay?: boolean;
  // Listed only once something is typed: one entry per project would bury
  // the fixed commands in an empty palette.
  onlyWhenSearched?: boolean;
}

export interface CommandContext {
  goToDashboard: () => void;
  goToFocus: () => void;
  goToAgenda: () => void;
  openQuickAdd: () => void;
  toggleTheme: () => void;
  toggleHighContrast: () => void;
  openSettings: () => void;
  openTimeTravel: () => void;
  openTrash: () => void;
  syncNow: () => void;
}

// "Go to project" entries, so a board can be opened by name from Ctrl+K.
// Archived projects stay out, as in the sidebar.
export function projectCommands(projects: ProjectDoc[], spaces: SpaceDoc[], open: (id: string) => void): Command[] {
  return projects.filter(p => !p.archived).map(p => {
    const space = spaces.find(s => s._id === p.space_id)?.name;
    return {
      id: `project:${p._id}`,
      label: `Go to project · ${p.name}${space ? ` (${space})` : ''}`,
      keywords: 'project board open',
      run: () => open(p._id!),
      icon: 'project',
      onlyWhenSearched: true,
    };
  });
}

export function getCommands(ctx: CommandContext): Command[] {
  return [
    { id: 'dashboard', label: 'Go to Dashboard', keywords: 'home view', run: ctx.goToDashboard, icon: 'dashboard' },
    { id: 'focus', label: 'Go to Focus', keywords: 'view commitment', run: ctx.goToFocus, icon: 'focus' },
    { id: 'agenda', label: 'Go to Agenda', keywords: 'deadlines calendar view week', run: ctx.goToAgenda, icon: 'agenda' },
    { id: 'quickadd', label: 'Add task', keywords: 'new task create', run: ctx.openQuickAdd, opensOverlay: true, icon: 'plus' },
    { id: 'theme', label: 'Switch dark / light mode', keywords: 'appearance dark light theme', run: ctx.toggleTheme, icon: 'theme' },
    { id: 'contrast', label: 'Turn high contrast on or off', keywords: 'appearance accessibility', run: ctx.toggleHighContrast, icon: 'contrast' },
    { id: 'settings', label: 'Open settings', keywords: 'preferences config organize sync notifications', run: ctx.openSettings, opensOverlay: true, icon: 'gear' },
    { id: 'timetravel', label: 'Open History', keywords: 'history activity log journal retrospective', run: ctx.openTimeTravel, opensOverlay: true, icon: 'history' },
    { id: 'trash', label: 'Open Recycle bin', keywords: 'recycle bin deleted restore trash', run: ctx.openTrash, opensOverlay: true, icon: 'trash' },
    { id: 'sync', label: 'Sync now', keywords: 'refresh couchdb nyxdb replicate', run: ctx.syncNow, icon: 'sync' },
  ];
}
