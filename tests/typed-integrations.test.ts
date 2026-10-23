import { expect, it } from "vitest";

it("provides a standalone typed interactive browser executor", async () => {
  const module = await import("../src/integrations/interactive-browser.js").catch(() => ({}));
  expect(module).toHaveProperty("InteractiveBrowserExecutor", expect.any(Function));
});

it("provides a standalone typed GitHub executor", async () => {
  const module = await import("../src/integrations/github.js").catch(() => ({}));
  expect(module).toHaveProperty("GitHubExecutor", expect.any(Function));
});
