import { describe, expect, it, vi } from 'vitest';
import { GitService, mapGitError, type GitRunner } from './GitService';

function runner(handler: (args: string[]) => { stdout: string; truncated?: boolean }): GitRunner {
  return vi.fn(async (args: string[]) => ({
    stdout: handler(args).stdout,
    truncated: handler(args).truncated ?? false,
  }));
}

describe('mapGitError', () => {
  it('把找不到 git 转成可展示的错误', () => {
    const error = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    expect(mapGitError(error).message).toBe('未找到 Git，请先安装并加入 PATH');
  });
});

describe('GitService', () => {
  it('确认工作区是 Git 仓库', async () => {
    const run = runner((args) => {
      expect(args).toEqual(['rev-parse', '--is-inside-work-tree']);
      return { stdout: 'true\n' };
    });
    await expect(new GitService('/repo', run).ensureRepo()).resolves.toBeUndefined();
  });

  it('工作区不是 Git 仓库时失败', async () => {
    const run = runner(() => ({ stdout: 'false\n' }));
    await expect(new GitService('/repo', run).ensureRepo()).rejects.toThrow('当前文件夹不是 Git 仓库');
  });

  it('列出本地分支和当前分支', async () => {
    const run = runner((args) => {
      if (args.includes('--show-current')) {
        return { stdout: 'feature\n' };
      }
      return { stdout: 'main\nfeature\n' };
    });
    await expect(new GitService('/repo', run).listBranches()).resolves.toEqual({
      branches: ['main', 'feature'],
      current: 'feature',
    });
  });

  it('分离头指针时当前分支为空', async () => {
    const run = runner((args) => {
      if (args.includes('--show-current')) {
        return { stdout: '\n' };
      }
      return { stdout: 'main\n' };
    });
    await expect(new GitService('/repo', run).listBranches()).resolves.toEqual({
      branches: ['main'],
      current: null,
    });
  });

  it('没有上游时从本地分叉点比较到比较分支', async () => {
    const run = vi.fn(async (args: string[], cwd: string) => {
      expect(cwd).toBe('/repo');
      if (args.join(' ').includes('@{upstream}')) {
        throw new Error('fatal: no upstream configured');
      }
      if (args[0] === 'rev-parse') {
        expect(args).toEqual(['rev-parse', '--verify', '--quiet', expect.stringMatching(/^refs\/heads\//)]);
        return { stdout: 'abc\n', truncated: false };
      }
      if (args[0] === 'merge-base') {
        return { stdout: '0123456789abcdef0123456789abcdef01234567\n', truncated: false };
      }
      expect(args).toEqual([
        '-c',
        'core.quotepath=false',
        'diff',
        '--name-status',
        '--find-renames',
        '0123456789abcdef0123456789abcdef01234567',
        'refs/heads/feature/login',
      ]);
      return { stdout: 'R100\tsrc/old.ts\tsrc/new.ts\n', truncated: false };
    });
    await expect(new GitService('/repo', run).diffNames('main', 'feature/login')).resolves.toEqual([
      { status: 'R', path: 'src/new.ts', oldPath: 'src/old.ts' },
    ]);
  });

  it('拒绝不安全的分支名并且不调用 Git', async () => {
    const run = vi.fn();
    await expect(new GitService('/repo', run).diffNames('main', 'foo..bar')).rejects.toThrow('无效的分支名称');
    expect(run).not.toHaveBeenCalled();
  });

  it('基准分支落后于上游时，从上游分叉点比较', async () => {
    const local = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const remote = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const run = vi.fn(async (args: string[]) => {
      const command = args.join(' ');
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        return { stdout: 'ok\n', truncated: false };
      }
      if (command.includes('@{upstream}')) {
        return { stdout: 'origin/main\n', truncated: false };
      }
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
        return { stdout: '', truncated: false };
      }
      if (args[0] === 'merge-base' && args.includes('refs/heads/main')) {
        return { stdout: `${local}\n`, truncated: false };
      }
      if (args[0] === 'merge-base' && args.includes('origin/main')) {
        return { stdout: `${remote}\n`, truncated: false };
      }
      expect(args).toEqual([
        '-c',
        'core.quotepath=false',
        'diff',
        '--name-status',
        '--find-renames',
        remote,
        'refs/heads/feature',
      ]);
      return { stdout: 'M\tonly.ts\n', truncated: false };
    });
    const service = new GitService('/repo', run);
    await expect(service.diffNames('main', 'feature')).resolves.toEqual([{ status: 'M', path: 'only.ts' }]);
    await expect(service.reviewBase('main', 'feature')).resolves.toEqual({
      revision: remote,
      upstream: 'origin/main',
    });
  });

  it('获取单文件差异，重命名同时传入新旧路径', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args.join(' ').includes('@{upstream}')) {
        throw new Error('fatal: no upstream configured');
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'abc\n', truncated: false };
      }
      if (args[0] === 'merge-base') {
        return { stdout: '0123456789abcdef0123456789abcdef01234567\n', truncated: false };
      }
      expect(args).toEqual([
        '-c',
        'core.quotepath=false',
        'diff',
        '--find-renames',
        '-U3',
        '0123456789abcdef0123456789abcdef01234567',
        'refs/heads/feature',
        '--',
        'src/old.ts',
        'src/new.ts',
      ]);
      return {
        stdout: '@@ -1 +1 @@\n-old\n+new\n',
        truncated: false,
      };
    });
    await expect(
      new GitService('/repo', run).diffFile('main', 'feature', {
        status: 'R',
        path: 'src/new.ts',
        oldPath: 'src/old.ts',
      }),
    ).resolves.toMatchObject({
      path: 'src/new.ts',
      oldPath: 'src/old.ts',
      status: 'R',
      binary: false,
      submodule: false,
      truncated: false,
      patch: '@@ -1 +1 @@\n-old\n+new\n',
    });
  });

  it('识别二进制文件和子模块，并且不保留补丁正文', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args.join(' ').includes('@{upstream}')) {
        throw new Error('fatal: no upstream configured');
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'abc\n', truncated: false };
      }
      if (args[0] === 'merge-base') {
        return { stdout: '0123456789abcdef0123456789abcdef01234567\n', truncated: false };
      }
      if (args.includes('pic.bin')) {
        return { stdout: 'Binary files a/pic.bin and b/pic.bin differ\n', truncated: false };
      }
      return {
        stdout: 'index aaa..bbb 160000\n--- a/sub\n+++ b/sub\n@@ -1 +1 @@\n-Subproject commit aaa\n+Subproject commit bbb\n',
        truncated: false,
      };
    });
    const service = new GitService('/repo', run);
    await expect(
      service.diffFile('main', 'feature', { status: 'M', path: 'pic.bin' }),
    ).resolves.toMatchObject({ binary: true, submodule: false, patch: '' });
    await expect(
      service.diffFile('main', 'feature', { status: 'M', path: 'sub' }),
    ).resolves.toMatchObject({ binary: false, submodule: true, patch: '' });
  });

  it('超过限制时标记截断并保留已读取内容', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args.join(' ').includes('@{upstream}')) {
        throw new Error('fatal: no upstream configured');
      }
      if (args[0] === 'rev-parse') {
        return { stdout: 'ok\n', truncated: false };
      }
      if (args[0] === 'merge-base') {
        return { stdout: '0123456789abcdef0123456789abcdef01234567\n', truncated: false };
      }
      return { stdout: '@@ -1 +1 @@\n+partial\n', truncated: true };
    });
    await expect(
      new GitService('/repo', run).diffFile('main', 'feature', { status: 'M', path: 'big.ts' }),
    ).resolves.toMatchObject({
      truncated: true,
      patch: '@@ -1 +1 @@\n+partial\n',
    });
  });

  it('读取指定分支上的完整文件', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse') {
        return { stdout: 'abc\n', truncated: false };
      }
      expect(args).toEqual(['-c', 'core.quotepath=false', 'show', 'refs/heads/feature:src/a.ts']);
      return { stdout: 'func Lookup() {}\n', truncated: false };
    });
    await expect(new GitService('/repo', run).showFile('feature', 'src/a.ts')).resolves.toEqual({
      content: 'func Lookup() {}\n',
      missing: false,
      binary: false,
    });
  });

  it('比较分支没有该文件时标记为缺失', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse') {
        return { stdout: 'abc\n', truncated: false };
      }
      throw new Error("fatal: path 'gone.ts' does not exist in 'refs/heads/feature'");
    });
    await expect(new GitService('/repo', run).showFile('feature', 'gone.ts')).resolves.toEqual({
      content: '',
      missing: true,
      binary: false,
    });
  });

  it('拒绝逃出仓库的路径', async () => {
    const run = vi.fn();
    await expect(
      new GitService('/repo', run).diffFile('main', 'feature', { status: 'M', path: '../secret.ts' }),
    ).rejects.toThrow('无效的文件路径');
    expect(run).not.toHaveBeenCalled();
  });

  it('检测本地分支与远程是否同步', async () => {
    const local = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const remote = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const run = vi.fn(async (args: string[]) => {
      const command = args.join(' ');
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        return { stdout: 'ok\n', truncated: false };
      }
      if (command.includes('@{upstream}')) {
        return { stdout: 'origin/main\n', truncated: false };
      }
      if (args[0] === 'rev-parse' && args[1] === 'refs/heads/main') {
        return { stdout: `${local}\n`, truncated: false };
      }
      if (args[0] === 'rev-parse' && args[1] === 'origin/main') {
        return { stdout: `${remote}\n`, truncated: false };
      }
      expect(args).toEqual(['rev-list', '--left-right', '--count', `refs/heads/main...origin/main`]);
      return { stdout: '0\t3\n', truncated: false };
    });
    await expect(new GitService('/repo', run).branchSyncStatus('main')).resolves.toEqual({
      branch: 'main',
      upstream: 'origin/main',
      inSync: false,
      ahead: 0,
      behind: 3,
    });
  });

  it('没有上游时同步状态为 null', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        return { stdout: 'ok\n', truncated: false };
      }
      if (args.join(' ').includes('@{upstream}')) {
        throw new Error('fatal: no upstream');
      }
      return { stdout: '', truncated: false };
    });
    await expect(new GitService('/repo', run).branchSyncStatus('main')).resolves.toBeNull();
  });

  it('将远端分支合并到本地分支', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === 'branch' && args[1] === '--show-current') {
        return { stdout: 'other\n', truncated: false };
      }
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        return { stdout: 'ok\n', truncated: false };
      }
      if (args.join(' ').includes('@{upstream}')) {
        return { stdout: 'origin/main\n', truncated: false };
      }
      expect(args).toEqual(['fetch', 'origin', 'main:main']);
      return { stdout: '', truncated: false };
    });
    await expect(new GitService('/repo', run).syncBranch('main')).resolves.toBeUndefined();
  });

  it('当前检出的分支用快进合并同步', async () => {
    const run = vi.fn(async (args: string[]) => {
      const command = args.join(' ');
      if (args[0] === 'branch' && args[1] === '--show-current') {
        return { stdout: 'dev/ai_pro_v2\n', truncated: false };
      }
      if (command.includes('@{upstream}')) {
        return { stdout: 'origin/dev/ai_pro_v2\n', truncated: false };
      }
      if (args[0] === 'fetch') {
        expect(args).toEqual(['fetch', '--quiet', 'origin', 'dev/ai_pro_v2']);
        return { stdout: '', truncated: false };
      }
      expect(args).toEqual(['merge', '--ff-only', 'origin/dev/ai_pro_v2']);
      return { stdout: '', truncated: false };
    });
    await expect(new GitService('/repo', run).syncBranch('dev/ai_pro_v2')).resolves.toBeUndefined();
  });

  it('检查同步状态前拉取上游分支', async () => {
    const run = vi.fn(async (args: string[]) => {
      const command = args.join(' ');
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        return { stdout: 'ok\n', truncated: false };
      }
      if (command.includes('@{upstream}')) {
        return { stdout: 'origin/main\n', truncated: false };
      }
      if (args[0] === 'fetch') {
        expect(args).toEqual(['fetch', '--quiet', 'origin', 'main']);
        return { stdout: '', truncated: false };
      }
      if (args[0] === 'rev-parse' && args[1] === 'refs/heads/main') {
        return { stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', truncated: false };
      }
      if (args[0] === 'rev-parse' && args[1] === 'origin/main') {
        return { stdout: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n', truncated: false };
      }
      expect(args).toEqual(['rev-list', '--left-right', '--count', 'refs/heads/main...origin/main']);
      return { stdout: '0\t2\n', truncated: false };
    });
    await expect(new GitService('/repo', run).fetchAndCheckBranch('main')).resolves.toMatchObject({
      behind: 2,
      ahead: 0,
      upstream: 'origin/main',
    });
  });

  it('将当前分支快进合并到远端上游', async () => {
    const run = vi.fn(async (args: string[]) => {
      const command = args.join(' ');
      if (args[0] === 'branch' && args[1] === '--show-current') {
        return { stdout: 'main\n', truncated: false };
      }
      if (command.includes('@{upstream}')) {
        return { stdout: 'origin/main\n', truncated: false };
      }
      if (args[0] === 'fetch') {
        expect(args).toEqual(['fetch', '--quiet', 'origin', 'main']);
        return { stdout: '', truncated: false };
      }
      expect(args).toEqual(['merge', '--ff-only', 'origin/main']);
      return { stdout: '', truncated: false };
    });
    await expect(new GitService('/repo', run).syncCurrentBranch('main')).resolves.toBeUndefined();
  });
});
