/** Shiki language ids by file extension. Anything else is shown as plain text (`text`). */
const BY_EXTENSION: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  jsx: 'jsx',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  java: 'java',
  r: 'r',
  m: 'matlab',
  jl: 'julia',
  go: 'go',
  rs: 'rust',
  sh: 'shell',
  sql: 'sql',
  md: 'markdown',
  tex: 'latex',
};

/**
 * Plain text as it should read: `api()` parses any reply whose content type
 * *contains* `json` (so `application/x-ipynb+json` too) and hands back an object.
 * Stored files are written as they were typed, so their text is that object, stringified.
 */
export function asText(body: unknown): string {
  return typeof body === 'string' ? body : JSON.stringify(body);
}

export function languageOf(filename: string): string {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase() : '';
  return BY_EXTENSION[ext] ?? 'text';
}
