import { describe, expect, it } from 'vitest';
import { collectChangedLines } from './changeLines';

describe('collectChangedLines', () => {
  it('把替换行记为修改，把多出来的新行记为新增', () => {
    const patch = ['@@ -1,4 +1,5 @@', ' keep', '-old', '+changed', '+extra', ' tail'].join('\n');

    expect(collectChangedLines(patch)).toEqual({
      modified: [2],
      added: [3],
    });
  });

  it('纯新增不记入修改行', () => {
    const patch = ['@@ -1,2 +1,3 @@', ' keep', '+added', ' tail'].join('\n');

    expect(collectChangedLines(patch)).toEqual({
      modified: [],
      added: [2],
    });
  });

  it('只有删除时不产生比较文件行号', () => {
    const patch = ['@@ -1,2 +1 @@', ' keep', '-gone'].join('\n');

    expect(collectChangedLines(patch)).toEqual({
      modified: [],
      added: [],
    });
  });
});
