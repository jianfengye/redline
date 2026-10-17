import { describe, expect, it } from 'vitest';
import { enclosingFunction, type SymbolSpan } from './enclosingFunction';

const symbols: SymbolSpan[] = [
  {
    name: 'transcriptionRelShardProd',
    kind: 'constant',
    startLine: 33,
    endLine: 36,
    selectionLine: 34,
    selectionCharacter: 2,
  },
  {
    name: 'BuildTranscriptionRecordingRelTableName',
    kind: 'function',
    startLine: 39,
    endLine: 46,
    selectionLine: 39,
    selectionCharacter: 5,
    children: [
      {
        name: 'inner',
        kind: 'function',
        startLine: 41,
        endLine: 43,
        selectionLine: 41,
        selectionCharacter: 4,
      },
    ],
  },
];

describe('定位所在函数', () => {
  it('点在函数体里时，用函数名的位置而不是行首', () => {
    expect(enclosingFunction(symbols, 44)).toMatchObject({
      name: 'BuildTranscriptionRecordingRelTableName',
      selectionLine: 39,
      selectionCharacter: 5,
    });
  });

  it('嵌套函数取范围更小的那个', () => {
    expect(enclosingFunction(symbols, 42)?.name).toBe('inner');
  });

  it('常量行不是函数', () => {
    expect(enclosingFunction(symbols, 34)).toBeUndefined();
  });
});
