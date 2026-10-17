import * as vscode from 'vscode';
import { collectChangedLines, type ChangedLines } from '../editor/changeLines';
import { showsImpactMenu } from '../editor/impactMenu';
import { languageFromPath, shouldOpenWorkspaceFile, workspaceRelativePath } from '../editor/openTarget';
import { GitService, type BranchSyncStatus } from '../git/GitService';
import { pickDefaultBranches } from '../shared/branches';
import type { DiffFile } from '../shared/diff';
import type { ChangesTreeProvider } from './ChangesTreeProvider';
import { ReviewContentProvider } from './ReviewContentProvider';
import { nextDisplayMode, normalizeDisplayMode, type DisplayMode } from './displayMode';
import { reviewUri } from './reviewUri';

interface ChangeDecorations {
  added: vscode.TextEditorDecorationType;
  modified: vscode.TextEditorDecorationType;
}

export class ReviewController {
  folder: vscode.WorkspaceFolder | undefined;
  branches: string[] = [];
  current: string | null = null;
  base = '';
  compare = '';
  files: DiffFile[] = [];
  loading = false;
  error: string | undefined;
  alignedUpstream: string | undefined;
  displayMode: DisplayMode = 'single';
  private git: GitService | undefined;
  private tree: ChangesTreeProvider | undefined;
  private view: { message?: string } | undefined;
  private selected: DiffFile | undefined;
  private decorated: vscode.TextEditor | undefined;
  private readonly highlights = new Map<string, ChangedLines>();
  private readonly loadingHighlights = new Set<string>();
  private readonly sessions = new Set<string>();
  private readonly virtualSessions = new Set<string>();
  private readonly syncPrompted = new Set<string>();
  private impactListener: ((uri: vscode.Uri, lines: number[]) => void) | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: ReviewContentProvider,
    private readonly decorations: ChangeDecorations,
    private readonly statusBar: vscode.StatusBarItem,
  ) {
    this.base = context.workspaceState.get<string>('reviewer.base') ?? '';
    this.compare = context.workspaceState.get<string>('reviewer.compare') ?? '';
    this.displayMode = normalizeDisplayMode(context.workspaceState.get('redline.displayMode'));
    void this.publishDisplayMode();
  }

  watchWorkspaceChanges(listener: (uri: vscode.Uri, lines: number[]) => void): void {
    this.impactListener = listener;
  }

  attach(tree: ChangesTreeProvider, view: { message?: string }): void {
    this.tree = tree;
    this.view = view;
  }

  hasSelection(): boolean {
    return this.selected !== undefined;
  }

  async checkCurrentBranchUpdate(): Promise<BranchSyncStatus | null> {
    if (!this.git) {
      return null;
    }
    const { current } = await this.git.listBranches();
    this.current = current;
    return current ? this.git.fetchAndCheckBranch(current) : null;
  }

  async syncCurrentBranchUpdate(): Promise<void> {
    if (!this.git) {
      throw new Error('请先打开一个文件夹');
    }
    const { current } = await this.git.listBranches();
    this.current = current;
    if (!current) {
      throw new Error('当前处于分离头指针状态，无法同步');
    }
    await this.git.syncCurrentBranch(current);
    await this.reload();
  }

  isReviewEditor(uri: vscode.Uri | undefined): boolean {
    return uri !== undefined && this.sessions.has(uri.toString());
  }

  reviewEditorActive(uri: vscode.Uri | undefined): boolean {
    if (!uri) {
      return false;
    }
    const relativePath =
      uri.scheme === 'file' && this.folder ? workspaceRelativePath(this.folder.uri.fsPath, uri.fsPath) : undefined;
    return showsImpactMenu({
      scheme: uri.scheme,
      ...(relativePath ? { relativePath } : {}),
      changedPaths: this.files.map((file) => file.path),
      openedByRedline: this.sessions.has(uri.toString()),
    });
  }

  async publishReviewEditorContext(uri = vscode.window.activeTextEditor?.document.uri): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'redline.reviewEditor', this.reviewEditorActive(uri));
  }

  async useFolder(folder: vscode.WorkspaceFolder): Promise<void> {
    this.folder = folder;
    this.git = new GitService(folder.uri.fsPath);
    await this.context.workspaceState.update('reviewer.folder', folder.uri.toString());
    await this.reload();
  }

  async reload(): Promise<void> {
    if (!this.git || !this.folder) {
      this.error = '请先打开一个文件夹';
      this.files = [];
      this.refresh();
      return;
    }
    this.loading = true;
    this.error = undefined;
    this.refresh();
    try {
      await this.git.ensureRepo();
      const listed = await this.git.listBranches();
      this.branches = listed.branches;
      this.current = listed.current;
      const defaults = pickDefaultBranches(listed.branches, listed.current);
      if (!this.branches.includes(this.base)) {
        this.base = defaults.base;
      }
      if (!this.branches.includes(this.compare)) {
        this.compare = defaults.compare;
      }
      await this.context.workspaceState.update('reviewer.base', this.base);
      await this.context.workspaceState.update('reviewer.compare', this.compare);
      if (this.base && this.compare) {
        const synced = await this.promptSyncIfNeeded(this.base);
        if (!synced) {
          await this.promptSyncIfNeeded(this.compare);
        }
        const review = await this.git.reviewBase(this.base, this.compare);
        this.alignedUpstream = review.upstream;
        this.files = await this.git.diffNames(this.base, this.compare);
      } else {
        this.alignedUpstream = undefined;
        this.files = [];
      }
    } catch (error) {
      this.files = [];
      this.alignedUpstream = undefined;
      this.error = error instanceof Error ? error.message : '无法读取分支差异';
    } finally {
      this.loading = false;
      this.refresh();
    }
  }

  async pickBranch(role: 'base' | 'compare'): Promise<void> {
    if (this.branches.length === 0) {
      void vscode.window.showInformationMessage('没有本地分支');
      return;
    }
    const picked = await vscode.window.showQuickPick(this.branches, {
      placeHolder: role === 'base' ? '选择基准分支' : '选择比较分支',
    });
    if (!picked) {
      return;
    }
    if (role === 'base') {
      this.base = picked;
    } else {
      this.compare = picked;
    }
    await this.context.workspaceState.update('reviewer.base', this.base);
    await this.context.workspaceState.update('reviewer.compare', this.compare);
    this.syncPrompted.clear();
    await this.reload();
  }

  private async promptSyncIfNeeded(branch: string): Promise<boolean> {
    if (!this.git || this.syncPrompted.has(branch)) {
      return false;
    }
    try {
      const status = await this.git.branchSyncStatus(branch);
      if (!status || status.inSync) {
        return false;
      }
      this.syncPrompted.add(branch);
      const detail =
        status.behind > 0 && status.ahead === 0
          ? `本地落后远程 ${status.behind} 个提交`
          : status.ahead > 0 && status.behind === 0
            ? `本地领先远程 ${status.ahead} 个提交`
            : `本地与远程分叉（领先 ${status.ahead}，落后 ${status.behind}）`;
      const choice = await vscode.window.showWarningMessage(
        `本地分支 ${branch} 与远端 ${status.upstream} 不一致（${detail}）。是否将远端代码合并到本地 ${branch}？`,
        '合并到本地',
        '暂不合并，继续比对',
      );
      if (choice !== '合并到本地') {
        return false;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `正在将远端 ${status.upstream} 合并到本地 ${branch}` },
        () => this.git!.syncBranch(branch),
      );
      void vscode.window.showInformationMessage(`已将远端 ${status.upstream} 同步到本地 ${branch}`);
      this.syncPrompted.delete(branch);
      await this.reload();
      return true;
    } catch (error) {
      void vscode.window.showErrorMessage(
        `将远端合并到本地 ${branch} 失败：${error instanceof Error ? error.message : '未知错误'}，将使用远程分叉点比对`,
      );
      return false;
    }
  }

  async openChange(file: DiffFile): Promise<void> {
    if (!this.git || !this.folder || !this.base || !this.compare) {
      void vscode.window.showInformationMessage('请先选择基准分支和比较分支');
      return;
    }
    try {
      const diff = await this.git.diffFile(this.base, this.compare, file);
      if (diff.binary) {
        void vscode.window.showInformationMessage('二进制文件，无法预览差异');
        return;
      }
      if (diff.submodule) {
        void vscode.window.showInformationMessage('子模块变更，首版不展开');
        return;
      }
      this.selected = file;
      await vscode.commands.executeCommand('setContext', 'redline.hasSelection', true);
      const lines = collectChangedLines(diff.patch);
      const diskUri = vscode.Uri.joinPath(this.folder.uri, file.path);
      const existsOnDisk = await pathExists(diskUri);
      const useWorkspace = shouldOpenWorkspaceFile({
        compareBranch: this.compare,
        currentBranch: this.current,
        existsOnDisk,
        status: file.status,
      });
      if (useWorkspace) {
        this.impactListener?.(diskUri, [...lines.added, ...lines.modified]);
      }
      if (this.displayMode === 'split') {
        await this.openSplit(file);
        return;
      }
      const editor = useWorkspace
        ? await this.openWorkspaceFile(diskUri)
        : await this.openVirtualFile(file);
      this.sessions.add(editor.document.uri.toString());
      await this.publishReviewEditorContext(editor.document.uri);
      this.decorate(editor, lines);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : '无法打开变更文件');
    }
  }

  async toggleSplit(): Promise<void> {
    if (!this.git || !this.folder || !this.base || !this.compare) {
      void vscode.window.showInformationMessage('请先选择基准分支和比较分支');
      return;
    }
    this.displayMode = nextDisplayMode(this.displayMode);
    await this.context.workspaceState.update('redline.displayMode', this.displayMode);
    await this.publishDisplayMode();
    if (this.selected) {
      await this.openChange(this.selected);
    }
  }

  private async openSplit(file: DiffFile): Promise<void> {
    if (!this.git || !this.folder) {
      return;
    }
    this.clearDecorations();
    try {
      const basePath = file.oldPath ?? file.path;
      const review = await this.git.reviewBase(this.base, this.compare);
      const baseShown = await this.git.showFile(review.revision, basePath);
      const baseUri = reviewUri(this.folder.uri, 'base', review.revision, basePath);
      this.provider.set(baseUri, baseShown.content);
      await this.applyLanguage(baseUri, basePath);

      const diskUri = vscode.Uri.joinPath(this.folder.uri, file.path);
      const useWorkspace = shouldOpenWorkspaceFile({
        compareBranch: this.compare,
        currentBranch: this.current,
        existsOnDisk: await pathExists(diskUri),
        status: file.status,
      });
      let compareUri = diskUri;
      if (useWorkspace) {
        this.statusBar.hide();
      }
      if (!useWorkspace) {
        const shown = await this.git.showFile(this.compare, file.path);
        compareUri = reviewUri(this.folder.uri, 'compare', this.compare, file.path);
        this.provider.set(compareUri, shown.content);
        await this.applyLanguage(compareUri, file.path);
        this.virtualSessions.add(compareUri.toString());
      }
      this.sessions.add(baseUri.toString());
      this.sessions.add(compareUri.toString());
      await vscode.commands.executeCommand(
        'vscode.diff',
        baseUri,
        compareUri,
        `${file.path}（${this.base} ↔ ${this.compare}）`,
        { preview: true },
      );
      await this.publishReviewEditorContext();
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : '无法打开双栏比对');
    }
  }

  private async publishDisplayMode(): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'redline.splitMode', this.displayMode === 'split');
  }

  private async openWorkspaceFile(uri: vscode.Uri): Promise<vscode.TextEditor> {
    this.statusBar.hide();
    this.virtualSessions.delete(uri.toString());
    return vscode.window.showTextDocument(uri, { preview: true });
  }

  private async openVirtualFile(file: DiffFile): Promise<vscode.TextEditor> {
    if (!this.git || !this.folder) {
      throw new Error('请先打开一个文件夹');
    }
    const shown = await this.git.showFile(this.compare, file.path);
    if (shown.binary) {
      throw new Error('二进制文件，无法预览差异');
    }
    if (shown.missing || file.status === 'D') {
      void vscode.window.showInformationMessage('比较分支中没有这个文件，可切换双栏查看删除内容');
    }
    const uri = reviewUri(this.folder.uri, 'compare', this.compare, file.path);
    this.provider.set(uri, shown.content);
    await this.applyLanguage(uri, file.path);
    this.virtualSessions.add(uri.toString());
    this.statusBar.show();
    return vscode.window.showTextDocument(uri, { preview: true });
  }

  private async applyLanguage(uri: vscode.Uri, filePath: string): Promise<void> {
    const language = languageFromPath(filePath);
    if (!language) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    try {
      await vscode.languages.setTextDocumentLanguage(document, language);
    } catch {
      // 未安装对应语言时仍然展示完整文件。
    }
  }

  restoreHighlights(): void {
    if (this.displayMode === 'split') {
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.viewColumn === undefined) {
        continue;
      }
      const key = editor.document.uri.toString();
      const lines = this.highlights.get(key);
      if (lines) {
        this.applyHighlight(editor, lines);
        continue;
      }
      if (editor.document.uri.scheme === 'file') {
        void this.ensureHighlight(editor.document.uri);
      }
    }
  }

  private async ensureHighlight(uri: vscode.Uri): Promise<void> {
    const key = uri.toString();
    if (this.highlights.has(key) || this.loadingHighlights.has(key) || !this.git || !this.folder) {
      return;
    }
    const relativePath = workspaceRelativePath(this.folder.uri.fsPath, uri.fsPath);
    const file = relativePath ? this.files.find((item) => item.path === relativePath) : undefined;
    if (!file || !this.base || !this.compare) {
      return;
    }
    if (
      !shouldOpenWorkspaceFile({
        compareBranch: this.compare,
        currentBranch: this.current,
        existsOnDisk: true,
        status: file.status,
      })
    ) {
      return;
    }
    this.loadingHighlights.add(key);
    try {
      const diff = await this.git.diffFile(this.base, this.compare, file);
      const lines = diff.binary || diff.submodule ? { added: [], modified: [] } : collectChangedLines(diff.patch);
      this.highlights.set(key, lines);
      this.impactListener?.(uri, [...lines.added, ...lines.modified]);
      this.restoreHighlights();
    } catch {
      // 跳转途中读不到差异时保持原文件，不打断跳转。
    } finally {
      this.loadingHighlights.delete(key);
    }
  }

  private clearDecorations(): void {
    this.decorated?.setDecorations(this.decorations.added, []);
    this.decorated?.setDecorations(this.decorations.modified, []);
    this.decorated = undefined;
  }

  private applyHighlight(editor: vscode.TextEditor, lines: ChangedLines): void {
    editor.setDecorations(this.decorations.added, lineRanges(editor.document, lines.added));
    editor.setDecorations(this.decorations.modified, lineRanges(editor.document, lines.modified));
  }

  private decorate(editor: vscode.TextEditor, lines: ChangedLines): void {
    this.highlights.set(editor.document.uri.toString(), lines);
    this.applyHighlight(editor, lines);
    this.decorated = editor;
    const first = lines.modified[0] ?? lines.added[0];
    if (!first || first > editor.document.lineCount) {
      return;
    }
    const position = new vscode.Position(first - 1, 0);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(position, position);
  }

  private refresh(): void {
    void this.publishReviewEditorContext();
    this.tree?.refresh();
    if (this.view) {
      const baseLabel = this.alignedUpstream ? `${this.base}（对齐 ${this.alignedUpstream}）` : this.base;
      this.view.message = this.error ?? (this.base && this.compare ? `${baseLabel} → ${this.compare}` : '');
    }
  }
}

function lineRanges(document: vscode.TextDocument, lines: number[]): vscode.Range[] {
  return lines
    .filter((line) => line >= 1 && line <= document.lineCount)
    .map((line) => document.lineAt(line - 1).range);
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
