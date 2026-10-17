const forbiddenBranchCharacters = /[\u0000-\u001f\u007f ~^:?*[\\]/;

export function isSafeBranchName(name: string): boolean {
  if (!name || name.length > 250) {
    return false;
  }
  if (
    name.startsWith('-') ||
    name.startsWith('/') ||
    name.startsWith('.') ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.endsWith('.lock')
  ) {
    return false;
  }
  if (name.includes('..') || name.includes('@{') || name.includes('//')) {
    return false;
  }
  return !forbiddenBranchCharacters.test(name);
}

export function pickDefaultBranches(
  branches: string[],
  current: string | null,
): { base: string; compare: string } {
  if (branches.length === 0) {
    return { base: '', compare: '' };
  }
  const compare = current && branches.includes(current) ? current : branches[0];
  const base = ['main', 'master'].find((name) => branches.includes(name)) ?? branches[0];
  return { base, compare };
}
