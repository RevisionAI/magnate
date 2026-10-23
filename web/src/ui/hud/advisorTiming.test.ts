import { describe, expect, it } from 'vitest';
import { advisorReadMs } from './advisorTiming';

describe('advisor bubble pacing', () => {
  it('gives short lines at least 9 s and long lines at most 20 s', () => {
    expect(advisorReadMs('Objective complete.', 0)).toBe(9000);
    expect(advisorReadMs(Array.from({ length: 30 }, () => 'word').join(' '), 0)).toBe(13600);
    expect(advisorReadMs(Array.from({ length: 80 }, () => 'word').join(' '), 0)).toBe(20000);
  });

  it('moves faster while more lines are waiting', () => {
    expect(advisorReadMs(Array.from({ length: 30 }, () => 'word').join(' '), 2)).toBe(7000);
  });
});
