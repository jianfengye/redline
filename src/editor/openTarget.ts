import { relative, sep } from 'node:path';
import type { FileStatus } from '../shared/diff';

export function shouldOpenWorkspaceFile(input: {
  compareBranch: string;
  currentBranch: string | null;
  existsOnDisk: boolean;
  status: FileStatus;
}): boolean {
  return (
    input.existsOnDisk &&
    input.status !== 'D' &&
    input.currentBranch !== null &&
    input.compareBranch === input.currentBranch
  );
}

const languages: Record<string, string> = {
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  css: 'css',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  java: 'java',
  js: 'javascript',
  jsx: 'javascriptreact',
  json: 'json',
  md: 'markdown',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'shellscript',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'typescriptreact',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

export function workspaceRelativePath(root: string, file: string): string | undefined {
  const rel = relative(root, file);
  if (!rel || rel.startsWith('..') || rel.split(sep).includes('..')) {
    return undefined;
  }
  return rel.split(sep).join('/');
}

export function languageFromPath(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase();
  return extension ? languages[extension] : undefined;
}
