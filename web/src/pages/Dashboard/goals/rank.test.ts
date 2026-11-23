import { describe, expect, it } from 'vitest';
import { dropIndex, moveItem, shiftFor, slotOffset } from './rank.ts';

describe('ranking goals by drag', () => {
  it('moves an item to its new place', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  it('lands a dragged row past the middles it has crossed', () => {
    // Rows 70 tall: middles at 35, 105, 175.
    const mids = [35, 105, 175];
    expect(dropIndex(mids, 0, 35 + 60)).toBe(0); // not yet past the second row's middle
    expect(dropIndex(mids, 0, 35 + 80)).toBe(1);
    expect(dropIndex(mids, 0, 35 + 150)).toBe(2);
    expect(dropIndex(mids, 2, 175 - 150)).toBe(0);
  });

  it('slides the rows in between by the dragged row’s height', () => {
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, 70))).toEqual([0, -70, -70, 0]);
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, 70))).toEqual([0, 70, 70, 0]);
  });

  it('settles the dragged row by the heights it passed', () => {
    expect(slotOffset([70, 60, 80], 0, 2)).toBe(140);
    expect(slotOffset([70, 60, 80], 2, 0)).toBe(-130);
    expect(slotOffset([70, 60, 80], 1, 1)).toBe(0);
  });
});
