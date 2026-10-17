export function shouldNotifyRemoteUpdate(
  status: { behind: number; ahead: number } | null,
  ignored: boolean,
): boolean {
  return !ignored && status !== null && status.behind > 0;
}
