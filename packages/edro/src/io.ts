/** Output sink, injectable so tests can capture what a command prints. */
export interface Io {
  out(line: string): void;
  err(line: string): void;
  /** Whether stdout is a terminal (enables color). */
  color: boolean;
}

export const processIo: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  color: !!process.stdout.isTTY && !process.env.NO_COLOR,
};
