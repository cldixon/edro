import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { mountApp } from "./app.ts";

test("renders the header and an empty build list", async () => {
  const { renderer, renderOnce, captureCharFrame, dispose } = await createTestRenderer({
    width: 60,
    height: 12,
  });
  try {
    mountApp(renderer);
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain("edro · builds");
    expect(frame).toContain("Builds");
    expect(frame).toContain("No builds yet.");
  } finally {
    await dispose();
  }
});
