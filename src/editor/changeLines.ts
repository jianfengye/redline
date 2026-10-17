import { parseUnifiedDiff } from '../shared/diff';

export interface ChangedLines {
  added: number[];
  modified: number[];
}

export function collectChangedLines(patch: string): ChangedLines {
  const added: number[] = [];
  const modified: number[] = [];
  for (const hunk of parseUnifiedDiff(patch).hunks) {
    let pendingDeletes = 0;
    for (const line of hunk.lines) {
      if (line.type === 'delete') {
        pendingDeletes += 1;
        continue;
      }
      if (line.type === 'context') {
        pendingDeletes = 0;
        continue;
      }
      if (!line.newLineNumber) {
        continue;
      }
      if (pendingDeletes > 0) {
        modified.push(line.newLineNumber);
        pendingDeletes -= 1;
      } else {
        added.push(line.newLineNumber);
      }
    }
  }
  return { added, modified };
}
