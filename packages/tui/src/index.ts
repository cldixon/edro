import { createCliRenderer } from "@opentui/core";
import { mountApp } from "./app.ts";

export { mountApp } from "./app.ts";

/** Starts the full-screen TUI and resolves once the user quits. */
export async function runTui(): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  mountApp(renderer);

  renderer.keyInput.on("keypress", (key) => {
    if (key.name === "q" || key.name === "escape") renderer.destroy();
  });

  await renderer.closed;
}
