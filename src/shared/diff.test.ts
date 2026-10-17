import { describe, expect, it } from 'vitest';
import { buildFileTree, pairSplitRows, parseNameStatus, parseUnifiedDiff } from './diff';

describe('parseNameStatus', () => {
  it('解析新增、修改、删除、重命名和复制', () => {
    const output = [
      'M\tsrc/a.ts',
      'A\tsrc/b.ts',
      'D\told.ts',
      'R100\tsrc/old.ts\tsrc/new.ts',
      'C080\tlib/a.ts\tlib/b.ts',
      'T\tmode.ts',
      '',
    ].join('\n');

    expect(parseNameStatus(output)).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: 'A', path: 'src/b.ts' },
      { status: 'D', path: 'old.ts' },
      { status: 'R', path: 'src/new.ts', oldPath: 'src/old.ts' },
      { status: 'C', path: 'lib/b.ts', oldPath: 'lib/a.ts' },
      { status: 'T', path: 'mode.ts' },
    ]);
  });

  it('保留路径中的空格', () => {
    expect(parseNameStatus('M\tsrc/my file.ts\n')).toEqual([
      { status: 'M', path: 'src/my file.ts' },
    ]);
  });
});

describe('buildFileTree', () => {
  it('按目录分组，目录排在文件前面', () => {
    const tree = buildFileTree([
      { status: 'M', path: 'src/a.ts' },
      { status: 'A', path: 'src/sub/b.ts' },
      { status: 'D', path: 'README.md' },
      { status: 'R', path: 'src/new.ts', oldPath: 'src/old.ts' },
      { status: 'M', path: 'src/my file.ts' },
    ]);

    expect(tree.map((node) => node.name)).toEqual(['src', 'README.md']);
    const src = tree[0];
    expect(src.type).toBe('dir');
    expect(src.children?.map((node) => node.name)).toEqual(['sub', 'a.ts', 'my file.ts', 'new.ts']);
    expect(src.children?.find((node) => node.name === 'new.ts')).toMatchObject({
      type: 'file',
      path: 'src/new.ts',
      status: 'R',
      oldPath: 'src/old.ts',
    });
    expect(src.children?.find((node) => node.name === 'sub')?.children).toEqual([
      {
        type: 'file',
        name: 'b.ts',
        path: 'src/sub/b.ts',
        status: 'A',
      },
    ]);
  });
});

describe('parseUnifiedDiff', () => {
  it('解析上下文、删除和新增行号，并忽略无换行标记', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@ fn',
      ' line1',
      '-line2',
      '+line2b',
      '+line2c',
      ' line3',
      '\\ No newline at end of file',
      '',
    ].join('\n');

    expect(parseUnifiedDiff(patch)).toEqual({
      hunks: [
        {
          header: '@@ -1,3 +1,4 @@ fn',
          oldStart: 1,
          oldCount: 3,
          newStart: 1,
          newCount: 4,
          lines: [
            { type: 'context', content: 'line1', oldLineNumber: 1, newLineNumber: 1 },
            { type: 'delete', content: 'line2', oldLineNumber: 2 },
            { type: 'add', content: 'line2b', newLineNumber: 2 },
            { type: 'add', content: 'line2c', newLineNumber: 3 },
            { type: 'context', content: 'line3', oldLineNumber: 3, newLineNumber: 4 },
          ],
        },
      ],
    });
  });

  it('没有 hunk 时返回空列表', () => {
    expect(parseUnifiedDiff('old mode 100644\nnew mode 100755\n')).toEqual({ hunks: [] });
  });
});

describe('pairSplitRows', () => {
  it('把连续的删除和新增配成左右两栏', () => {
    const rows = pairSplitRows([
      { type: 'context', content: 'keep', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'delete', content: 'old-a', oldLineNumber: 2 },
      { type: 'delete', content: 'old-b', oldLineNumber: 3 },
      { type: 'add', content: 'new-a', newLineNumber: 2 },
      { type: 'context', content: 'tail', oldLineNumber: 4, newLineNumber: 3 },
    ]);

    expect(rows).toEqual([
      {
        left: { type: 'context', content: 'keep', oldLineNumber: 1, newLineNumber: 1 },
        right: { type: 'context', content: 'keep', oldLineNumber: 1, newLineNumber: 1 },
      },
      {
        left: { type: 'delete', content: 'old-a', oldLineNumber: 2 },
        right: { type: 'add', content: 'new-a', newLineNumber: 2 },
      },
      {
        left: { type: 'delete', content: 'old-b', oldLineNumber: 3 },
        right: null,
      },
      {
        left: { type: 'context', content: 'tail', oldLineNumber: 4, newLineNumber: 3 },
        right: { type: 'context', content: 'tail', oldLineNumber: 4, newLineNumber: 3 },
      },
    ]);
  });
});
