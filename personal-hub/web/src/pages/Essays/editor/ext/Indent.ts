import { Extension } from '@tiptap/core';

/** The deepest indent: eight steps, two `em` each. */
export const MAX_INDENT = 8;
/** One step, as the toolbar's Outdent and Indent move the block. */
export const INDENT_STEP = 1;

export type IndentOptions = {
  types: string[];
  maxIndent: number;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      /** Moves the block in one step, up to the maximum. */
      indent: () => ReturnType;
      /** Moves the block out one step, down to none. */
      outdent: () => ReturnType;
      /** Sets the step outright: 0 recovers the margin, 8 is the deepest. */
      setIndent: (level: number) => ReturnType;
    };
  }
}

const clamp = (level: number) => Math.min(MAX_INDENT, Math.max(0, Math.round(level)));

const inList = (pos: number, doc: import('@tiptap/pm/model').Node) => {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList' || name === 'listItem') return true;
  }
  return false;
};

/**
 * `indent` on paragraphs and headings: 0 to 8 steps of 2em, as `--indent` on the
 * block. Tab indents and Shift-Tab outdents, except inside lists, where Tab
 * nests (the list's own keymap) and the toolbar stays the way to indent.
 */
export const Indent = Extension.create<IndentOptions>({
  name: 'indent',

  addOptions() {
    return { types: ['paragraph', 'heading'], maxIndent: MAX_INDENT };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => clamp(Number(element.getAttribute('data-indent') ?? 0) || 0),
            renderHTML: (attributes) => {
              const level = clamp(Number(attributes.indent) || 0);
              if (level === 0) return {};
              return { 'data-indent': String(level), style: `margin-left:${level * 2}em` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const setTo = (level: number | ((current: number) => number)) =>
      ({ tr, state, dispatch }: import('@tiptap/core').CommandProps) => {
        const { from, to } = state.selection;
        const targets: { pos: number; level: number }[] = [];
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!this.options.types.includes(node.type.name)) return;
          const current = Number(node.attrs.indent) || 0;
          const next = clamp(typeof level === 'number' ? level : level(current));
          if (next !== current) targets.push({ pos, level: next });
        });
        if (targets.length === 0) return false;
        if (dispatch) {
          for (const { pos, level: next } of targets) {
            tr.setNodeAttribute(pos, 'indent', next);
          }
        }
        return true;
      };

    return {
      indent: () => (props) => {
        if (inList(props.state.selection.from, props.state.doc)) return false;
        return setTo((current) => current + INDENT_STEP)(props);
      },
      outdent: () => (props) => {
        if (inList(props.state.selection.from, props.state.doc)) return false;
        return setTo((current) => current - INDENT_STEP)(props);
      },
      setIndent: (level: number) => setTo(level),
    };
  },

  addKeyboardShortcuts() {
    const inTable = () => {
      const { state } = this.editor;
      const $from = state.doc.resolve(state.selection.from);
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const name = $from.node(depth).type.name;
        if (name === 'table' || name === 'tableRow' || name === 'tableCell' || name === 'tableHeader') return true;
      }
      return false;
    };
    return {
      Tab: () => {
        if (inList(this.editor.state.selection.from, this.editor.state.doc)) return false;
        if (inTable()) return false;
        return this.editor.commands.indent();
      },
      'Shift-Tab': () => {
        if (inList(this.editor.state.selection.from, this.editor.state.doc)) return false;
        if (inTable()) return false;
        return this.editor.commands.outdent();
      },
    };
  },
});
