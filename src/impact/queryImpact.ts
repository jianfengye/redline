import * as vscode from 'vscode';
import { enclosingFunction, type SymbolSpan } from './enclosingFunction';
import { walkImpact, type CallNode, type ImpactSummary } from './walkImpact';

const functionKinds = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
]);

export async function queryImpact(uri: vscode.Uri, line: number): Promise<ImpactSummary> {
  const prepared = await vscode.commands.executeCommand<vscode.CallHierarchyItem | vscode.CallHierarchyItem[]>(
    'vscode.prepareCallHierarchy',
    uri,
    await functionNamePosition(uri, line),
  );
  const items = Array.isArray(prepared) ? prepared : prepared ? [prepared] : [];
  const item = pickFunction(items, line);
  if (!item) {
    throw new Error('这一行没有对应的函数，或语言服务还没准备好');
  }
  const itemsByKey = new Map<string, vscode.CallHierarchyItem>();
  const target = remember(item, itemsByKey);
  return walkImpact(target, async (node) => {
    const source = itemsByKey.get(node.key);
    if (!source) {
      return [];
    }
    const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
      'vscode.provideIncomingCalls',
      source,
    );
    return (calls ?? []).map((call) => remember(call.from, itemsByKey));
  });
}

async function functionNamePosition(uri: vscode.Uri, line: number): Promise<vscode.Position> {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri);
  const found = enclosingFunction((symbols ?? []).map(toSpan), line);
  if (!found) {
    throw new Error('这一行不在函数里');
  }
  return new vscode.Position(found.selectionLine - 1, found.selectionCharacter);
}

function toSpan(symbol: vscode.DocumentSymbol): SymbolSpan {
  return {
    name: symbol.name,
    kind: kindName(symbol.kind),
    startLine: symbol.range.start.line + 1,
    endLine: Math.max(symbol.range.start.line + 1, symbol.range.end.line + (symbol.range.end.character === 0 ? 0 : 1)),
    selectionLine: symbol.selectionRange.start.line + 1,
    selectionCharacter: symbol.selectionRange.start.character,
    children: symbol.children?.map(toSpan),
  };
}

function kindName(kind: vscode.SymbolKind): string {
  if (kind === vscode.SymbolKind.Function) {
    return 'function';
  }
  if (kind === vscode.SymbolKind.Method) {
    return 'method';
  }
  if (kind === vscode.SymbolKind.Constructor) {
    return 'constructor';
  }
  return 'other';
}

function remember(item: vscode.CallHierarchyItem, itemsByKey: Map<string, vscode.CallHierarchyItem>): CallNode {
  const node = toNode(item);
  itemsByKey.set(node.key, item);
  return node;
}

function toNode(item: vscode.CallHierarchyItem): CallNode {
  const path = item.uri.scheme === 'file' ? item.uri.fsPath : item.uri.path;
  return {
    key: `${item.uri.toString()}#${item.selectionRange.start.line}:${item.name}`,
    name: item.name,
    path,
    uri: item.uri.toString(),
    line: item.selectionRange.start.line + 1,
    startLine: item.range.start.line + 1,
    endLine: Math.max(item.range.start.line + 1, item.range.end.line + (item.range.end.character === 0 ? 0 : 1)),
  };
}

function pickFunction(items: vscode.CallHierarchyItem[], line: number): vscode.CallHierarchyItem | undefined {
  const containing = items.filter((item) => containsLine(item, line));
  const pool = containing.length > 0 ? containing : items;
  const functions = pool.filter((item) => functionKinds.has(item.kind));
  const ranked = functions.length > 0 ? functions : pool;
  return [...ranked].sort((left, right) => span(left) - span(right))[0];
}

function containsLine(item: vscode.CallHierarchyItem, line: number): boolean {
  return item.range.start.line + 1 <= line && line <= item.range.end.line + 1;
}

function span(item: vscode.CallHierarchyItem): number {
  return item.range.end.line - item.range.start.line;
}
