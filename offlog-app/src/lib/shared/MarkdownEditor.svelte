<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { markdown } from '@codemirror/lang-markdown';
  import { Strikethrough } from '@lezer/markdown';
  import { markdownLiveView, linkUrlAt } from './markdownLiveView';

  export let value: string;
  export let placeholderText = '';
  // The typing area's spoken name; a placeholder alone is not a name.
  export let label = 'Notes';
  // Opens a link's address. A tap on a link opens it while the note isn't
  // being edited; while it is, the tap places the cursor and Ctrl/Cmd+click
  // opens. Without a handler links are only styled.
  export let onLink: ((url: string) => void) | null = null;

  let host: HTMLDivElement;
  let view: EditorView;

  // Only the outside world (switching to a different task, undo/redo at the
  // app level) should push text into the editor -- pushing on every local
  // keystroke as well would fight CodeMirror's own transaction, resetting
  // the cursor/selection on each character typed.
  let lastEmitted = value;

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ extensions: [Strikethrough] }),
          markdownLiveView(),
          EditorView.lineWrapping,
          placeholderExt(placeholderText),
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
          // mousedown, not click: by click time the editor has taken focus.
          EditorView.domEventHandlers({
            mousedown(e, v) {
              if (!onLink || (v.hasFocus && !(e.ctrlKey || e.metaKey))) return false;
              const el = (e.target as Element | null)?.closest?.('.cm-md-link');
              const url = el ? linkUrlAt(v, v.posAtDOM(el)) : null;
              if (!url) return false;
              e.preventDefault();
              onLink(url);
              return true;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              lastEmitted = u.state.doc.toString();
              value = lastEmitted;
            }
          }),
          EditorView.theme({
            '&': { fontSize: '.85rem' },
          }),
        ],
      }),
    });
  });

  onDestroy(() => view?.destroy());

  $: if (view && value !== lastEmitted) {
    lastEmitted = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }
</script>

<div class="md-editor" bind:this={host}></div>

<style>
  .md-editor {
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--field-bg);
    min-height: 90px;
    overflow: hidden;
  }
  .md-editor:focus-within { border-color: var(--accent); background: var(--surface); }

  .md-editor :global(.cm-editor) { height: 100%; }
  .md-editor :global(.cm-scroller) {
    font-family: 'Hanken Grotesk', sans-serif;
    line-height: 1.5;
    padding: .1rem 0;
  }
  .md-editor :global(.cm-content) { padding: .5rem .65rem; color: var(--text); caret-color: var(--accent); }
  .md-editor :global(.cm-line) { padding: 0; }
  .md-editor :global(.cm-gutters) { display: none; }
  .md-editor :global(.cm-placeholder) { color: var(--faint); font-style: normal; }
  .md-editor :global(.cm-selectionBackground) { background: color-mix(in srgb, var(--accent) 25%, transparent) !important; }
  .md-editor :global(.cm-focused) { outline: none; }

  .md-editor :global(.cm-md-mark) { opacity: .4; }
  .md-editor :global(.cm-md-strong) { font-weight: 700; }
  .md-editor :global(.cm-md-em) { font-style: italic; }
  .md-editor :global(.cm-md-strike) { text-decoration: line-through; opacity: .75; }
  .md-editor :global(.cm-md-code) {
    font-family: var(--mono); font-size: .92em; background: var(--col-bg);
    border-radius: 4px; padding: .05em .3em;
  }
  .md-editor :global(.cm-md-link) { color: var(--accent); text-decoration: underline; }
  .md-editor :global(.cm-md-link-url) { opacity: .4; font-size: .88em; }
  .md-editor :global(.cm-md-list-marker) { color: var(--faint); }
  .md-editor :global(.cm-md-hr) { color: var(--border-strong); letter-spacing: .1em; }

  .md-editor :global(.cm-md-quote-line) {
    border-left: 3px solid var(--border-strong);
    padding-left: .6em;
    color: var(--muted);
  }
  .md-editor :global(.cm-md-codeblock-line) {
    background: var(--col-bg);
    font-family: var(--mono);
    font-size: .88em;
  }

  .md-editor :global(.cm-md-h-line) { font-weight: 700; line-height: 1.3; }
  .md-editor :global(.cm-md-h-line1) { font-size: 1.15em; }
  .md-editor :global(.cm-md-h-line2) { font-size: 1.08em; }
  .md-editor :global(.cm-md-h-line3),
  .md-editor :global(.cm-md-h-line4) { font-size: 1em; }
</style>
