import { Extension } from '@tiptap/core';

/** The line spacings the toolbar offers, as multiples of the text size. */
export const LINE_SPACINGS = ['1', '1.15', '1.5', '2'] as const;
export type LineSpacingValue = (typeof LINE_SPACINGS)[number] | null;

const isSpacing = (value: unknown): value is string =>
  typeof value === 'string' && (LINE_SPACINGS as readonly string[]).includes(value);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lineSpacing: {
      /** Sets the paragraph's line height; `null` returns it to the page's own. */
      setLineSpacing: (value: string | null) => ReturnType;
    };
  }
}

/** `lineHeight` on paragraphs: one of 1, 1.15, 1.5 or 2, or none. */
export const LineSpacing = Extension.create({
  name: 'lineSpacing',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => (isSpacing(element.style.lineHeight) ? element.style.lineHeight : null),
            renderHTML: (attributes) => (isSpacing(attributes.lineHeight) ? { style: `line-height:${attributes.lineHeight}` } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineSpacing:
        (value) =>
        ({ tr, state, dispatch }) => {
          const next = value === null || isSpacing(value) ? value : null;
          const { from, to } = state.selection;
          const positions: number[] = [];
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === 'paragraph') positions.push(pos);
          });
          if (positions.length === 0) return false;
          if (dispatch) for (const pos of positions) tr.setNodeAttribute(pos, 'lineHeight', next);
          return true;
        },
    };
  },
});
