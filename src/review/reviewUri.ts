import * as vscode from 'vscode';

export const reviewScheme = 'reviewer';

export function reviewUri(
  root: vscode.Uri,
  side: 'base' | 'compare',
  ref: string,
  filePath: string,
): vscode.Uri {
  return vscode.Uri.from({
    scheme: reviewScheme,
    authority: side,
    path: `/${filePath}`,
    query: new URLSearchParams({ root: root.toString(), ref }).toString(),
  });
}

export function reviewFilePath(uri: vscode.Uri): string {
  return uri.path.replace(/^\/+/, '');
}
