import type { BuildStatus, JobStatus } from "@edro/mellon";

export { formatAgo, formatDuration } from "@edro/mellon";

import { UsageError } from "./exit.ts";

const COLORS: Record<string, number> = {
  succeeded: 32,
  failed: 31,
  running: 33,
  waiting: 36,
  canceled: 90,
  did_not_run: 90,
};

export function formatStatus(status: BuildStatus | JobStatus, color: boolean): string {
  const code = COLORS[status];
  return color && code ? `\x1b[${code}m${status}\x1b[0m` : status;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the point
const ANSI = /\x1b\[[0-9;]*m/g;
const visibleLength = (s: string) => s.replace(ANSI, "").length;

/** Left-aligned columns separated by two spaces, with a header row. */
export function table(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => visibleLength(r[i] ?? ""))),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) =>
        i === cells.length - 1 ? c : c + " ".repeat((widths[i] ?? 0) - visibleLength(c)),
      )
      .join("  ")
      .trimEnd();
  return [line(headers.map((h) => h.toUpperCase())), ...rows.map(line)];
}

/** `30m`, `6h`, `2d`, `1w`, or an ISO date/time. */
export function parseSince(value: string, now = Date.now()): Date {
  const m = value.match(/^(\d+)([mhdw])$/);
  if (m) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2] as "m"];
    return new Date(now - Number(m[1]) * unit);
  }
  const t = Date.parse(value);
  if (Number.isNaN(t))
    throw new UsageError(`Invalid --since "${value}". Use e.g. 30m, 6h, 2d or an ISO date.`);
  return new Date(t);
}
