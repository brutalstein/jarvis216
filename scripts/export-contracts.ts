import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { EnvelopeSchema, ResultSchema, TaskSpecSchema } from "../src/core/contracts.js";

await mkdir("schemas", { recursive: true });
for (const [name, schema] of Object.entries({
  task: TaskSpecSchema,
  result: ResultSchema,
  envelope: EnvelopeSchema,
})) {
  await writeFile(
    `schemas/${name}.schema.json`,
    `${JSON.stringify(z.toJSONSchema(schema), null, 2)}\n`,
  );
}
