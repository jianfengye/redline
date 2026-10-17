import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitService } from './GitService';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

describe('GitService 真实仓库', () => {
  it('比较两个本地分支的新增、修改、删除和重命名', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'reviewer-git-'));
    try {
      git(cwd, ['init', '-b', 'main']);
      git(cwd, ['config', 'user.email', 'reviewer@example.com']);
      git(cwd, ['config', 'user.name', 'Reviewer']);
      writeFileSync(join(cwd, 'keep.ts'), 'export const a = 1;\n');
      writeFileSync(join(cwd, 'gone.ts'), 'export const gone = true;\n');
      writeFileSync(join(cwd, 'old.ts'), 'export const name = "old";\n');
      git(cwd, ['add', '.']);
      git(cwd, ['commit', '-m', 'init']);
      git(cwd, ['checkout', '-b', 'feature']);
      writeFileSync(join(cwd, 'keep.ts'), 'export const a = 2;\n');
      writeFileSync(join(cwd, 'added.ts'), 'export const added = true;\n');
      git(cwd, ['rm', 'gone.ts']);
      git(cwd, ['mv', 'old.ts', 'renamed.ts']);
      git(cwd, ['add', '.']);
      git(cwd, ['commit', '-m', 'change']);

      const service = new GitService(cwd);
      const listed = await service.listBranches();
      expect(new Set(listed.branches)).toEqual(new Set(['main', 'feature']));
      expect(listed.current).toBe('feature');

      const files = await service.diffNames('main', 'feature');
      expect(files).toEqual(
        expect.arrayContaining([
          { status: 'M', path: 'keep.ts' },
          { status: 'A', path: 'added.ts' },
          { status: 'D', path: 'gone.ts' },
          { status: 'R', path: 'renamed.ts', oldPath: 'old.ts' },
        ]),
      );

      const modified = await service.diffFile('main', 'feature', { status: 'M', path: 'keep.ts' });
      expect(modified.patch).toContain('-export const a = 1;');
      expect(modified.patch).toContain('+export const a = 2;');
      expect(modified.binary).toBe(false);
      const renamed = await service.diffFile('main', 'feature', {
        status: 'R',
        path: 'renamed.ts',
        oldPath: 'old.ts',
      });
      expect(renamed.patch).toContain('renamed.ts');
      expect(renamed.binary).toBe(false);
      const full = await service.showFile('feature', 'keep.ts');
      expect(full).toEqual({ content: 'export const a = 2;\n', missing: false, binary: false });
      const removed = await service.showFile('feature', 'gone.ts');
      expect(removed.missing).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('本地基准分支落后于上游时，不把已经进入上游的提交算进本次改动', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'reviewer-upstream-'));
    try {
      git(cwd, ['init', '-b', 'main']);
      git(cwd, ['config', 'user.email', 'reviewer@example.com']);
      git(cwd, ['config', 'user.name', 'Reviewer']);
      writeFileSync(join(cwd, 'base.txt'), 'base\n');
      git(cwd, ['add', '.']);
      git(cwd, ['commit', '-m', 'base']);
      const first = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
      writeFileSync(join(cwd, 'shared.txt'), 'from-main\n');
      git(cwd, ['add', '.']);
      git(cwd, ['commit', '-m', 'main moves']);
      const second = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
      git(cwd, ['checkout', '-b', 'feature']);
      writeFileSync(join(cwd, 'feature.txt'), 'feature\n');
      git(cwd, ['add', '.']);
      git(cwd, ['commit', '-m', 'feature']);
      git(cwd, ['branch', '-f', 'main', first]);
      git(cwd, ['update-ref', 'refs/remotes/origin/main', second]);
      git(cwd, ['config', 'remote.origin.url', cwd]);
      git(cwd, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
      git(cwd, ['branch', '--set-upstream-to=origin/main', 'main']);

      const service = new GitService(cwd);
      const review = await service.reviewBase('main', 'feature');
      expect(review.upstream).toBe('origin/main');
      expect(review.revision).toBe(second);
      await expect(service.diffNames('main', 'feature')).resolves.toEqual([{ status: 'A', path: 'feature.txt' }]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
