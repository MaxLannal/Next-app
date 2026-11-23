import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SkillPyramid } from './SkillPyramid.tsx';

describe('SkillPyramid', () => {
  it('fills the stages with work, lights the one being worked in, and leaves the top one open', () => {
    const { container } = render(<SkillPyramid layerSteps={[2, 1]} stages={3} label="Python" />);
    const state = (stage: number) => container.querySelector(`[data-stage="${stage}"]`)?.getAttribute('class');
    expect(state(1)).toContain('is-done');
    expect(state(2)).toContain('is-current');
    expect(state(3)).toContain('is-open');
    expect(container.querySelectorAll('.pyramid__dot')).toHaveLength(3);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('Python');
  });

  it('draws one open stage for a new skill', () => {
    const { container } = render(<SkillPyramid layerSteps={[]} stages={1} label="New" />);
    expect(container.querySelectorAll('.pyramid__band')).toHaveLength(1);
    expect(container.querySelector('.pyramid__band')?.getAttribute('class')).toContain('is-open');
  });
});
