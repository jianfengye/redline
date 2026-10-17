import { describe, expect, it } from 'vitest';
import { nextDisplayMode, normalizeDisplayMode } from './displayMode';

describe('显示模式', () => {
  it('在单栏和双栏之间切换', () => {
    expect(nextDisplayMode('single')).toBe('split');
    expect(nextDisplayMode('split')).toBe('single');
  });

  it('只接受已保存的双栏模式', () => {
    expect(normalizeDisplayMode('split')).toBe('split');
    expect(normalizeDisplayMode('single')).toBe('single');
    expect(normalizeDisplayMode(undefined)).toBe('single');
  });
});
