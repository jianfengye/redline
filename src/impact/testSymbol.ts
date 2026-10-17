export function isTestSymbol(name: string, path: string): boolean {
  const file = path.split(/[/\\]/).pop() ?? path;
  if (/(?:_test\.go|_test\.ts|\.test\.ts|\.spec\.ts)$/.test(file)) {
    return true;
  }
  return /^(?:Test|Benchmark|Fuzz)(?:$|[A-Z_])/.test(name);
}
