import { describe, expect, it } from 'vitest';
import { appIconSvg, sweepGrey } from './app-icon.ts';

describe('appIconSvg', () => {
  const svg = appIconSvg();

  it('is a 1024 px icon with the tile, the plate, the lens and the ribbon', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('<clipPath id="plate">');
    expect(svg).toMatch(/<ellipse cx="512" cy="512" [^>]*transform="rotate\(45 512 512\)"/);
    expect(svg).toContain('stroke="url(#ribbon)"');
    // The plate's sweep: one wedge a degree.
    expect(svg.match(/<path d="M512 512L/g)).toHaveLength(360);
  });

  it('draws the ribbon point-symmetric about the centre', () => {
    const d = /<path d="(M [^"]+)" fill="none" stroke="url\(#ribbon\)"/.exec(svg)?.[1] ?? '';
    const numbers = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const [startX, startY] = numbers;
    const [endX, endY] = numbers.slice(-2);
    expect(startX! + endX!).toBeCloseTo(1024, 1);
    expect(startY! + endY!).toBeCloseTo(1024, 1);
  });
});

describe('sweepGrey', () => {
  it('repeats every half turn', () => {
    for (let deg = 0; deg < 180; deg += 7) expect(sweepGrey(deg + 180)).toBeCloseTo(sweepGrey(deg), 6);
  });

  it('jumps from white to dark once a half turn, then brightens all the way round', () => {
    expect(sweepGrey(22.9)).toBeGreaterThan(240);
    expect(sweepGrey(23)).toBeLessThan(60);
    for (let deg = 23; deg < 202; deg++) expect(sweepGrey(deg + 1)).toBeGreaterThanOrEqual(sweepGrey(deg));
  });
});
