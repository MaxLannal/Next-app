import { Extension, type Extensions } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Mathematics } from '@tiptap/extension-mathematics';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Typography from '@tiptap/extension-typography';
import StarterKit from '@tiptap/starter-kit';
import { Indent } from './ext/Indent.ts';
import { LineSpacing } from './ext/LineSpacing.ts';
import { FindReplace } from './ext/FindReplace.ts';

/**
 * Pasted and dropped image files are uploaded to the hub and placed as their
 * URL; a pasted image URL is inserted as it is.
 */
const ImageUpload = Extension.create({
  name: 'imageUpload',

  addProseMirrorPlugins() {
    const editor = this.editor;
    const files = (list: FileList | null) =>
      [...(list ?? [])].filter((f) => /^image\/(png|jpe?g|gif|webp)$/i.test(f.type));
    const place = (view: EditorView, filesToUpload: File[]) => {
      for (const file of filesToUpload) {
        void uploadImage(file)
          .then((src) => editor.chain().insertContentAt(view.state.selection.from, { type: 'image', attrs: { src, alt: file.name } }).run())
          .catch(() => {
            // The upload failed; the page's own Upload button says so in the status line.
            window.dispatchEvent(new CustomEvent('hub:image-upload-failed'));
          });
      }
    };
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const pasted = files(event.clipboardData?.files ?? null);
            if (pasted.length === 0) return false;
            event.preventDefault();
            place(view, pasted);
            return true;
          },
          handleDrop(view, event) {
            const dropped = files((event as DragEvent).dataTransfer?.files ?? null);
            if (dropped.length === 0) return false;
            event.preventDefault();
            place(view, dropped);
            return true;
          },
        },
      }),
    ];
  },
});

/** Posts one image file to the hub and resolves with its URL. */
export async function uploadImage(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/essay-images', { method: 'POST', body });
  const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok || !json?.url) throw new Error(json?.error ?? 'Couldn’t upload that image — retry');
  return json.url;
}

/**
 * Every extension the editor uses: TipTap 3 open-source parts only.
 * StarterKit brings Link and Underline; the rest add Word-like formatting.
 */
export function extensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true },
      codeBlock: false,
    }),
    TextStyleKit.configure({ lineHeight: false }),
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ inline: false, allowBase64: true }),
    // Pasted and dropped files go to the hub; URLs stay as they are.
    ImageUpload,
    Placeholder.configure({ placeholder: 'Start writing…' }),
    CharacterCount,
    Mathematics.configure({ katexOptions: { throwOnError: false } }),
    Typography,
    Indent,
    LineSpacing,
    FindReplace,
  ];
}
