export function chooseReviewBase(
  localMergeBase: string,
  upstreamMergeBase: string | undefined,
  upstreamDescendsFromLocal: boolean,
): string {
  if (
    upstreamMergeBase &&
    upstreamDescendsFromLocal &&
    upstreamMergeBase !== localMergeBase
  ) {
    return upstreamMergeBase;
  }
  return localMergeBase;
}
