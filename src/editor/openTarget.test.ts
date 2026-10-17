import { describe, expect, it } from 'vitest';
import { shouldOpenWorkspaceFile, workspaceRelativePath } from './openTarget';

describe('shouldOpenWorkspaceFile', () => {
  it('比较分支是当前分支且文件仍在磁盘上时打开真实文件', () => {
    expect(
      shouldOpenWorkspaceFile({
        compareBranch: 'feature',
        currentBranch: 'feature',
        existsOnDisk: true,
        status: 'M',
      }),
    ).toBe(true);
  });

  it('比较分支不是当前检出分支时打开虚拟文档', () => {
    expect(
      shouldOpenWorkspaceFile({
        compareBranch: 'feature',
        currentBranch: 'main',
        existsOnDisk: true,
        status: 'M',
      }),
    ).toBe(false);
  });

  it('已删除的文件不打开工作区路径', () => {
    expect(
      shouldOpenWorkspaceFile({
        compareBranch: 'feature',
        currentBranch: 'feature',
        existsOnDisk: true,
        status: 'D',
      }),
    ).toBe(false);
  });

  it('把工作区里的绝对路径换成变更列表里的相对路径', () => {
    expect(workspaceRelativePath('/repo', '/repo/service/logic/a.go')).toBe('service/logic/a.go');
    expect(workspaceRelativePath('/repo', '/other/a.go')).toBeUndefined();
  });

  it('磁盘上不存在时不打开工作区路径', () => {
    expect(
      shouldOpenWorkspaceFile({
        compareBranch: 'feature',
        currentBranch: 'feature',
        existsOnDisk: false,
        status: 'A',
      }),
    ).toBe(false);
  });
});
