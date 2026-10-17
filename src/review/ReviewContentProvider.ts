import * as vscode from 'vscode';
import { GitService } from '../git/GitService';
import { reviewFilePath } from './reviewUri';

export class ReviewContentProvider implements vscode.TextDocumentContentProvider {
  private readonly cache = new Map<string, string>();

  set(uri: vscode.Uri, content: string): void {
    this.cache.set(uri.toString(), content);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const cached = this.cache.get(uri.toString());
    if (cached !== undefined) {
      return cached;
    }
    const params = new URLSearchParams(uri.query);
    const root = params.get('root');
    const ref = params.get('ref');
    const filePath = reviewFilePath(uri);
    if (!root || !ref || !filePath) {
      return '';
    }
    try {
      const shown = await new GitService(vscode.Uri.parse(root).fsPath).showFile(ref, filePath);
      return shown.content;
    } catch {
      return '';
    }
  }
}
