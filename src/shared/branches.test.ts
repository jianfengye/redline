import { describe, expect, it } from 'vitest';
import { isSafeBranchName, pickDefaultBranches } from './branches';

describe('isSafeBranchName', () => {
  it('接受普通、多级和中文分支名', () => {
    expect(isSafeBranchName('main')).toBe(true);
    expect(isSafeBranchName('feature/login')).toBe(true);
    expect(isSafeBranchName('功能分支')).toBe(true);
  });

  it('拒绝可混淆三点语法或选项的名称', () => {
    expect(isSafeBranchName('')).toBe(false);
    expect(isSafeBranchName('-feature')).toBe(false);
    expect(isSafeBranchName('foo..bar')).toBe(false);
    expect(isSafeBranchName('foo bar')).toBe(false);
    expect(isSafeBranchName('release@{1}')).toBe(false);
    expect(isSafeBranchName('/feature')).toBe(false);
    expect(isSafeBranchName('feature/')).toBe(false);
  });
});

describe('pickDefaultBranches', () => {
  it('比较分支用当前分支，基准分支优先 main', () => {
    expect(pickDefaultBranches(['feature', 'main', 'dev'], 'feature')).toEqual({
      base: 'main',
      compare: 'feature',
    });
  });

  it('没有 main 时使用 master', () => {
    expect(pickDefaultBranches(['master', 'feature'], 'feature')).toEqual({
      base: 'master',
      compare: 'feature',
    });
  });

  it('当前分支不在列表时退回第一个分支', () => {
    expect(pickDefaultBranches(['dev', 'main'], null)).toEqual({
      base: 'main',
      compare: 'dev',
    });
  });

  it('没有 main 和 master 时基准分支使用第一个分支', () => {
    expect(pickDefaultBranches(['dev', 'feature'], 'feature')).toEqual({
      base: 'dev',
      compare: 'feature',
    });
  });

  it('空列表返回空字符串', () => {
    expect(pickDefaultBranches([], null)).toEqual({ base: '', compare: '' });
  });
});
