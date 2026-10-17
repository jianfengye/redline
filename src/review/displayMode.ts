export type DisplayMode = 'single' | 'split';

export function nextDisplayMode(mode: DisplayMode): DisplayMode {
  return mode === 'single' ? 'split' : 'single';
}

export function normalizeDisplayMode(value: unknown): DisplayMode {
  return value === 'split' ? 'split' : 'single';
}
