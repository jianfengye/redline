import * as vscode from 'vscode';
import { ImpactStore } from './impact/ImpactStore';
import { ImpactPanel } from './impact/ImpactView';
import { queryImpact } from './impact/queryImpact';
import { shouldNotifyRemoteUpdate } from './git/remoteUpdate';
import type { DiffFile } from './shared/diff';
import { ChangesTreeProvider, type ReviewNode } from './review/ChangesTreeProvider';
import { ReviewContentProvider } from './review/ReviewContentProvider';
import { ReviewController } from './review/ReviewController';
import { reviewScheme } from './review/reviewUri';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ReviewContentProvider();
  const decorations = {
    added: vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    }),
    modified: vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.modifiedForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    }),
  };
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  statusBar.name = 'Redline';
  statusBar.text = '函数跳转仅在当前工作区文件可用';

  const controller = new ReviewController(context, provider, decorations, statusBar);
  const tree = new ChangesTreeProvider(controller);
  const view = vscode.window.createTreeView('redline.changes', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  controller.attach(tree, view);
  const impactStore = new ImpactStore();
  const impactPanel = new ImpactPanel();
  const impactView = vscode.window.createTreeView('redline.impact', { treeDataProvider: impactPanel });
  impactPanel.attach(impactView);
  const ignoredRemoteBranches = new Set<string>();
  let remotePollRunning = false;
  controller.watchWorkspaceChanges((uri, lines) => {
    impactStore.track(uri.toString(), lines);
  });

  const folders = vscode.workspace.workspaceFolders ?? [];
  void vscode.commands.executeCommand('setContext', 'redline.multiRoot', folders.length > 1);
  const stored = context.workspaceState.get<string>('reviewer.folder');
  const initial = folders.find((folder) => folder.uri.toString() === stored) ?? folders[0];
  if (initial) {
    void controller.useFolder(initial);
  } else {
    void controller.reload();
  }

  context.subscriptions.push(
    providerRegistration(provider),
    decorations.added,
    decorations.modified,
    statusBar,
    view,
    impactView,
    intervalDisposable(() => pollRemoteUpdate(controller, ignoredRemoteBranches, () => remotePollRunning, (value) => {
      remotePollRunning = value;
    })),
    vscode.window.onDidChangeVisibleTextEditors(() => controller.restoreHighlights()),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      controller.restoreHighlights();
      void controller.publishReviewEditorContext(editor?.document.uri);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse) {
        return;
      }
      const uri = event.textEditor.document.uri;
      if (uri.scheme !== 'file' || impactStore.lines(uri.toString()).length === 0) {
        return;
      }
      const line = event.selections[0]?.active.line;
      if (line === undefined) {
        return;
      }
      void showImpact(impactStore, impactPanel, uri, line + 1);
    }),
    vscode.commands.registerCommand('redline.open', async () => {
      await vscode.commands.executeCommand('redline.changes.focus');
    }),
    vscode.commands.registerCommand('redline.refresh', () => controller.reload()),
    vscode.commands.registerCommand('redline.expandAll', () => tree.expandAll()),
    vscode.commands.registerCommand('redline.pickBranch', (role: 'base' | 'compare') => controller.pickBranch(role)),
    vscode.commands.registerCommand('redline.openChange', (file: DiffFile) => controller.openChange(file)),
    vscode.commands.registerCommand('redline.toggleSplit', () => controller.toggleSplit()),
    vscode.commands.registerCommand('redline.restoreSingle', () => controller.toggleSplit()),
    vscode.commands.registerCommand('redline.pickFolder', () => pickFolder(controller)),
    vscode.commands.registerCommand('redline.showImpact', (uri: vscode.Uri, line: number) =>
      showImpact(impactStore, impactPanel, uri, line),
    ),
    vscode.commands.registerCommand('redline.showImpactAtCursor', () =>
      showImpactAtCursor(controller, impactStore, impactPanel),
    ),
    vscode.commands.registerCommand('redline.revealImpact', (uriText: string, line: number) => revealImpact(uriText, line)),
    vscode.commands.registerCommand('redline.copyRelativePath', (node: ReviewNode) => copyChangePath(controller, node, false)),
    vscode.commands.registerCommand('redline.copyAbsolutePath', (node: ReviewNode) => copyChangePath(controller, node, true)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const next = vscode.workspace.workspaceFolders ?? [];
      void vscode.commands.executeCommand('setContext', 'redline.multiRoot', next.length > 1);
    }),
  );
}

export function deactivate(): void {}

function providerRegistration(provider: ReviewContentProvider): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(reviewScheme, provider);
}

let impactRequest = 0;
const remotePollIntervalMs = 60_000;

async function showImpact(store: ImpactStore, panel: ImpactPanel, uri: vscode.Uri, line: number): Promise<void> {
  const request = ++impactRequest;
  const cached = store.summaryForLine(uri.toString(), line);
  if (cached) {
    if (request === impactRequest) {
      panel.show(cached);
    }
    return;
  }
  try {
    const summary = await queryImpact(uri, line);
    if (request !== impactRequest) {
      return;
    }
    store.remember(uri.toString(), store.lines(uri.toString()), summary);
    panel.show(summary);
  } catch (error) {
    if (request !== impactRequest) {
      return;
    }
    panel.showMessage(explainImpactError(error));
  }
}

async function showImpactAtCursor(
  controller: ReviewController,
  store: ImpactStore,
  panel: ImpactPanel,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const uri = editor?.document.uri;
  if (!editor || !uri || !controller.reviewEditorActive(uri)) {
    return;
  }
  await vscode.commands.executeCommand('redline.impact.focus');
  if (uri.scheme !== 'file') {
    panel.showMessage('影响面只能在当前工作区的真实文件上计算');
    return;
  }
  await showImpact(store, panel, uri, editor.selection.active.line + 1);
}

async function revealImpact(uriText: string, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriText));
  const editor = await vscode.window.showTextDocument(document, { preview: true });
  const position = new vscode.Position(Math.max(0, line - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

async function pollRemoteUpdate(
  controller: ReviewController,
  ignored: Set<string>,
  isRunning: () => boolean,
  setRunning: (value: boolean) => void,
): Promise<void> {
  if (isRunning()) {
    return;
  }
  setRunning(true);
  try {
    const status = await controller.checkCurrentBranchUpdate();
    if (!status || ignored.has(status.branch) || !shouldNotifyRemoteUpdate(status, false)) {
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      `远端 ${status.upstream} 比本地 ${status.branch} 新 ${status.behind} 个提交，是否同步？`,
      '确认同步',
      '忽略',
    );
    if (choice === '忽略') {
      ignored.add(status.branch);
      return;
    }
    if (choice === '确认同步') {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `正在同步 ${status.upstream}` },
        () => controller.syncCurrentBranchUpdate(),
      );
      void vscode.window.showInformationMessage(`已将远端 ${status.upstream} 同步到本地 ${status.branch}`);
    }
  } catch (error) {
    void vscode.window.showWarningMessage(
      `检查远端分支更新失败：${error instanceof Error ? error.message : '未知错误'}`,
    );
  } finally {
    setRunning(false);
  }
}

function intervalDisposable(callback: () => void): vscode.Disposable {
  const timer = setInterval(callback, remotePollIntervalMs);
  return { dispose: () => clearInterval(timer) };
}

function explainImpactError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.toLowerCase().includes('identifier not found')) {
    return '语言服务没能从这一行定位到函数名。点到函数内部再试。';
  }
  return message || '无法计算影响面';
}

async function copyChangePath(controller: ReviewController, node: ReviewNode | undefined, absolute: boolean): Promise<void> {
  if (!node || node.kind !== 'file') {
    return;
  }
  const folder = controller.folder;
  if (absolute && !folder) {
    void vscode.window.showInformationMessage('请先打开一个文件夹');
    return;
  }
  const text = absolute && folder ? vscode.Uri.joinPath(folder.uri, node.file.path).fsPath : node.file.path;
  await vscode.env.clipboard.writeText(text);
}

async function pickFolder(controller: ReviewController): Promise<void> {
  const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: '选择要比较分支的仓库' });
  if (folder) {
    await controller.useFolder(folder);
  }
}
