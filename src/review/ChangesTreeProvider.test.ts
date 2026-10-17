import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
  },
  TreeItem: class {
    description?: string;
    iconPath?: unknown;
    command?: unknown;
    id?: string;
    contextValue?: string;
    resourceUri?: unknown;
    tooltip?: string;
    constructor(
      public label: string,
      public collapsibleState?: number,
    ) {}
  },
  TreeItemCollapsibleState: { None: 0, Expanded: 1 },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
  Uri: { joinPath: (root: { fsPath: string }, path: string) => ({ fsPath: `${root.fsPath}/${path}` }) },
}));

import { ChangesTreeProvider, collectDirectories, type ReviewNode } from './ChangesTreeProvider';
import type { ReviewController } from './ReviewController';

function controller(files: ReviewController['files']): ReviewController {
  return {
    base: 'master',
    compare: 'hotfix',
    loading: false,
    error: undefined,
    files,
    folder: undefined,
  } as ReviewController;
}

describe('变更树展开', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('按从外到内的顺序收集全部目录', () => {
    const provider = new ChangesTreeProvider(
      controller([
        { status: 'M', path: 'rpc/a.go' },
        { status: 'A', path: 'message/en-us/message.go' },
      ]),
    );
    provider.getChildren();
    expect(provider.directories().map((node) => (node.kind === 'dir' ? node.path : ''))).toEqual([
      'message',
      'message/en-us',
      'rpc',
    ]);
  });

  it('目录能回到父节点，根目录没有父节点', () => {
    const provider = new ChangesTreeProvider(controller([{ status: 'M', path: 'message/en-us/message.go' }]));
    provider.getChildren();
    const [outer, inner] = provider.directories();
    expect(provider.getParent(outer)).toBeUndefined();
    expect(provider.getParent(inner)).toBe(outer);
    const file = inner.kind === 'dir' ? inner.children[0] : undefined;
    expect(file && provider.getParent(file)).toBe(inner);
  });

  it('全部展开会更换目录标识，让已经折叠的目录重新打开', () => {
    const provider = new ChangesTreeProvider(controller([{ status: 'M', path: 'rpc/a.go' }]));
    provider.getChildren();
    const dir = provider.directories()[0];
    const before = provider.getTreeItem(dir).id;
    provider.expandAll();
    const after = provider.getTreeItem(dir);
    expect(after.id).not.toBe(before);
    expect(after.collapsibleState).toBe(1);
  });

  it('没有目录时展开列表为空', () => {
    const nodes: ReviewNode[] = [{ kind: 'message', text: '两个分支没有差异' }];
    expect(collectDirectories(nodes)).toEqual([]);
  });
});
