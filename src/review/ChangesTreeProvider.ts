import * as vscode from 'vscode';
import { buildFileTree, type DiffFile, type TreeNode } from '../shared/diff';
import type { ReviewController } from './ReviewController';

export type ReviewNode =
  | { kind: 'branch'; role: 'base' | 'compare'; parent?: ReviewNode }
  | { kind: 'dir'; name: string; path: string; children: ReviewNode[]; parent?: ReviewNode }
  | { kind: 'file'; file: DiffFile; parent?: ReviewNode }
  | { kind: 'message'; text: string; parent?: ReviewNode };

export class ChangesTreeProvider implements vscode.TreeDataProvider<ReviewNode> {
  private readonly emitter = new vscode.EventEmitter<ReviewNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private snapshot: ReviewNode[] = [];
  private expandGeneration = 0;

  constructor(private readonly controller: ReviewController) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  expandAll(): void {
    this.expandGeneration += 1;
    this.refresh();
  }

  getTreeItem(element: ReviewNode): vscode.TreeItem {
    if (element.kind === 'branch') {
      const selected = element.role === 'base' ? this.controller.base : this.controller.compare;
      const item = new vscode.TreeItem(
        element.role === 'base' ? '基准分支' : '比较分支',
        vscode.TreeItemCollapsibleState.None,
      );
      item.id = `branch:${element.role}`;
      item.description = selected || '未选择';
      item.iconPath = new vscode.ThemeIcon('git-branch');
      item.command = {
        command: 'redline.pickBranch',
        title: '选择分支',
        arguments: [element.role],
      };
      return item;
    }
    if (element.kind === 'dir') {
      const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `dir:${element.path}:${this.expandGeneration}`;
      item.iconPath = new vscode.ThemeIcon('folder');
      item.contextValue = 'directory';
      return item;
    }
    if (element.kind === 'message') {
      const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }
    const item = new vscode.TreeItem(element.file.path.split('/').pop() ?? element.file.path);
    item.id = `file:${element.file.path}`;
    item.description = element.file.status;
    item.tooltip = element.file.oldPath ? `${element.file.oldPath} → ${element.file.path}` : element.file.path;
    item.contextValue = `change-${element.file.status}`;
    if (this.controller.folder) {
      item.resourceUri = vscode.Uri.joinPath(this.controller.folder.uri, element.file.path);
    }
    item.command = {
      command: 'redline.openChange',
      title: '打开变更文件',
      arguments: [element.file],
    };
    return item;
  }

  getParent(element: ReviewNode): ReviewNode | undefined {
    return element.parent;
  }

  directories(): ReviewNode[] {
    return collectDirectories(this.snapshot);
  }

  getChildren(element?: ReviewNode): ReviewNode[] {
    if (element?.kind === 'dir') {
      return element.children;
    }
    if (element) {
      return [];
    }
    const nodes: ReviewNode[] = [
      { kind: 'branch', role: 'base' },
      { kind: 'branch', role: 'compare' },
    ];
    if (this.controller.loading) {
      nodes.push({ kind: 'message', text: '正在比较分支…' });
    } else if (this.controller.error) {
      nodes.push({ kind: 'message', text: this.controller.error });
    } else if (!this.controller.base || !this.controller.compare) {
      nodes.push({ kind: 'message', text: '请选择基准分支和比较分支' });
    } else if (this.controller.files.length === 0) {
      nodes.push({ kind: 'message', text: '两个分支没有差异' });
    } else {
      nodes.push(...toReviewNodes(buildFileTree(this.controller.files)));
    }
    assignParents(nodes);
    this.snapshot = nodes;
    return nodes;
  }
}

export function collectDirectories(nodes: ReviewNode[]): ReviewNode[] {
  const directories: ReviewNode[] = [];
  for (const node of nodes) {
    if (node.kind !== 'dir') {
      continue;
    }
    directories.push(node, ...collectDirectories(node.children));
  }
  return directories;
}

function assignParents(nodes: ReviewNode[], parent?: ReviewNode): void {
  for (const node of nodes) {
    node.parent = parent;
    if (node.kind === 'dir') {
      assignParents(node.children, node);
    }
  }
}

function toReviewNodes(nodes: TreeNode[]): ReviewNode[] {
  return nodes.map((node) => {
    if (node.type === 'dir') {
      return {
        kind: 'dir' as const,
        name: node.name,
        path: node.path,
        children: toReviewNodes(node.children ?? []),
      };
    }
    return {
      kind: 'file' as const,
      file: {
        status: node.status ?? 'M',
        path: node.path,
        ...(node.oldPath ? { oldPath: node.oldPath } : {}),
      },
    };
  });
}
