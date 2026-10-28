import { createCliRenderer } from "@opentui/core";
import { type BoardOptions, BuildBoard } from "./board.ts";

export { type BoardOptions, BuildBoard } from "./board.ts";

/** Starts the full-screen TUI and resolves once the user quits. */
export async function runTui(options: BoardOptions): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  const board = new BuildBoard(renderer, options);

  renderer.keyInput.on("keypress", (key) => {
    void board.handleKey(key.name).then((keepGoing) => {
      if (!keepGoing) renderer.destroy();
    });
  });

  void board.start();
  await renderer.closed;
  board.stop();
}
