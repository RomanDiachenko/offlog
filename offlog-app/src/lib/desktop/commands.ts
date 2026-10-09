// Command palette: deliberately a small, fixed list of navigation/action
// shortcuts plus one 'Go to project' entry per project, not a plugin
// system. Matched against GlobalSearch's existing query box by plain
// substring on label+keywords, the same matching style as searchAllTasks()
// in db.ts — no fuzzy-matching library.
import type { ProjectDoc, SpaceDoc } from '../types';
export interface Command {
  id: string;
  label: string;
  keywords: string; // lowercase, space-separated extra match terms
  run: () => void;
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
      onlyWhenSearched: true,
    };
  });
}

export function getCommands(ctx: CommandContext): Command[] {
  return [
    { id: 'dashboard', label: 'Go to Dashboard', keywords: 'home view', run: ctx.goToDashboard },
    { id: 'focus', label: 'Go to Focus', keywords: 'view commitment', run: ctx.goToFocus },
    { id: 'agenda', label: 'Go to Agenda', keywords: 'deadlines calendar view week', run: ctx.goToAgenda },
    { id: 'quickadd', label: 'Add task', keywords: 'new task create', run: ctx.openQuickAdd, opensOverlay: true },
    { id: 'theme', label: 'Switch dark / light mode', keywords: 'appearance dark light theme', run: ctx.toggleTheme },
    { id: 'contrast', label: 'Turn high contrast on or off', keywords: 'appearance accessibility', run: ctx.toggleHighContrast },
    { id: 'settings', label: 'Open settings', keywords: 'preferences config organize sync notifications', run: ctx.openSettings, opensOverlay: true },
    { id: 'timetravel', label: 'Open History', keywords: 'history activity log journal retrospective', run: ctx.openTimeTravel, opensOverlay: true },
    { id: 'trash', label: 'Open Recycle bin', keywords: 'recycle bin deleted restore trash', run: ctx.openTrash, opensOverlay: true },
    { id: 'sync', label: 'Sync now', keywords: 'refresh couchdb nyxdb replicate', run: ctx.syncNow },
  ];
}
