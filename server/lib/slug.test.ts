import { describe, expect, it } from 'vitest';
import { slug, sessionFolder } from './slug.ts';

describe('sessionFolder', () => {
  it('dates and slugs the name', () => {
    expect(sessionFolder('2026-11-22', 'Ch. 4 exercises')).toBe('sessions/2026-11-22_ch-4-exercises');
  });

  it('falls back to session when nothing ASCII is left', () => {
    expect(sessionFolder('2026-11-22', '微积分')).toBe('sessions/2026-11-22_session');
  });
});

describe('slug', () => {
  it('lowercases and turns runs of non-alphanumerics into one dash', () => {
    expect(slug('  Ch. 4  exercises!! ')).toBe('ch-4-exercises');
  });

  it('strips diacritics', () => {
    expect(slug('Résumé — 2nd draft')).toBe('resume-2nd-draft');
    expect(slug('résumé')).toBe('resume');
  });

  it('keeps digits and plain dashes', () => {
    expect(slug('HW-1_final_v2')).toBe('hw-1-final-v2');
  });

  it('caps at 48 characters without a trailing dash', () => {
    const long = slug(`${'ab '.repeat(40)}end`);
    expect(long).toHaveLength(47); // a dash would land at 48, so the cut stops before it
    expect(long.endsWith('-')).toBe(false);
    expect(slug('a'.repeat(60))).toBe('a'.repeat(48));
    expect(slug(`${'a'.repeat(47)} b`)).toBe('a'.repeat(47));
  });

  it('falls back to session', () => {
    for (const name of ['', '   ', '微积分', '!!! ---']) expect(slug(name)).toBe('session');
  });
});
