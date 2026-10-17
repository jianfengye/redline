export type FileStatus = 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U';

export interface DiffFile {
  status: FileStatus;
  path: string;
  oldPath?: string;
}

export interface TreeNode {
  type: 'dir' | 'file';
  name: string;
  path: string;
  status?: FileStatus;
  oldPath?: string;
  children?: TreeNode[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'delete';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface ParsedPatch {
  hunks: DiffHunk[];
}

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseNameStatus(output: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line) {
      continue;
    }
    const parts = line.split('\t');
    const status = (parts[0]?.[0] ?? '') as FileStatus;
    if ((status === 'R' || status === 'C') && parts[1] && parts[2]) {
      files.push({ status, oldPath: parts[1], path: parts[2] });
      continue;
    }
    if (parts[1]) {
      files.push({ status, path: parts[1] });
    }
  }
  return files;
}

export function buildFileTree(files: DiffFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split('/');
    let siblings = root;
    let prefix = '';
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const path = prefix ? `${prefix}/${name}` : name;
      const isFile = index === parts.length - 1;
      if (isFile) {
        siblings.push({
          type: 'file',
          name,
          path: file.path,
          status: file.status,
          ...(file.oldPath ? { oldPath: file.oldPath } : {}),
        });
        continue;
      }
      let directory = siblings.find((node) => node.type === 'dir' && node.name === name);
      if (!directory) {
        directory = { type: 'dir', name, path, children: [] };
        siblings.push(directory);
      }
      siblings = directory.children ?? [];
      prefix = path;
    }
  }
  sortTree(root);
  return root;
}

export function parseUnifiedDiff(patch: string): ParsedPatch {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of patch.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const header = hunkHeader.exec(line);
    if (header) {
      current = {
        header: line,
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      hunks.push(current);
      oldLine = current.oldStart;
      newLine = current.newStart;
      continue;
    }
    if (!current || line.startsWith('\\') || line === '') {
      continue;
    }
    if (line.startsWith('+')) {
      current.lines.push({ type: 'add', content: line.slice(1), newLineNumber: newLine });
      newLine += 1;
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'delete', content: line.slice(1), oldLineNumber: oldLine });
      oldLine += 1;
    } else if (line.startsWith(' ')) {
      current.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
    }
  }

  return { hunks };
}

export function pairSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let pendingDeletes: DiffLine[] = [];
  let pendingAdds: DiffLine[] = [];

  const flush = () => {
    const count = Math.max(pendingDeletes.length, pendingAdds.length);
    for (let index = 0; index < count; index += 1) {
      rows.push({
        left: pendingDeletes[index] ?? null,
        right: pendingAdds[index] ?? null,
      });
    }
    pendingDeletes = [];
    pendingAdds = [];
  };

  for (const line of lines) {
    if (line.type === 'context') {
      flush();
      rows.push({ left: line, right: line });
      continue;
    }
    if (line.type === 'delete') {
      if (pendingAdds.length > 0) {
        flush();
      }
      pendingDeletes.push(line);
      continue;
    }
    pendingAdds.push(line);
  }
  flush();
  return rows;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'dir' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'zh-CN');
  });
  for (const node of nodes) {
    if (node.children) {
      sortTree(node.children);
    }
  }
}
