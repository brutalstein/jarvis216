import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The dependency rule, enforced: each layer imports only the layers below it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowed: Record<string, string[]> = {
  core: ["core"],
  integrations: ["core", "integrations"],
  services: ["core", "integrations", "services"],
  http: ["core", "services", "http"],
  app: ["core", "integrations", "services", "http", "app"],
  entry: ["app", "core"],
};
// Workspace packages a layer may use; core stays free of the domain packages.
const packages: Record<string, string[]> = {
  core: [],
  integrations: ["@jarvis/action-engine"],
  services: ["@jarvis/action-engine", "@jarvis/brain", "@jarvis/integration-hub"],
  http: ["@jarvis/brain"],
  app: ["@jarvis/action-engine", "@jarvis/brain", "@jarvis/integration-hub"],
  entry: [],
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}
const layerOf = (path: string) => {
  const [first, second] = relative(join(root, "src"), path).split("/");
  return second === undefined ? "entry" : (first ?? "entry");
};
const imports = (path: string) =>
  [...readFileSync(path, "utf8").matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );

describe("architecture", () => {
  const sources = files(join(root, "src"));

  it("places every source file in a known layer", () => {
    for (const path of sources) expect(Object.keys(allowed)).toContain(layerOf(path));
  });

  it("keeps every import inside the layers below", () => {
    const violations: string[] = [];
    for (const path of sources) {
      const layer = layerOf(path);
      for (const specifier of imports(path)) {
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(path), specifier);
          const targetLayer = layerOf(
            target.endsWith(".js") ? target.replace(/\.js$/, ".ts") : target,
          );
          if (!allowed[layer]?.includes(targetLayer))
            violations.push(`${relative(root, path)} -> ${specifier} (${layer} -> ${targetLayer})`);
        } else if (specifier.startsWith("@jarvis/") && !packages[layer]?.includes(specifier))
          violations.push(`${relative(root, path)} -> ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps the workspace packages independent of Core and the desktop", () => {
    const violations = [
      "packages/action-engine/src",
      "packages/brain/src",
      "packages/integration-hub/src",
    ]
      .flatMap((dir) => files(join(root, dir)))
      .flatMap((path) =>
        imports(path)
          .filter(
            (specifier) => /(^|\/)(src|apps)\//.test(specifier) || specifier.startsWith("../../"),
          )
          .map((specifier) => `${relative(root, path)} -> ${specifier}`),
      );
    expect(violations).toEqual([]);
  });

  it("lets the desktop use Core only for types", () => {
    const violations = files(join(root, "apps/desktop/src")).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/^import (type )?[^;]*from "([^"]*\/src\/[^"]*)"/gm)]
        .filter((match) => match[2]?.includes("../../../src/") && !match[1])
        .map((match) => `${relative(root, path)} -> ${match[2]}`),
    );
    expect(violations).toEqual([]);
  });
});
