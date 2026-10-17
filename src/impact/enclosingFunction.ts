export interface SymbolSpan {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  selectionLine: number;
  selectionCharacter: number;
  children?: SymbolSpan[];
}

const functionKinds = new Set(['function', 'method', 'constructor']);

export function enclosingFunction(symbols: SymbolSpan[], line: number): SymbolSpan | undefined {
  const matches: SymbolSpan[] = [];
  collect(symbols, line, matches);
  return matches.sort((left, right) => left.endLine - left.startLine - (right.endLine - right.startLine))[0];
}

function collect(symbols: SymbolSpan[], line: number, matches: SymbolSpan[]): void {
  for (const symbol of symbols) {
    if (symbol.startLine <= line && line <= symbol.endLine) {
      if (functionKinds.has(symbol.kind)) {
        matches.push(symbol);
      }
      collect(symbol.children ?? [], line, matches);
    }
  }
}
