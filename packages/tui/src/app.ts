import { BoxRenderable, type CliRenderer, TextRenderable } from "@opentui/core";

/** Builds the app's screen on an existing renderer: a header and an (empty) build list. */
export function mountApp(renderer: CliRenderer): void {
  const layout = new BoxRenderable(renderer, {
    id: "layout",
    flexDirection: "column",
    width: "100%",
    height: "100%",
  });

  const header = new BoxRenderable(renderer, {
    id: "header",
    border: true,
    borderStyle: "rounded",
    paddingLeft: 1,
    height: 3,
  });
  header.add(new TextRenderable(renderer, { content: "edro · builds" }));

  const list = new BoxRenderable(renderer, {
    id: "build-list",
    border: true,
    borderStyle: "rounded",
    title: "Builds",
    paddingLeft: 1,
    flexGrow: 1,
  });
  list.add(new TextRenderable(renderer, { content: "No builds yet." }));

  const footer = new TextRenderable(renderer, { content: " q quit", fg: "#888888" });

  layout.add(header);
  layout.add(list);
  layout.add(footer);
  renderer.root.add(layout);
}
