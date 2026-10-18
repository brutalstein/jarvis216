import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Docker is not available in CI here, so the image's workspace copies are checked statically.
it("the Core image copies every workspace package it builds and runs", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const packages = readdirSync(new URL("../packages/", import.meta.url));
  expect(packages.length).toBeGreaterThan(0);
  for (const name of packages) {
    const dir = `packages/${name}`;
    expect(dockerfile, dir).toContain(`COPY ${dir}/package.json ${dir}/tsconfig.json ./${dir}/`);
    expect(dockerfile, dir).toContain(`COPY ${dir}/src ./${dir}/src`);
    expect(dockerfile, dir).toContain(`/app/${dir}/package.json ./${dir}/`);
    expect(dockerfile, dir).toContain(`/app/${dir}/dist ./${dir}/dist`);
  }
});
