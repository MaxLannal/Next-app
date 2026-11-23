import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { EditorState, Plugin, PluginKey, TextSelection, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';

/** One match in the document's text. ProseMirror positions: `from` is the first character's. */
export type Match = { from: number; to: number };

/**
 * Every occurrence of `query` in the document's text, across mark boundaries.
 * Case-insensitive unless `caseSensitive`. Matches do not overlap.
 */
export function findMatches(doc: ProseMirrorNode, query: string, caseSensitive: boolean): Match[] {
  if (query === '') return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, '\n', '\n');
    const hay = caseSensitive ? text : text.toLowerCase();
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
      // A textblock's content starts one position after the block.
      matches.push({ from: pos + 1 + at, to: pos + 1 + at + needle.length });
    }
    return false;
  });
  return matches;
}

/** `doc` with every match of `query` replaced by `text`. Read-only, so the result is checked as data. */
export function replaceAllInDoc(doc: ProseMirrorNode, query: string, text: string): ProseMirrorNode {
  const matches = findMatches(doc, query, false);
  if (matches.length === 0) return doc;
  const tr = new Transaction(doc);
  // Edits apply back to front, so each earlier position stays true. A transaction
  // made from text alone has no steps until a TextSelection is its selection.
  tr.setSelection(TextSelection.near(tr.doc.resolve(1)));
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const { from, to } = matches[i]!;
    if (text === '') tr.delete(from, to);
    else tr.replaceWith(from, to, doc.type.schema.text(text));
  }
  return tr.doc;
}

type SearchState = {
  query: string;
  caseSensitive: boolean;
  /** Index into the matches; -1 when there are none. */
  active: number;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      /** Sets the query, highlights every match and selects the first. */
      setSearch: (options: { query: string; caseSensitive?: boolean }) => ReturnType;
      /** Selects the next match after the selection, wrapping to the first. */
      nextMatch: () => ReturnType;
      /** Selects the match before the selection, wrapping to the last. */
      previousMatch: () => ReturnType;
      /** Replaces the current match with `text`, then selects the next. */
      replaceCurrent: (text: string) => ReturnType;
      /** Replaces every match with `text` in one undoable step. */
      replaceAll: (text: string) => ReturnType;
      /** The number of matches for the current query. */
      matchCount: () => ReturnType;
    };
  }
}

const matchesOf = (doc: ProseMirrorNode, search: SearchState | null): Match[] =>
  search ? findMatches(doc, search.query, search.caseSensitive) : [];

const META = 'findReplace';
const SEARCH = new PluginKey<SearchState | null>(META);

/** The search as the plugin holds it: its query, case and active match. */
export const searchState = (state: EditorState): SearchState | null => SEARCH.getState(state) ?? null;

/** How many matches `query` has in `doc` — what the bar shows beside the field. */
export function countInDoc(doc: ProseMirrorNode, query: string, caseSensitive: boolean): number {
  return findMatches(doc, query, caseSensitive).length;
}

/** The schema's text node, or an empty list when `text` is empty. */
const contentFor = (schema: Schema, text: string) => (text === '' ? [] : schema.text(text));

/** The matches the search plugin holds right now, for the bar's count and the tests. */
export function countMatches(state: EditorState): number {
  return matchesOf(state.doc, searchState(state)).length;
}

/** The document before a transaction that would change it: the bar's count after an edit. */
export function currentQuery(state: EditorState): { query: string; caseSensitive: boolean } | null {
  const search = searchState(state);
  return search ? { query: search.query, caseSensitive: search.caseSensitive } : null;
}

/** The plugin that holds the query and the active match, and paints the highlights. */
const searchPlugin = new Plugin<SearchState | null>({
  key: SEARCH,
  state: {
    init: () => null,
    apply(tr, prev) {
      const set = tr.getMeta(META) as SearchState | null | undefined;
      if (set !== undefined) return set;
      return prev;
    },
  },
  props: {
    decorations(state) {
      const search = SEARCH.getState(state);
      if (!search) return null;
      const matches = matchesOf(state.doc, search);
      if (matches.length === 0) return null;
      return DecorationSet.create(
        state.doc,
        matches.map((m, i) =>
          Decoration.inline(m.from, m.to, { class: i === search.active ? 'find-hit is-active' : 'find-hit' }),
        ),
      );
    },
  },
});


/** Find and replace inside the document. `setSearch({ query: '' })` clears it. */
export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [searchPlugin];
  },

  addCommands() {
    return {
      setSearch:
        ({ query, caseSensitive = false }) =>
        ({ tr, dispatch, state }) => {
          const search: SearchState = { query, caseSensitive, active: -1 };
          const matches = matchesOf(state.doc, search);
          if (matches.length > 0) {
            search.active = 0;
            tr.setSelection(TextSelection.create(state.doc, matches[0]!.from, matches[0]!.to));
            tr.scrollIntoView();
          }
          tr.setMeta(META, search);
          return true;
        },

      nextMatch:
        () =>
        ({ tr, dispatch, state }) => {
          const search = searchState(state);
          const matches = matchesOf(state.doc, search);
          if (!search || matches.length === 0) return false;
          const after = matches.findIndex((m) => m.from >= state.selection.to);
          const active = after === -1 ? 0 : after;
          tr.setSelection(TextSelection.create(state.doc, matches[active]!.from, matches[active]!.to));
          tr.scrollIntoView();
          tr.setMeta(META, { ...search, active });
          return true;
        },

      previousMatch:
        () =>
        ({ tr, dispatch, state }) => {
          const search = searchState(state);
          const matches = matchesOf(state.doc, search);
          if (!search || matches.length === 0) return false;
          const before = matches.findLastIndex((m) => m.to <= state.selection.from);
          const active = before === -1 ? matches.length - 1 : before;
          tr.setSelection(TextSelection.create(state.doc, matches[active]!.from, matches[active]!.to));
          tr.scrollIntoView();
          tr.setMeta(META, { ...search, active });
          return true;
        },

      replaceCurrent:
        (text) =>
        ({ tr, dispatch, state }) => {
          const search = searchState(state);
          const matches = matchesOf(state.doc, search);
          if (!search || matches.length === 0) return false;
          const current = matches[Math.max(0, search.active)] ?? matches[0]!;
          if (text === '') tr.delete(current.from, current.to);
          else tr.replaceWith(current.from, current.to, contentFor(state.doc.type.schema, text) as never);

          const left = matchesOf(tr.doc, search);
          const at = left.findIndex((m) => m.from >= current.from);
          const active = left.length === 0 ? -1 : at === -1 ? 0 : at;
          if (active !== -1) {
            tr.setSelection(TextSelection.create(tr.doc, left[active]!.from, left[active]!.to));
            tr.scrollIntoView();
          }
          tr.setMeta(META, { ...search, active });
          return true;
        },

      replaceAll:
        (text) =>
        ({ tr, dispatch, state }) => {
          const search = searchState(state);
          const matches = matchesOf(state.doc, search);
          if (!search || matches.length === 0) return false;
          for (let i = matches.length - 1; i >= 0; i -= 1) {
            const { from, to } = matches[i]!;
            if (text === '') tr.delete(from, to);
            else tr.replaceWith(from, to, contentFor(state.doc.type.schema, text) as never);
          }
          tr.setMeta(META, { ...search, active: -1 });
          return true;
        },

      // A command answers yes-or-no. The bar counts matches with `countMatches` instead.
      matchCount:
        () =>
        ({ state }) =>
          matchesOf(state.doc, searchState(state)).length > 0,
    };
  },
});
