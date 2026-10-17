import { describe, expect, it } from 'vitest';
import { chooseReviewBase } from './reviewBase';

const local = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const upstream = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('chooseReviewBase', () => {
  it('上游分叉点更新时使用上游，避免把已进主干的提交算进本次改动', () => {
    expect(chooseReviewBase(local, upstream, true)).toBe(upstream);
  });

  it('没有上游或上游更旧时保持本地分叉点', () => {
    expect(chooseReviewBase(local, undefined, false)).toBe(local);
    expect(chooseReviewBase(local, upstream, false)).toBe(local);
    expect(chooseReviewBase(local, local, true)).toBe(local);
  });
});
