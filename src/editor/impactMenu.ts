export function showsImpactMenu(input: {
  scheme: string;
  relativePath?: string;
  changedPaths: readonly string[];
  openedByRedline: boolean;
}): boolean {
  if (input.scheme === 'file') {
    return input.relativePath !== undefined && input.changedPaths.includes(input.relativePath);
  }
  return input.openedByRedline;
}
