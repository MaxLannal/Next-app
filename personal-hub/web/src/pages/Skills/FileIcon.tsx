import type { ReactNode } from 'react';
import type { SkillFile } from '@shared/types.ts';

/** The cartoon a file is drawn as, from its extension first, then its type. */
export type FileLook =
  | 'word'
  | 'pdf'
  | 'python'
  | 'notebook'
  | 'sheet'
  | 'slides'
  | 'image'
  | 'latex'
  | 'markdown'
  | 'code'
  | 'text'
  | 'archive'
  | 'other';

const BY_EXT: Record<string, FileLook> = {
  doc: 'word', docx: 'word', rtf: 'word', pages: 'word', odt: 'word',
  pdf: 'pdf',
  py: 'python', pyw: 'python', pyi: 'python',
  ipynb: 'notebook',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', tsv: 'sheet', numbers: 'sheet', ods: 'sheet',
  ppt: 'slides', pptx: 'slides', key: 'slides', odp: 'slides',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', heic: 'image', svg: 'image', bmp: 'image', tiff: 'image',
  tex: 'latex', bib: 'latex', cls: 'latex', sty: 'latex',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  txt: 'text', log: 'text',
  zip: 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', rar: 'archive', '7z': 'archive',
};

export const extOf = (filename: string) => {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
};

export function fileLook(file: Pick<SkillFile, 'filename' | 'kind' | 'mime'>): FileLook {
  const byExt = BY_EXT[extOf(file.filename)];
  if (byExt) return byExt;
  if (file.mime.includes('wordprocessingml') || file.mime === 'application/msword') return 'word';
  if (file.mime.includes('spreadsheetml')) return 'sheet';
  if (file.mime.includes('presentationml')) return 'slides';
  if (file.kind === 'pdf') return 'pdf';
  if (file.kind === 'image') return 'image';
  if (file.kind === 'latex') return 'latex';
  if (file.kind === 'code') return 'code';
  if (file.kind === 'text') return 'text';
  return 'other';
}

// Every icon is a sheet of paper with its top-right corner folded, in a 30 × 38 box.
const SHEET = 'M3 1.5h17l7 7v27a1.5 1.5 0 0 1-1.5 1.5h-21A1.5 1.5 0 0 1 3 35.5v-32A1.5 1.5 0 0 1 4.5 1.5Z';
const FOLD = 'M20 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5H27';
const lines = (from: number, n: number, x1 = 8, x2 = 22) =>
  Array.from({ length: n }, (_, i) => <path key={i} d={`M${x1} ${from + i * 4}H${i === n - 1 ? x2 - 5 : x2}`} />);

function Paper({ fill = '#f6f7fb', edge = '#c9cfdc', children }: { fill?: string; edge?: string; children?: ReactNode }) {
  return (
    <>
      <path d={SHEET} fill={fill} stroke={edge} strokeWidth="1" />
      <path d={FOLD} fill="none" stroke={edge} strokeWidth="1" />
      {children}
    </>
  );
}

/** A small banded label across a sheet ("W", "X", "P"), as office documents wear them. */
const Band = ({ color, letter }: { color: string; letter: string }) => (
  <>
    <rect x="1" y="17" width="17" height="13" rx="2.5" fill={color} />
    <text x="9.5" y="27.2" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">
      {letter}
    </text>
  </>
);

function Drawing({ look, ext }: { look: FileLook; ext: string }) {
  switch (look) {
    case 'word':
      return (
        <Paper>
          <g stroke="#b8c3da" strokeWidth="1.4" strokeLinecap="round">{lines(12, 6, 8, 23)}</g>
          <Band color="#2f6fde" letter="W" />
        </Paper>
      );
    case 'sheet':
      return (
        <Paper>
          <path d="M7 12h17v18H7zM7 18h17M7 24h17M13 12v18M19 12v18" fill="none" stroke="#9fd1b0" strokeWidth="1" />
          <Band color="#1f9d55" letter="X" />
        </Paper>
      );
    case 'slides':
      return (
        <Paper>
          <rect x="8" y="11" width="15" height="10" rx="1.5" fill="none" stroke="#f2b08a" strokeWidth="1.3" />
          <Band color="#e0632b" letter="P" />
        </Paper>
      );
    case 'pdf':
      // Red, with its corner turned down in a twist rather than a neat fold.
      return (
        <>
          <path d="M3 1.5h15.5L27 10v25.5a1.5 1.5 0 0 1-1.5 1.5h-21A1.5 1.5 0 0 1 3 35.5v-32A1.5 1.5 0 0 1 4.5 1.5Z" fill="#e5484d" />
          <path d="M18.5 1.5c.4 3.6-.8 6.6-1.3 8.9 2.9-.8 6.6-.8 9.8-.4Z" fill="#ffb3b0" />
          <path d="M18.5 1.5c.4 3.6-.8 6.6-1.3 8.9" fill="none" stroke="#b42d33" strokeWidth="0.8" />
          <path d="M8 15h12M8 19h9" stroke="#ffd2d0" strokeWidth="1.3" strokeLinecap="round" opacity="0.9" />
          <text x="15" y="30" textAnchor="middle" fontSize="8.4" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif" letterSpacing="0.3">
            PDF
          </text>
        </>
      );
    case 'python':
      return (
        <Paper>
          {/* Two snakes, blue over yellow, coiled into a knot. */}
          <g transform="translate(6.5 12) scale(0.98)">
            <path d="M8.6 0C4.3 0 4.6 1.9 4.6 1.9v2h4.1v.6H2.9S0 4.2 0 8.5s2.5 4.1 2.5 4.1H4v-2s-.1-2.5 2.5-2.5h4.2s2.4 0 2.4-2.4V2.4S13.5 0 8.6 0Zm-2.3 1.3a.8.8 0 1 1 0 1.5.8.8 0 0 1 0-1.5Z" fill="#3b78c4" />
            <path d="M8.8 17.4c4.3 0 4-1.9 4-1.9v-2H8.7v-.6h5.8s2.9.3 2.9-4-2.5-4.1-2.5-4.1h-1.5v2s.1 2.5-2.5 2.5H6.7s-2.4 0-2.4 2.4v3.3s-.4 2.4 4.5 2.4Zm2.3-1.3a.8.8 0 1 1 0-1.5.8.8 0 0 1 0 1.5Z" fill="#f5c630" />
          </g>
        </Paper>
      );
    case 'notebook':
      return (
        <Paper>
          <g fill="none" stroke="#f37726" strokeWidth="2.2" strokeLinecap="round">
            <path d="M8.5 17.5c3.8-3.6 10.2-3.6 14 0" />
            <path d="M8.5 25.5c3.8 3.6 10.2 3.6 14 0" />
          </g>
          <circle cx="23" cy="12.5" r="1.3" fill="#767677" />
          <circle cx="8.5" cy="31" r="1" fill="#989798" />
        </Paper>
      );
    case 'image':
      return (
        <Paper fill="#eaf3ff" edge="#b9cbe6">
          <circle cx="11" cy="15" r="2.6" fill="#ffb648" />
          <path d="M3.5 31l8.5-8 4.5 4.5L20 23l7 8v4.5a1.5 1.5 0 0 1-1.5 1.5h-21A1.5 1.5 0 0 1 3.5 35.5Z" fill="#4bae7f" />
        </Paper>
      );
    case 'latex':
      return (
        <Paper fill="#fbf8ef" edge="#d6cfb8">
          <text x="15" y="25" textAnchor="middle" fontSize="9.5" fill="#3d7a63" fontFamily="'Source Serif 4 Variable', Georgia, serif" fontStyle="italic">
            TeX
          </text>
        </Paper>
      );
    case 'markdown':
      return (
        <Paper>
          <rect x="6" y="15" width="19" height="11" rx="2" fill="none" stroke="#5b6478" strokeWidth="1.3" />
          <path d="M9 23.5v-6l2.4 3 2.4-3v6M19.5 17.5v5.5M17.5 21l2 2.2 2-2.2" fill="none" stroke="#5b6478" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
        </Paper>
      );
    case 'code':
      return (
        <Paper fill="#eef0f7">
          <path d="M11.5 15 7.5 19.5l4 4.5M18.5 15l4 4.5-4 4.5" fill="none" stroke="#7a6ff0" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <text x="15" y="32" textAnchor="middle" fontSize="5.6" fontWeight="700" fill="#7a6ff0" fontFamily="system-ui, sans-serif">
            {ext.slice(0, 4).toUpperCase()}
          </text>
        </Paper>
      );
    case 'text':
      return (
        <Paper>
          <g stroke="#b8c0d0" strokeWidth="1.3" strokeLinecap="round">{lines(13, 5)}</g>
        </Paper>
      );
    case 'archive':
      return (
        <Paper fill="#f3efe6" edge="#d2c7b0">
          <g fill="#9a8a68">
            {[5, 9, 13, 17, 21].map((y, i) => (
              <rect key={y} x={i % 2 ? 15 : 13} y={y} width="2" height="2.6" rx="0.6" />
            ))}
            <rect x="12.5" y="24" width="5" height="6" rx="1.2" />
          </g>
        </Paper>
      );
    default:
      return (
        <Paper fill="#e9ebf1" edge="#bcc2cf">
          {ext && (
            <text x="15" y="26" textAnchor="middle" fontSize="6.2" fontWeight="700" fill="#6b7386" fontFamily="system-ui, sans-serif">
              {ext.slice(0, 4).toUpperCase()}
            </text>
          )}
        </Paper>
      );
  }
}

/** A file drawn as a small cartoon of its kind with its name beneath; opens the file in a new tab. */
export function FileIcon({ file }: { file: SkillFile }) {
  const look = fileLook(file);
  return (
    <a className="file" href={file.url} target="_blank" rel="noreferrer" title={file.filename} data-look={look}>
      <svg className="file__art" viewBox="0 0 30 38" width="30" height="38" aria-hidden="true">
        <Drawing look={look} ext={extOf(file.filename)} />
      </svg>
      <span className="file__name">{file.filename}</span>
    </a>
  );
}
