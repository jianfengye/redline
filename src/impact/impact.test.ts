import { describe, expect, it } from 'vitest';
import { ImpactStore } from './ImpactStore';
import { isTestSymbol } from './testSymbol';
import { impactHeadline, walkImpact, type CallNode, type ImpactTreeNode } from './walkImpact';

function names(tree: ImpactTreeNode | undefined): unknown {
  if (!tree) {
    return undefined;
  }
  return { name: tree.name, children: tree.children.map((child) => names(child)) };
}

function node(name: string, path: string, line: number, end = line + 8): CallNode {
  return {
    key: `${path}#${line}:${name}`,
    name,
    path,
    uri: `file://${path}`,
    line,
    startLine: line,
    endLine: end,
  };
}

describe('测试符号', () => {
  it('识别 Go 测试函数和测试文件', () => {
    expect(isTestSymbol('TestSpacePay', 'rpc/a.go')).toBe(true);
    expect(isTestSymbol('BenchmarkPay', 'rpc/a.go')).toBe(true);
    expect(isTestSymbol('helper', 'rpc/a_test.go')).toBe(true);
    expect(isTestSymbol('SpacePayAbtest', 'rpc/a.go')).toBe(false);
    expect(isTestSymbol('ExampleText', 'rpc/a.go')).toBe(false);
  });
});

describe('影响面追溯', () => {
  const target = node('SpacePayAbtest', 'rpc/a.go', 38, 46);
  const auth = node('CheckRoleAuth', 'rpc/auth.go', 88);
  const http = node('HandleUserSpace', 'rpc/http.go', 10);
  const rpc = node('HandleBusiness', 'rpc/biz.go', 20);
  const cron = node('CronSpace', 'rpc/cron.go', 4);
  const test = node('TestSpace', 'rpc/a_test.go', 1);
  const callers = new Map<string, CallNode[]>([
    [target.key, [http, auth, test]],
    [auth.key, [rpc, cron]],
    [http.key, []],
    [rpc.key, []],
    [cron.key, []],
  ]);

  it('统计业务入口和最长调用链，并丢掉测试', async () => {
    const impact = await walkImpact(target, async (item) => callers.get(item.key) ?? []);
    expect(impact.entries).toBe(3);
    expect(impact.depth).toBe(3);
    expect(impact.droppedTests).toEqual(['TestSpace']);
    expect(impact.paths.map((path) => path.chain.map((item) => item.name))).toEqual([
      ['HandleUserSpace', 'SpacePayAbtest'],
      ['HandleBusiness', 'CheckRoleAuth', 'SpacePayAbtest'],
      ['CronSpace', 'CheckRoleAuth', 'SpacePayAbtest'],
    ]);
    const shared = impact.paths.flatMap((path) => path.chain).find((item) => item.name === 'CheckRoleAuth');
    expect(shared?.shared).toBe(true);
    expect(names(impact.tree)).toEqual({
      name: 'SpacePayAbtest',
      children: [
        { name: 'HandleUserSpace', children: [] },
        {
          name: 'CheckRoleAuth',
          children: [
            { name: 'HandleBusiness', children: [] },
            { name: 'CronSpace', children: [] },
          ],
        },
      ],
    });
  });

  it('只有测试调用时没有业务入口', async () => {
    const lone = node('GetActivityBanner', 'rpc/banner.go', 33);
    const impact = await walkImpact(lone, async () => [node('TestBanner', 'rpc/banner_test.go', 8)]);
    expect(impact.entries).toBe(0);
    expect(impact.depth).toBe(0);
    expect(impact.paths).toEqual([]);
    expect(impactHeadline(impact)).toBe('已是最顶层');
  });

  it('没有调用者时，函数自己就是一层入口', async () => {
    const handler = node('HandleUserSpace', 'rpc/http.go', 10, 30);
    const impact = await walkImpact(handler, async () => []);
    expect(impact.entries).toBe(1);
    expect(impact.depth).toBe(1);
    expect(impactHeadline(impact)).toBe('入口函数 1，最深层次 1');
  });

  it('调用环不会一直往上追', async () => {
    const left = node('Left', 'rpc/a.go', 1);
    const right = node('Right', 'rpc/a.go', 20);
    const impact = await walkImpact(left, async (item) => (item.key === left.key ? [right] : [left]));
    expect(impact.entries).toBe(1);
    expect(impact.depth).toBe(2);
  });
});

describe('函数级缓存', () => {
  it('同一函数里的多行改动共用一次结果', async () => {
    const summary = await walkImpact(node('SpacePayAbtest', 'rpc/a.go', 38, 46), async () => []);
    const store = new ImpactStore();
    const uri = 'file:///repo/rpc/a.go';
    store.track(uri, [41, 42, 43, 71]);
    store.remember(uri, [41, 42, 43, 71], summary);
    expect(store.labelForLine(uri, 41)).toBe('↑1·1');
    expect(store.labelForLine(uri, 43)).toBe(store.labelForLine(uri, 41));
    expect(store.summaryForLine(uri, 42)?.key).toBe(summary.key);
    expect(store.labelForLine(uri, 71)).toBeUndefined();
    expect(store.summaryForLine(uri, 40)?.key).toBe(summary.key);
  });
});
