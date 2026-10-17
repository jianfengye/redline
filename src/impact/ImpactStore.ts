import { impactLabel, type ImpactSummary } from './walkImpact';

export class ImpactStore {
  private readonly results = new Map<string, ImpactSummary>();
  private readonly lineKeys = new Map<string, string>();
  private readonly ranges: { uri: string; summary: ImpactSummary }[] = [];
  private readonly documents = new Map<string, number[]>();

  track(uri: string, lines: number[]): void {
    this.documents.set(uri, [...new Set(lines)].sort((a, b) => a - b));
  }

  lines(uri: string): number[] {
    return this.documents.get(uri) ?? [];
  }

  remember(uri: string, changedLines: number[], summary: ImpactSummary): void {
    this.results.set(summary.key, summary);
    this.ranges.push({ uri, summary });
    for (const line of changedLines) {
      if (line >= summary.startLine && line <= summary.endLine) {
        this.lineKeys.set(lineKey(uri, line), summary.key);
      }
    }
  }

  summaryForLine(uri: string, line: number): ImpactSummary | undefined {
    const key = this.lineKeys.get(lineKey(uri, line));
    if (key) {
      const direct = this.results.get(key);
      if (direct) {
        return direct;
      }
    }
    let best: ImpactSummary | undefined;
    for (const item of this.ranges) {
      if (item.uri !== uri || line < item.summary.startLine || line > item.summary.endLine) {
        continue;
      }
      if (!best || span(item.summary) < span(best)) {
        best = item.summary;
      }
    }
    return best;
  }

  labelForLine(uri: string, line: number): string | undefined {
    const summary = this.summaryForLine(uri, line);
    return summary ? impactLabel(summary) : undefined;
  }
}

function lineKey(uri: string, line: number): string {
  return `${uri}\n${line}`;
}

function span(summary: ImpactSummary): number {
  return summary.endLine - summary.startLine;
}
