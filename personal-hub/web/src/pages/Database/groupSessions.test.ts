import { describe, expect, it } from 'vitest';
import type { FocusSession } from '@shared/types.ts';
import { groupSessions } from './groupSessions.ts';

const local = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h).toISOString();

function session(over: Partial<FocusSession> & { id: number; startedAt: string }): FocusSession {
  return {
    name: `Session ${over.id}`,
    subject: null,
    tags: [],
    goalId: null,
    notes: '',
    status: 'done',
    endedAt: null,
    focusSeconds: 600,
    autoPausedAt: null,
    attachmentCount: 0,
    events: [],
    ...over,
  };
}

describe('groupSessions', () => {
  it('groups by day newest first', () => {
    const a = session({ id: 1, startedAt: local(2026, 11, 21) });
    const b = session({ id: 2, startedAt: local(2026, 11, 20) });
    const c = session({ id: 3, startedAt: local(2026, 11, 21, 15) });

    const groups = groupSessions([b, a, c], 'day');

    expect(groups.map((g) => g.key)).toEqual(['2026-11-21', '2026-11-20']);
    expect(groups.map((g) => g.label)).toEqual(['Sat 21 Nov', 'Fri 20 Nov']);
    expect(groups.map((g) => g.sessions.map((s) => s.id))).toEqual([
      [3, 1],
      [2],
    ]);
    expect(groups[0].seconds).toBe(1200);
  });

  it('a two-tag session appears twice', () => {
    const s = session({ id: 1, startedAt: local(2026, 11, 21), tags: ['proof', 'lamport'] });

    const groups = groupSessions([s], 'tag');

    expect(groups.map((g) => g.label).sort()).toEqual(['lamport', 'proof']);
    for (const g of groups) expect(g.sessions.map((x) => x.id)).toEqual([1]);
  });

  it('sorts subject groups by seconds, leaves real subjects first, and files untagged under "No tag"', () => {
    const algebra = session({
      id: 1,
      startedAt: local(2026, 11, 21),
      subject: { id: 1, name: 'Algebra' },
      focusSeconds: 900,
    });
    const stat = session({
      id: 2,
      startedAt: local(2026, 11, 20),
      subject: { id: 2, name: 'STAT 251' },
      focusSeconds: 7200,
    });
    const loose = session({ id: 3, startedAt: local(2026, 11, 19), focusSeconds: 30 });
    const untagged = session({ id: 4, startedAt: local(2026, 11, 22, 14), focusSeconds: 60 });

    const bySubject = groupSessions([algebra, loose, stat], 'subject');
    expect(bySubject.map((g) => g.label)).toEqual(['STAT 251', 'Algebra', 'No subject']);

    const byTag = groupSessions([untagged, algebra], 'tag');
    expect(byTag.map((g) => g.label)).toEqual(['No tag']);
    // Algebra has no tags either; two sessions in the "No tag" group add up, newest (22 Nov) first.
    expect(byTag[0].seconds).toBe(960);
    expect(byTag[0].sessions.map((s) => s.id)).toEqual([4, 1]);
  });

  it('orders sessions inside a group newest first and keeps every session in day and subject groups once', () => {
    const early = session({ id: 1, startedAt: local(2026, 11, 21, 9) });
    const late = session({ id: 2, startedAt: local(2026, 11, 21, 18) });

    expect(groupSessions([early, late], 'day')[0].sessions.map((s) => s.id)).toEqual([2, 1]);
    expect(groupSessions([early, late], 'subject')[0].sessions.map((s) => s.id)).toEqual([2, 1]);
    expect(groupSessions([], 'day')).toEqual([]);
  });
});
