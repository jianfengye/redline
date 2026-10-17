import { isTestSymbol } from './testSymbol';

export interface CallNode {
  key: string;
  name: string;
  path: string;
  uri: string;
  line: number;
  startLine: number;
  endLine: number;
}

export interface ImpactChainNode {
  key: string;
  name: string;
  path: string;
  uri: string;
  line: number;
  target: boolean;
  shared: boolean;
}

export interface ImpactTreeNode {
  name: string;
  path: string;
  uri: string;
  line: number;
  children: ImpactTreeNode[];
}

export interface ImpactPath {
  root: string;
  chain: ImpactChainNode[];
}

export interface ImpactSummary {
  key: string;
  functionName: string;
  uri: string;
  line: number;
  startLine: number;
  endLine: number;
  entries: number;
  depth: number;
  droppedTests: string[];
  paths: ImpactPath[];
  tree?: ImpactTreeNode;
}

const maxDepth = 12;
const maxPaths = 30;

export async function walkImpact(
  target: CallNode,
  incoming: (node: CallNode) => Promise<CallNode[]>,
): Promise<ImpactSummary> {
  const dropped = new Set<string>();
  const rawPaths: CallNode[][] = [];

  async function visit(node: CallNode, stack: CallNode[]): Promise<void> {
    if (stack.length >= maxDepth || rawPaths.length >= maxPaths) {
      return;
    }
    if (stack.some((item) => item.key === node.key)) {
      return;
    }
    const next = [...stack, node];
    const callers = await incoming(node);
    const business: CallNode[] = [];
    for (const caller of callers) {
      if (isTestSymbol(caller.name, caller.path)) {
        dropped.add(caller.name);
        continue;
      }
      business.push(caller);
    }
    if (business.length === 0) {
      if (node.key === target.key && callers.length > 0) {
        return;
      }
      rawPaths.push(next);
      return;
    }
    const expandable = business.filter((caller) => !next.some((item) => item.key === caller.key));
    if (expandable.length === 0) {
      rawPaths.push(next);
      return;
    }
    for (const caller of expandable) {
      await visit(caller, next);
    }
  }

  await visit(target, []);
  const paths = rawPaths.map((path) => [...path].reverse());
  const seen = new Map<string, number>();
  for (const path of paths) {
    for (const node of path) {
      seen.set(node.key, (seen.get(node.key) ?? 0) + 1);
    }
  }
  const roots = new Set(paths.map((path) => path[0]?.key).filter((key): key is string => Boolean(key)));
  const impactPaths = paths.map((path) => ({
    root: path[0]?.name ?? target.name,
    chain: path.map((node) => ({
      key: node.key,
      name: node.name,
      path: node.path,
      uri: node.uri,
      line: node.line,
      target: node.key === target.key,
      shared: (seen.get(node.key) ?? 0) > 1 && node.key !== target.key,
    })),
  }));
  const tree = callerTree(impactPaths);
  return {
    key: target.key,
    functionName: target.name,
    uri: target.uri,
    line: target.line,
    startLine: target.startLine,
    endLine: target.endLine,
    entries: paths.length === 0 ? 0 : roots.size,
    depth: paths.reduce((max, path) => Math.max(max, path.length), 0),
    droppedTests: [...dropped],
    paths: impactPaths,
    ...(tree ? { tree } : {}),
  };
}

export function callerTree(paths: ImpactPath[]): ImpactTreeNode | undefined {
  let root: MutableTree | undefined;
  for (const path of paths) {
    const chain = [...path.chain].reverse();
    const first = chain[0];
    if (!first) {
      continue;
    }
    root ??= mutable(first);
    let parent = root;
    for (const item of chain.slice(1)) {
      let child = parent.children.get(item.key);
      if (!child) {
        child = mutable(item);
        parent.children.set(item.key, child);
      }
      parent = child;
    }
  }
  return root ? freeze(root) : undefined;
}

interface MutableTree {
  name: string;
  path: string;
  uri: string;
  line: number;
  children: Map<string, MutableTree>;
}

function mutable(node: ImpactChainNode): MutableTree {
  return { name: node.name, path: node.path, uri: node.uri, line: node.line, children: new Map() };
}

function freeze(node: MutableTree): ImpactTreeNode {
  return {
    name: node.name,
    path: node.path,
    uri: node.uri,
    line: node.line,
    children: [...node.children.values()].map(freeze),
  };
}

export function impactLabel(summary: ImpactSummary): string {
  return summary.entries === 0 ? '已是最顶层' : `↑${summary.entries}·${summary.depth}`;
}

export function impactHeadline(summary: ImpactSummary): string {
  if (summary.entries === 0) {
    return '已是最顶层';
  }
  return `入口函数 ${summary.entries}，最深层次 ${summary.depth}`;
}
