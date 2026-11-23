import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LINE_SPACINGS } from './ext/LineSpacing.ts';

export type ExportKind = 'docx' | 'pdf' | 'print';

type ToolbarProps = {
  editor: Editor;
  onExport: (kind: ExportKind) => void;
  onFindReplace: (mode: 'find' | 'replace') => void;
  onImage: () => void;
  onLink: () => void;
  /** Opens the History sheet. */
  onHistory: () => void;
  exporting: ExportKind | null;
};

const FONTS = [
  { label: 'Wix Madefor Text', value: 'Wix Madefor Text' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Helvetica', value: 'Helvetica' },
  { label: 'Menlo', value: 'Menlo' },
];

const SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36];

const STYLES = [
  { label: 'Normal', value: 'paragraph' },
  { label: 'Title', value: 'title' },
  { label: 'Heading 1', value: 'h1' },
  { label: 'Heading 2', value: 'h2' },
  { label: 'Heading 3', value: 'h3' },
  { label: 'Quote', value: 'blockquote' },
  { label: 'Code block', value: 'codeBlock' },
];

const ALIGNS = [
  { value: 'left', label: 'Align left' },
  { value: 'center', label: 'Align centre' },
  { value: 'right', label: 'Align right' },
  { value: 'justify', label: 'Justify' },
] as const;

const HIGHLIGHT = '#F3E2B8';
const TEXT_COLOR = '#20406A';

/** One icon button: its label for screen readers, and the same words as a tooltip. */
function IconButton({
  label,
  keys,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  keys?: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={pressed === true ? 'tb-btn is-on' : 'tb-btn'}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      title={keys === undefined ? label : `${label} (${keys})`}
      disabled={disabled}
      // A press must not take focus from the document, or the selection is lost.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A small menu that opens under its button and closes on Escape or a click elsewhere. */
function Menu({
  label,
  title,
  className,
  children,
}: {
  label: string;
  title: string;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className={className === undefined ? 'tb-menu' : `tb-menu ${className}`} ref={wrap}>
      <button
        type="button"
        className={open ? 'tb-btn tb-btn-wide is-on' : 'tb-btn tb-btn-wide'}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <svg viewBox="0 0 10 6" aria-hidden="true" className="tb-caret">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="tb-menu__list" role="menu" aria-label={title}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onPick, children }: { onPick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="tb-menu__item"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
    >
      {children}
    </button>
  );
}

/**
 * The editor's sticky toolbar: ruled groups of icon buttons, each with an
 * `aria-label` and a tooltip. The style select carries the current block.
 */
export function Toolbar({ editor, onExport, onFindReplace, onImage, onLink, onHistory, exporting }: ToolbarProps) {
  // TipTap re-renders its consumers on every transaction; this makes the toolbar follow.
  const [, setTick] = useState(0);
  useEffect(() => {
    const redraw = () => setTick((n) => n + 1);
    editor.on('transaction', redraw);
    editor.on('selectionUpdate', redraw);
    return () => {
      editor.off('transaction', redraw);
      editor.off('selectionUpdate', redraw);
    };
  }, [editor]);

  const style = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : editor.isActive('blockquote')
          ? 'blockquote'
          : editor.isActive('codeBlock')
            ? 'codeBlock'
            : 'paragraph';

  const setStyle = (value: string) => {
    const chain = editor.chain().focus().unsetFontSize().unsetFontFamily();
    if (value === 'paragraph') chain.setParagraph().run();
    else if (value === 'blockquote') chain.toggleBlockquote().run();
    else if (value === 'codeBlock') chain.toggleCodeBlock().run();
    else if (value === 'title') chain.setParagraph().setFontSize('32pt').setFontFamily('Wix Madefor Display').run();
    else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 }).run();
  };

  const fontFamily = (editor.getAttributes('textStyle').fontFamily as string | undefined) ?? '';
  const fontSize = String(editor.getAttributes('textStyle').fontSize ?? '').replace('pt', '');

  return (
    <div className="tb" role="toolbar" aria-label="Formatting">
      <div className="tb__inner">
        <fieldset className="tb-group" aria-label="History">
          <IconButton label="Undo" keys="⌘Z" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5L3.5 9l4.5 4M4 9h7.5a4.5 4.5 0 010 9H9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </IconButton>
          <IconButton label="Redo" keys="⇧⌘Z" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 5l4.5 4L12 13M16 9H8.5a4.5 4.5 0 000 9H11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </IconButton>
        </fieldset>

        <fieldset className="tb-group tb-group--style" aria-label="Paragraph style">
          <select
            className="tb-select"
            aria-label="Paragraph style"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
          >
            {STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className="tb-group" aria-label="Font">
          <select
            className="tb-select tb-select--font"
            aria-label="Font family"
            value={FONTS.some((f) => f.value === fontFamily) ? fontFamily : ''}
            onChange={(e) => {
              if (e.target.value === '') editor.chain().focus().unsetFontFamily().run();
              else editor.chain().focus().setFontFamily(e.target.value).run();
            }}
          >
            <option value="">Font</option>
            {FONTS.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            className="tb-select tb-select--size"
            aria-label="Font size"
            value={SIZES.includes(Number(fontSize)) ? fontSize : ''}
            onChange={(e) => {
              if (e.target.value === '') editor.chain().focus().unsetFontSize().run();
              else editor.chain().focus().setFontSize(`${e.target.value}pt`).run();
            }}
          >
            <option value="">Size</option>
            {SIZES.map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className="tb-group" aria-label="Marks">
          <IconButton label="Bold" keys="⌘B" pressed={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
            <span className="tb-glyph tb-glyph--b">B</span>
          </IconButton>
          <IconButton label="Italic" keys="⌘I" pressed={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <span className="tb-glyph tb-glyph--i">I</span>
          </IconButton>
          <IconButton label="Underline" keys="⌘U" pressed={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <span className="tb-glyph tb-glyph--u">U</span>
          </IconButton>
          <IconButton label="Strikethrough" keys="⇧⌘S" pressed={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <span className="tb-glyph tb-glyph--s">S</span>
          </IconButton>
          <IconButton label="Subscript" pressed={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}>
            <span className="tb-glyph">x<sub>2</sub></span>
          </IconButton>
          <IconButton label="Superscript" pressed={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
            <span className="tb-glyph">x<sup>2</sup></span>
          </IconButton>
        </fieldset>

        <fieldset className="tb-group" aria-label="Colour">
          <IconButton label="Text colour" onClick={() => editor.chain().focus().setColor(TEXT_COLOR).run()}>
            <span className="tb-glyph tb-glyph--color" style={{ color: TEXT_COLOR }}>A</span>
          </IconButton>
          <IconButton label="Highlight" pressed={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight({ color: HIGHLIGHT }).run()}>
            <span className="tb-glyph tb-glyph--mark">A</span>
          </IconButton>
          <IconButton
            label="Clear formatting"
            onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15l7-11h3l-2.2 4M7 9h6M13 12l4 4M17 12l-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </IconButton>
        </fieldset>

        <fieldset className="tb-group" aria-label="Alignment">
          {ALIGNS.map(({ value, label }) => (
            <IconButton
              key={value}
              label={label}
              pressed={editor.isActive({ textAlign: value })}
              onClick={() => editor.chain().focus().setTextAlign(value).run()}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d={
                    value === 'left'
                      ? 'M3 5h14M3 9h9M3 13h14M3 17h9'
                      : value === 'right'
                        ? 'M3 5h14M8 9h9M3 13h14M8 17h9'
                        : value === 'center'
                          ? 'M3 5h14M5.5 9h9M3 13h14M5.5 17h9'
                          : 'M3 5h14M3 9h14M3 13h14M3 17h14'
                  }
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </IconButton>
          ))}
          <Menu label="¶↕" title="Line spacing">
            {(close) => (
              <>
                {LINE_SPACINGS.map((v) => (
                  <MenuItem
                    key={v}
                    onPick={() => {
                      editor.chain().focus().setLineSpacing(v).run();
                      close();
                    }}
                  >
                    {v}
                  </MenuItem>
                ))}
                <MenuItem
                  onPick={() => {
                    editor.chain().focus().setLineSpacing(null).run();
                    close();
                  }}
                >
                  Page default
                </MenuItem>
              </>
            )}
          </Menu>
        </fieldset>

        <fieldset className="tb-group" aria-label="Lists">
          <IconButton label="Bulleted list" pressed={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="6" r="1.4" fill="currentColor" /><circle cx="4" cy="14" r="1.4" fill="currentColor" /><path d="M8 6h9M8 14h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </IconButton>
          <IconButton label="Numbered list" pressed={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><text x="2" y="8" fontSize="7" fill="currentColor">1</text><text x="2" y="17" fontSize="7" fill="currentColor">2</text><path d="M8 6h9M8 14h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </IconButton>
          <IconButton label="Checklist" pressed={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M3.5 5l1.2 1.2 2.3-2.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><rect x="2.5" y="12.5" width="5" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M10 5h7.5M10 15h7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </IconButton>
          <IconButton label="Outdent" keys="⇧Tab" onClick={() => editor.chain().focus().outdent().run()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5h7M10 10h7M10 15h7M3 10h5M5.5 7.5L3 10l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </IconButton>
          <IconButton label="Indent" keys="Tab" onClick={() => editor.chain().focus().indent().run()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5h7M10 10h7M10 15h7M3 7.5L5.5 10 3 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </IconButton>
        </fieldset>

        <fieldset className="tb-group" aria-label="Insert">
          <IconButton label="Link" keys={`${navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl+K'}`} pressed={editor.isActive('link')} onClick={onLink}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 11.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1M11.5 8.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </IconButton>
          <IconButton label="Image" onClick={onImage}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="7" cy="8" r="1.6" fill="currentColor" /><path d="M3.5 15l4.5-4.5 3 3 2-2 3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </IconButton>
          <Menu label="Table" title="Table">
            {(close) => (
              <>
                <MenuItem onPick={() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); close(); }}>
                  Insert 3×3
                </MenuItem>
                <MenuItem onPick={() => { editor.chain().focus().addRowAfter().run(); close(); }}>Add row below</MenuItem>
                <MenuItem onPick={() => { editor.chain().focus().addColumnAfter().run(); close(); }}>Add column right</MenuItem>
                <MenuItem onPick={() => { editor.chain().focus().deleteRow().run(); close(); }}>Delete row</MenuItem>
                <MenuItem onPick={() => { editor.chain().focus().deleteColumn().run(); close(); }}>Delete column</MenuItem>
                <MenuItem onPick={() => { editor.chain().focus().mergeCells().run(); close(); }}>Merge cells</MenuItem>
                <MenuItem onPick={() => { editor.chain().focus().splitCell().run(); close(); }}>Split cell</MenuItem>
                <MenuItem onPick={() => { editor.chain().focus().toggleHeaderRow().run(); close(); }}>Header row</MenuItem>
                <MenuItem onPick={() => { editor.chain().focus().deleteTable().run(); close(); }}>Delete table</MenuItem>
              </>
            )}
          </Menu>
          <IconButton label="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </IconButton>
          <Menu label="∑" title="Math">
            {(close) => (
              <>
                <MenuItem
                  onPick={() => {
                    const latex = window.prompt('Inline math (LaTeX)', 'e^{i\\pi}+1=0');
                    if (latex !== null && latex.trim() !== '') editor.chain().focus().insertInlineMath({ latex: latex.trim() }).run();
                    close();
                  }}
                >
                  Inline math
                </MenuItem>
                <MenuItem
                  onPick={() => {
                    const latex = window.prompt('Block math (LaTeX)', '\\sum_{i=1}^{n} x_i');
                    if (latex !== null && latex.trim() !== '') editor.chain().focus().insertBlockMath({ latex: latex.trim() }).run();
                    close();
                  }}
                >
                  Block math
                </MenuItem>
              </>
            )}
          </Menu>
        </fieldset>

        <fieldset className="tb-group tb-group--end" aria-label="Document">
          <IconButton label="Find and replace" keys="⌘F" onClick={() => onFindReplace('find')}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M12.5 12.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </IconButton>
          <IconButton label="Export .docx" onClick={() => onExport('docx')} disabled={exporting !== null}>
            <span className="tb-glyph tb-glyph--doc">↓</span>
          </IconButton>
          <IconButton label="Export PDF" onClick={() => onExport('pdf')} disabled={exporting !== null}>
            <span className="tb-glyph tb-glyph--pdf">PDF</span>
          </IconButton>
          <IconButton label="Print" onClick={() => onExport('print')} disabled={exporting !== null}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 8V3.5h8V8M6 15H4.5A1.5 1.5 0 013 13.5v-4A1.5 1.5 0 014.5 8h11A1.5 1.5 0 0117 9.5v4a1.5 1.5 0 01-1.5 1.5H14M6 12h8v4.5H6z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </IconButton>
          <IconButton label="History" onClick={onHistory}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10 6v4.2l2.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </IconButton>
        </fieldset>
      </div>
    </div>
  );
}
