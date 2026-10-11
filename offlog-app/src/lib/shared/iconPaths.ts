// The one icon set both shells draw from: path data on a 24px grid, stroke
// only. The phone wraps these in phone/icons.ts; desktop puts them in an
// inline <svg viewBox="0 0 24 24"> with {@html}. Each meaning has exactly one
// shape, and no shape means two things: change an icon here, never per shell.
export const ICON = {
  // Sync (circular arrows) and Repeat (square loop) must never swap.
  sync: '<path d="M4 12a8 8 0 0 1 13.6-5.7M20 12a8 8 0 0 1-13.6 5.7"/><path d="M17.3 2.5l.3 4.3-4.3.3M6.7 21.5l-.3-4.3 4.3-.3"/>',
  repeat: '<path d="M4 11V9a3 3 0 013-3h12M16 3l3 3-3 3M20 13v2a3 3 0 01-3 3H5M8 21l-3-3 3-3"/>',
  // Blocked by another task; the padlock is App lock only.
  blocked: '<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  // Clocks: History turns back, Overdue alerts, the plain clock is a time.
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.2 3.8v4.6h4.6"/><path d="M12 8v4l3 2"/>',
  overdue: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.3v.2"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  related: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  // Calendars: a plain one is a date; Today has a dot, Agenda has lines.
  date: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4"/>',
  today: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4"/><circle cx="12" cy="15" r="2"/>',
  agenda: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4M7.5 13.5h9M7.5 17h5"/>',
  // Three plain lines are the menu; a list view has bullets; steps have ticks.
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  listView: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="18" r="1.1"/>',
  steps: '<path d="M3.5 6.2l1.6 1.6L8.2 4.7M3.5 12.7l1.6 1.6 3.1-3.1M3.5 19.2l1.6 1.6 3.1-3.1M11.5 6.3h8.5M11.5 12.8h8.5M11.5 19.3h8.5"/>',
  restore: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  backup: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  backUpNow: '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5M5 15v4a2 2 0 002 2h10a2 2 0 002-2v-4"/>',
  restoreFile: '<path d="M12 14V3M7.5 7.5L12 3l4.5 4.5M5 15v4a2 2 0 002 2h10a2 2 0 002-2v-4"/>',
  storage: '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z"/><path d="M15 3.8a8.5 8.5 0 0 1 5.2 5.2H15z"/>',
  organize: '<path d="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  attach: '<path d="M20 11.5l-8 8a5 5 0 01-7-7l8.5-8.5a3.3 3.3 0 014.7 4.7L9.7 17.2a1.7 1.7 0 01-2.4-2.4L15 7"/>',
  gear: '<path d="M12.2 2h-.4a2 2 0 00-2 2v.2a2 2 0 01-1 1.7l-.4.3a2 2 0 01-2 0l-.2-.1a2 2 0 00-2.7.7l-.2.4a2 2 0 00.7 2.7l.2.1a2 2 0 011 1.7v.5a2 2 0 01-1 1.7l-.2.1a2 2 0 00-.7 2.7l.2.4a2 2 0 002.7.7l.2-.1a2 2 0 012 0l.4.3a2 2 0 011 1.7v.2a2 2 0 002 2h.4a2 2 0 002-2v-.2a2 2 0 011-1.7l.4-.3a2 2 0 012 0l.2.1a2 2 0 002.7-.7l.2-.4a2 2 0 00-.7-2.7l-.2-.1a2 2 0 01-1-1.7v-.5a2 2 0 011-1.7l.2-.1a2 2 0 00.7-2.7l-.2-.4a2 2 0 00-2.7-.7l-.2.1a2 2 0 01-2 0l-.4-.3a2 2 0 01-1-1.7V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M6 16v-5a6 6 0 0112 0v5l1.5 2h-15zM10 21h4"/>',
  pin: '<path d="M12 16v5M8.5 3h7l-.7 6 3.2 3v2H6v-2l3.2-3z"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
} as const;
