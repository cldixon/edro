import {
  type Build,
  type BuildStatus,
  formatAgo,
  formatDuration,
  type Job,
  type JobStatus,
  type MellonClient,
  toEdroError,
} from "@edro/mellon";
import {
  BoxRenderable,
  bold,
  type CliRenderer,
  fg,
  StyledText,
  type TextChunk,
  TextRenderable,
} from "@opentui/core";

export interface BoardOptions {
  client: MellonClient;
  openUrl: (url: string) => Promise<void>;
  /** Time between refreshes. */
  intervalMs: number;
  /** Upper bound for backoff after errors or rate limiting. */
  maxBackoffMs?: number;
  /** Show everyone's builds, not just the current user's. */
  allUsers?: boolean;
  now?: () => number;
}

const STATUS_COLORS: Record<BuildStatus | JobStatus, string> = {
  running: "#e5c07b",
  succeeded: "#98c379",
  failed: "#e06c75",
  canceled: "#7f848e",
  waiting: "#56b6c2",
  did_not_run: "#7f848e",
};
const DIM = "#7f848e";

const pad = (s: string, n: number) => (s.length >= n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const status = (s: BuildStatus | JobStatus) => fg(STATUS_COLORS[s])(pad(s, 11));
const line = (...chunks: Array<TextChunk | string>): TextChunk[] => [
  ...chunks.map((c) => (typeof c === "string" ? fg("#abb2bf")(c) : c)),
  fg("#abb2bf")("\n"),
];

/**
 * The live build list: polls Foundry, keeps the selection stable across
 * refreshes, and shows a build's jobs on Enter.
 */
export class BuildBoard {
  builds: Build[] = [];
  selected = 0;
  detail: { build: Build; jobs: Job[] } | null = null;
  error: string | null = null;
  lastRefresh: number | null = null;
  /** How long the last refresh took; slow responses stretch the polling interval. */
  lastDurationMs = 0;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly now: () => number;

  private readonly header: TextRenderable;
  private readonly body: TextRenderable;
  private readonly bodyBox: BoxRenderable;
  private readonly footer: TextRenderable;

  constructor(
    private readonly renderer: CliRenderer,
    private readonly options: BoardOptions,
  ) {
    this.now = options.now ?? Date.now;
    const layout = new BoxRenderable(renderer, {
      id: "layout",
      flexDirection: "column",
      width: "100%",
      height: "100%",
    });
    const headerBox = new BoxRenderable(renderer, {
      id: "header",
      border: true,
      borderStyle: "rounded",
      paddingLeft: 1,
      height: 3,
    });
    this.header = new TextRenderable(renderer, { content: "" });
    headerBox.add(this.header);
    this.bodyBox = new BoxRenderable(renderer, {
      id: "body",
      border: true,
      borderStyle: "rounded",
      title: "Builds",
      paddingLeft: 1,
      flexGrow: 1,
    });
    this.body = new TextRenderable(renderer, { content: "Loading builds…" });
    this.bodyBox.add(this.body);
    this.footer = new TextRenderable(renderer, { content: "" });
    layout.add(headerBox);
    layout.add(this.bodyBox);
    layout.add(this.footer);
    renderer.root.add(layout);
    this.render();
  }

  /** Fetches now, then keeps polling until `stop()`. */
  start(): Promise<void> {
    return this.refresh();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /**
   * Delay before the next poll: the interval, or three times the last
   * response time if that's longer (so a slow instance isn't queried
   * nonstop), doubled per consecutive failure.
   */
  nextDelay(): number {
    const max = this.options.maxBackoffMs ?? 5 * 60_000;
    const base = Math.max(this.options.intervalMs, 3 * this.lastDurationMs);
    return Math.min(base * 2 ** this.failures, max);
  }

  async refresh(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    const { client } = this.options;
    const started = this.now();
    try {
      const selectedRid = this.builds[this.selected]?.rid;
      const mine = !this.options.allUsers;
      this.builds = (await client.builds.search({ pageSize: 50, mine })).items;
      const keep = this.builds.findIndex((b) => b.rid === selectedRid);
      this.selected =
        keep >= 0 ? keep : Math.min(this.selected, Math.max(0, this.builds.length - 1));
      if (this.detail) {
        const rid = this.detail.build.rid;
        const [build, jobs] = await Promise.all([client.builds.get(rid), client.builds.jobs(rid)]);
        this.detail = { build, jobs: jobs.items };
      }
      this.error = null;
      this.failures = 0;
      this.lastRefresh = this.now();
      this.lastDurationMs = this.lastRefresh - started;
    } catch (e) {
      const err = toEdroError(e);
      this.failures += 1;
      this.error = `${err.message}${err.hint ? ` ${err.hint}` : ""}`;
    }
    this.render();
    if (!this.stopped) this.timer = setTimeout(() => void this.refresh(), this.nextDelay());
  }

  /** Handles a key; returns false when the app should quit. */
  async handleKey(name: string): Promise<boolean> {
    switch (name) {
      case "q":
        return false;
      case "escape":
      case "backspace":
      case "h":
      case "left":
        if (this.detail) this.detail = null;
        else if (name === "escape") return false;
        break;
      case "down":
      case "j":
        if (!this.detail) this.selected = Math.min(this.selected + 1, this.builds.length - 1);
        break;
      case "up":
      case "k":
        if (!this.detail) this.selected = Math.max(this.selected - 1, 0);
        break;
      case "return":
      case "enter":
      case "l":
      case "right": {
        const build = this.builds[this.selected];
        if (build && !this.detail) {
          this.detail = { build, jobs: [] };
          this.render();
          await this.refresh();
        }
        break;
      }
      case "o": {
        const rid = this.detail?.build.rid ?? this.builds[this.selected]?.rid;
        if (rid) await this.options.openUrl(this.options.client.webUrl(rid));
        break;
      }
      case "r":
        await this.refresh();
        break;
    }
    this.render();
    return true;
  }

  private visibleRows(): number {
    // Body box height minus borders and the column header.
    return Math.max(1, this.renderer.height - 3 - 1 - 2 - 1);
  }

  private renderList(): TextChunk[] {
    if (this.builds.length === 0) {
      const whose = this.options.allUsers ? "" : " of yours";
      return line(this.lastRefresh ? `No builds${whose} in the last 24 hours.` : "Loading builds…");
    }
    const now = this.now();
    const rows = this.visibleRows();
    const first = Math.max(
      0,
      Math.min(this.selected - Math.floor(rows / 2), this.builds.length - rows),
    );
    const chunks = line(
      fg(DIM)(
        `  ${pad("STATUS", 11)} ${pad("BRANCH", 22)} ${pad("STARTED", 10)} ${pad("DURATION", 9)} ${pad("JOBS", 5)} RID`,
      ),
    );
    for (const [i, b] of this.builds.slice(first, first + rows).entries()) {
      const sel = first + i === this.selected;
      const text = `${pad(b.branch, 22)} ${pad(formatAgo(b.createdAt, now), 10)} ${pad(formatDuration(b.durationMs), 9)} ${pad(String(b.jobRids.length), 5)} ${b.rid}`;
      chunks.push(...line(sel ? bold("› ") : "  ", status(b.status), " ", sel ? bold(text) : text));
    }
    return chunks;
  }

  private renderDetail(build: Build, jobs: Job[]): TextChunk[] {
    const now = this.now();
    const chunks = [
      ...line(fg(DIM)("build     "), build.rid),
      ...line(fg(DIM)("status    "), status(build.status)),
      ...line(fg(DIM)("branch    "), build.branch),
      ...line(fg(DIM)("started   "), `${build.createdAt} (${formatAgo(build.createdAt, now)})`),
      ...line(fg(DIM)("duration  "), formatDuration(build.durationMs)),
      ...line(fg(DIM)("schedule  "), build.scheduleRid ?? "-"),
      ...line(""),
      ...line(fg(DIM)(`${pad("STATUS", 11)} ${pad("DURATION", 9)} OUTPUT`)),
    ];
    if (jobs.length === 0) chunks.push(...line(fg(DIM)("Loading jobs…")));
    for (const j of jobs) {
      chunks.push(
        ...line(
          status(j.status),
          " ",
          `${pad(formatDuration(j.durationMs), 9)} ${j.outputs.map((o) => o.rid).join(", ")}`,
        ),
      );
    }
    return chunks;
  }

  render(): void {
    const host = this.options.client.hostname;
    this.header.content = new StyledText([bold("edro"), fg(DIM)(` · builds · ${host}`)]);
    const which = this.options.allUsers ? "Builds" : "My builds";
    this.bodyBox.title = this.detail ? "Build" : `${which} (${this.builds.length})`;
    this.body.content = new StyledText(
      this.detail ? this.renderDetail(this.detail.build, this.detail.jobs) : this.renderList(),
    );
    const keys = this.detail
      ? " esc back  o open  r refresh  q quit"
      : " ↑↓/jk move  enter jobs  o open  r refresh  q quit";
    const state = this.error
      ? fg("#e06c75")(`  ${this.error} (retrying in ${Math.round(this.nextDelay() / 1000)}s)`)
      : fg(DIM)(
          this.lastRefresh
            ? `  updated ${new Date(this.lastRefresh).toLocaleTimeString()}${
                this.lastDurationMs >= 2000 ? ` (took ${formatDuration(this.lastDurationMs)})` : ""
              }`
            : "",
        );
    this.footer.content = new StyledText([fg(DIM)(keys), state]);
  }
}
