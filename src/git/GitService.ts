import { execFile } from 'node:child_process';
import { isSafeBranchName } from '../shared/branches';
import { parseNameStatus, type DiffFile, type FileStatus } from '../shared/diff';
import { chooseReviewBase } from './reviewBase';

export interface GitRunResult {
  stdout: string;
  truncated: boolean;
}

export type GitRunner = (args: string[], cwd: string, maxBytes?: number) => Promise<GitRunResult>;

export interface FileDiffResult {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  submodule: boolean;
  truncated: boolean;
  patch: string;
}

export interface ShownFile {
  content: string;
  missing: boolean;
  binary: boolean;
}

export interface ReviewBase {
  revision: string;
  upstream?: string;
}

export interface BranchSyncStatus {
  branch: string;
  upstream: string;
  inSync: boolean;
  ahead: number;
  behind: number;
}

const fileDiffLimit = 1024 * 1024;

export function mapGitError(error: unknown): Error {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
    return new Error('未找到 Git，请先安装并加入 PATH');
  }
  if (error instanceof Error && error.message.trim()) {
    return error;
  }
  return new Error('Git 命令执行失败');
}

export class GitService {
  private reviewCache: { key: string; value: ReviewBase } | undefined;

  constructor(
    private readonly cwd: string,
    private readonly run: GitRunner = defaultGitRunner,
  ) {}

  async ensureRepo(): Promise<void> {
    const { stdout } = await this.execute(['rev-parse', '--is-inside-work-tree']);
    if (stdout.trim() !== 'true') {
      throw new Error('当前文件夹不是 Git 仓库');
    }
  }

  async listBranches(): Promise<{ branches: string[]; current: string | null }> {
    const listed = await this.execute(['branch', '--format=%(refname:short)']);
    const current = await this.execute(['branch', '--show-current']);
    const branches = listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const name = current.stdout.trim();
    return { branches, current: name || null };
  }

  async reviewBase(base: string, compare: string): Promise<ReviewBase> {
    this.assertSafeBranch(base);
    this.assertSafeBranch(compare);
    const key = `${base}\0${compare}`;
    const cached = this.reviewCache;
    if (cached?.key === key) {
      return cached.value;
    }
    await this.verifyBranch(base);
    await this.verifyBranch(compare);
    const baseRef = `refs/heads/${base}`;
    const compareRef = `refs/heads/${compare}`;
    const local = (await this.execute(['merge-base', baseRef, compareRef])).stdout.trim();
    let revision = local;
    let upstream: string | undefined;
    const tracked = await this.upstreamOf(base);
    if (tracked && isSafeBranchName(tracked)) {
      try {
        const remote = (await this.execute(['merge-base', tracked, compareRef])).stdout.trim();
        const upstreamIsNewer = remote !== local && (await this.isAncestor(local, remote));
        revision = chooseReviewBase(local, remote, upstreamIsNewer);
        if (revision === remote && revision !== local) {
          upstream = tracked;
        }
      } catch (error) {
        if (error instanceof Error && error.message === '未找到 Git，请先安装并加入 PATH') {
          throw error;
        }
      }
    }
    const value: ReviewBase = { revision, ...(upstream ? { upstream } : {}) };
    this.reviewCache = { key, value };
    return value;
  }

  async branchSyncStatus(branch: string): Promise<BranchSyncStatus | null> {
    this.assertSafeBranch(branch);
    await this.verifyBranch(branch);
    const upstream = await this.upstreamOf(branch);
    if (!upstream || !isSafeBranchName(upstream)) {
      return null;
    }
    const localSha = (await this.execute(['rev-parse', `refs/heads/${branch}`])).stdout.trim();
    const remoteSha = (await this.execute(['rev-parse', upstream])).stdout.trim();
    if (localSha === remoteSha) {
      return { branch, upstream, inSync: true, ahead: 0, behind: 0 };
    }
    const counts = (
      await this.execute(['rev-list', '--left-right', '--count', `refs/heads/${branch}...${upstream}`])
    ).stdout.trim();
    const [ahead, behind] = counts.split(/\s+/).map((part) => Number(part) || 0);
    return { branch, upstream, inSync: false, ahead, behind };
  }

  async fetchAndCheckBranch(branch: string): Promise<BranchSyncStatus | null> {
    this.assertSafeBranch(branch);
    await this.verifyBranch(branch);
    const upstream = await this.upstreamOf(branch);
    if (!upstream || !isSafeBranchName(upstream)) {
      return null;
    }
    const { remote, branch: remoteBranch } = parseUpstream(upstream);
    await this.execute(['fetch', '--quiet', remote, remoteBranch]);
    return this.branchSyncStatus(branch);
  }

  async syncCurrentBranch(branch: string): Promise<void> {
    this.assertSafeBranch(branch);
    const current = (await this.execute(['branch', '--show-current'])).stdout.trim();
    if (current !== branch) {
      throw new Error('只能同步当前检出的本地分支');
    }
    await this.fastForwardBranch(branch);
  }

  async syncBranch(branch: string): Promise<void> {
    this.assertSafeBranch(branch);
    const current = (await this.execute(['branch', '--show-current'])).stdout.trim();
    if (current === branch) {
      await this.fastForwardBranch(branch);
      return;
    }
    const upstream = await this.upstreamOf(branch);
    if (!upstream || !isSafeBranchName(upstream)) {
      throw new Error('该分支没有配置上游远程分支');
    }
    const { remote, branch: remoteBranch } = parseUpstream(upstream);
    await this.execute(['fetch', remote, `${remoteBranch}:${branch}`]);
  }

  private async fastForwardBranch(branch: string): Promise<void> {
    const upstream = await this.upstreamOf(branch);
    if (!upstream || !isSafeBranchName(upstream)) {
      throw new Error('该分支没有配置上游远程分支');
    }
    const { remote, branch: remoteBranch } = parseUpstream(upstream);
    await this.execute(['fetch', '--quiet', remote, remoteBranch]);
    await this.execute(['merge', '--ff-only', upstream]);
  }

  async diffNames(base: string, compare: string): Promise<DiffFile[]> {
    const { revision } = await this.reviewBase(base, compare);
    const { stdout } = await this.execute([
      '-c',
      'core.quotepath=false',
      'diff',
      '--name-status',
      '--find-renames',
      revision,
      `refs/heads/${compare}`,
    ]);
    return parseNameStatus(stdout);
  }

  async diffFile(base: string, compare: string, file: DiffFile): Promise<FileDiffResult> {
    this.assertSafeBranch(base);
    this.assertSafeBranch(compare);
    if (!isSafeRepoPath(file.path) || (file.oldPath !== undefined && !isSafeRepoPath(file.oldPath))) {
      throw new Error('无效的文件路径');
    }
    const { revision } = await this.reviewBase(base, compare);
    const paths = file.oldPath && file.oldPath !== file.path ? [file.oldPath, file.path] : [file.path];
    const result = await this.execute(
      [
        '-c',
        'core.quotepath=false',
        'diff',
        '--find-renames',
        '-U3',
        revision,
        `refs/heads/${compare}`,
        '--',
        ...paths,
      ],
      fileDiffLimit,
    );
    const kind = classifyPatch(result.stdout);
    return {
      path: file.path,
      ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      status: file.status,
      binary: kind.binary,
      submodule: kind.submodule,
      truncated: result.truncated,
      patch: kind.binary || kind.submodule ? '' : result.stdout,
    };
  }

  async showFile(ref: string, path: string): Promise<ShownFile> {
    if (!isCommitSha(ref)) {
      this.assertSafeBranch(ref);
    }
    if (!isSafeRepoPath(path)) {
      throw new Error('无效的文件路径');
    }
    if (!isCommitSha(ref)) {
      await this.verifyBranch(ref);
    }
    const revision = isCommitSha(ref) ? ref : `refs/heads/${ref}`;
    try {
      const result = await this.execute(
        ['-c', 'core.quotepath=false', 'show', `${revision}:${path}`],
        fileDiffLimit,
      );
      if (result.truncated) {
        throw new Error('文件过大，无法完整打开');
      }
      if (result.stdout.includes('\0')) {
        return { content: '', missing: false, binary: true };
      }
      return { content: result.stdout, missing: false, binary: false };
    } catch (error) {
      if (isMissingPathError(error)) {
        return { content: '', missing: true, binary: false };
      }
      throw error;
    }
  }

  private assertSafeBranch(name: string): void {
    if (!isSafeBranchName(name)) {
      throw new Error('无效的分支名称');
    }
  }

  private async upstreamOf(branch: string): Promise<string | null> {
    try {
      const { stdout } = await this.execute(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);
      const name = stdout.trim();
      if (!name || name.endsWith('@{upstream}')) {
        return null;
      }
      return name;
    } catch (error) {
      if (error instanceof Error && error.message === '未找到 Git，请先安装并加入 PATH') {
        throw error;
      }
      return null;
    }
  }

  private async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    try {
      await this.execute(['merge-base', '--is-ancestor', ancestor, descendant]);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === '未找到 Git，请先安装并加入 PATH') {
        throw error;
      }
      return false;
    }
  }

  private async verifyBranch(name: string): Promise<void> {
    this.assertSafeBranch(name);
    try {
      await this.execute(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
    } catch (error) {
      if (error instanceof Error && error.message === '未找到 Git，请先安装并加入 PATH') {
        throw error;
      }
      throw new Error('无效的分支名称');
    }
  }

  private async execute(args: string[], maxBytes?: number): Promise<GitRunResult> {
    try {
      return await this.run(args, this.cwd, maxBytes);
    } catch (error) {
      throw mapGitError(error);
    }
  }
}

export function classifyPatch(patch: string): { binary: boolean; submodule: boolean } {
  const head = patch.slice(0, 4000);
  return {
    binary: /^Binary files /m.test(head) || head.includes('GIT binary patch'),
    submodule: /^[+-]Subproject commit /m.test(head) || /^index \S+ 160000$/m.test(head),
  };
}

export function isSafeRepoPath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\0') || path.includes('\\')) {
    return false;
  }
  return path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

function parseUpstream(upstream: string): { remote: string; branch: string } {
  const slashIndex = upstream.indexOf('/');
  if (slashIndex <= 0 || slashIndex === upstream.length - 1) {
    throw new Error('无法解析远程分支名称');
  }
  return { remote: upstream.slice(0, slashIndex), branch: upstream.slice(slashIndex + 1) };
}

function isMissingPathError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return message.includes('does not exist') || message.includes('exists on disk, but not in');
}

function defaultGitRunner(args: string[], cwd: string, maxBytes = 2 * 1024 * 1024): Promise<GitRunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: maxBytes,
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout, stderr) => {
        if (error && 'code' in error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          resolve({ stdout, truncated: true });
          return;
        }
        if (error && 'code' in error && error.code === 'ENOENT') {
          reject(error);
          return;
        }
        if (error) {
          reject(new Error(stderr.trim() || error.message.trim() || 'Git 命令执行失败'));
          return;
        }
        resolve({ stdout, truncated: false });
      },
    );
  });
}
