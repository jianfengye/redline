import * as vscode from 'vscode';
import { impactHeadline, type ImpactSummary, type ImpactTreeNode } from './walkImpact';

export class ImpactPanel implements vscode.TreeDataProvider<ImpactTreeNode> {
  private readonly emitter = new vscode.EventEmitter<ImpactTreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private summary: ImpactSummary | undefined;
  private note = '在改动文件里用鼠标点某一行';
  private view: { title?: string; description?: string; message?: string | undefined } | undefined;

  attach(view: { title?: string; description?: string; message?: string | undefined }): void {
    this.view = view;
    this.publish();
  }

  show(summary: ImpactSummary): void {
    this.summary = summary;
    this.note = summary.droppedTests.length ? `已排除测试：${summary.droppedTests.join('、')}` : '';
    this.publish(impactHeadline(summary));
    this.emitter.fire(undefined);
  }

  showMessage(message: string): void {
    this.summary = undefined;
    this.note = message;
    this.publish(message);
    this.emitter.fire(undefined);
  }

  getTreeItem(node: ImpactTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.name,
      node.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    item.description = `${fileName(node.path)}:${node.line}`;
    item.iconPath = new vscode.ThemeIcon('symbol-method');
    item.command = {
      command: 'redline.revealImpact',
      title: '打开函数',
      arguments: [node.uri, node.line],
    };
    return item;
  }

  getChildren(element?: ImpactTreeNode): ImpactTreeNode[] {
    if (!this.summary?.tree) {
      return [];
    }
    return element ? element.children : [this.summary.tree];
  }

  private publish(description = ''): void {
    if (!this.view) {
      return;
    }
    this.view.title = description ? `影响面  ${description}` : '影响面';
    this.view.description = undefined;
    this.view.message = this.note || undefined;
  }
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}
