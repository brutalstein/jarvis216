import { z } from "zod";
import type { CompiledStep, Kind, Lang, Risk } from "./types.js";

export interface ActionDef {
  id: string;
  kind: Kind;
  risk: Risk;
  description: Record<Lang, string>;
  args: z.ZodObject;
}

const label = (max: number) => z.string().trim().min(1).max(max);
const typed = z.string().min(1).max(2000);
const path = label(1024);
const files = z.strictObject({ source: path, destination: path });

const definitions: ActionDef[] = [
  ["app.open", "desktop", "LOW", "Uygulama aç", "Open an application", { name: label(80) }],
  [
    "app.focus",
    "desktop",
    "LOW",
    "Uygulamaya geç",
    "Switch to an application",
    { name: label(80) },
  ],
  [
    "app.close",
    "desktop",
    "MEDIUM",
    "Uygulamayı kapat",
    "Close an application",
    { name: label(80) },
  ],
  ["window.list", "desktop", "LOW", "Açık pencereleri göster", "Show open windows", {}],
  [
    "screen.describe",
    "desktop",
    "LOW",
    "Ekranda ne olduğunu anlat",
    "Describe what is on screen",
    { question: label(300).optional() },
  ],
  [
    "media.key",
    "desktop",
    "LOW",
    "Medya tuşu (oynat/duraklat, sonraki, önceki, ses)",
    "Media key (play/pause, next, previous, volume)",
    { key: z.enum(["play_pause", "next", "previous", "volume_up", "volume_down", "mute"]) },
  ],
  [
    "ui.click",
    "desktop",
    "MEDIUM",
    "Ekrandaki bir öğeye tıkla (adıyla)",
    "Click an on-screen element by its name",
    { target: label(120), window: label(120).optional() },
  ],
  [
    "ui.type",
    "desktop",
    "MEDIUM",
    "Metin yaz (isteğe bağlı alan, Enter)",
    "Type text (optional field, Enter)",
    { text: typed, target: label(120).optional(), submit: z.boolean().optional() },
  ],
  [
    "key.shortcut",
    "desktop",
    "MEDIUM",
    "Klavye kısayolu, ör. ctrl+s",
    "Keyboard shortcut, e.g. ctrl+s",
    { keys: label(40) },
  ],
  ["clipboard.read", "desktop", "LOW", "Panoyu oku", "Read the clipboard", {}],
  ["clipboard.write", "desktop", "MEDIUM", "Panoya yaz", "Write to the clipboard", { text: typed }],
  [
    "file.list",
    "desktop",
    "LOW",
    "Klasördeki dosyaları listele",
    "List a folder",
    { folder: path },
  ],
  ["file.move", "desktop", "MEDIUM", "Dosya taşı", "Move a file", files.shape],
  ["file.copy", "desktop", "MEDIUM", "Dosya kopyala", "Copy a file", files.shape],
  ["file.rename", "desktop", "MEDIUM", "Dosyayı yeniden adlandır", "Rename a file", files.shape],
  ["file.mkdir", "desktop", "MEDIUM", "Klasör oluştur", "Create a folder", { path }],
  [
    "web.open",
    "desktop",
    "MEDIUM",
    "Web sayfasını tarayıcıda aç",
    "Open a web page in the browser",
    { url: z.url({ protocol: /^https?$/ }).max(2000) },
  ],
  [
    "agent.delegate",
    "integration",
    "HIGH",
    "Uzman ajana görev ver",
    "Delegate a specialist task",
    { instruction: label(2000) },
  ],
  [
    "browser.read",
    "integration",
    "LOW",
    "İzinli sayfayı oku",
    "Read an allowlisted public page",
    { url: z.url({ protocol: /^https$/ }).max(2000), expectedText: label(4096) },
  ],
  [
    "automation.invoke",
    "integration",
    "HIGH",
    "Kayıtlı otomasyonu çalıştır",
    "Invoke a registered automation",
    { workflow: label(100), payload: z.record(z.string(), z.json()).default({}) },
  ],
  [
    "news.brief",
    "info",
    "LOW",
    "Haber özeti (konu isteğe bağlı)",
    "News brief (optional topic)",
    {
      topic: label(80).optional(),
      region: z.enum(["tr", "world"]).optional(),
      count: z.number().int().min(1).max(8).default(5),
    },
  ],
].map(([id, kind, risk, tr, en, shape]) => ({
  id: id as string,
  kind: kind as Kind,
  risk: risk as Risk,
  description: { tr: tr as string, en: en as string },
  args: z.strictObject(shape as z.ZodRawShape),
}));

export const catalog: Readonly<Record<string, ActionDef>> = Object.freeze(
  Object.fromEntries(definitions.map((definition) => [definition.id, definition])),
);

export function compile(
  steps: unknown,
): { ok: true; steps: CompiledStep[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(steps)) return { ok: false, errors: ["steps must be a list"] };
  const errors: string[] = [];
  const compiled: CompiledStep[] = [];
  steps.forEach((step, index) => {
    const { action, args } = (step ?? {}) as { action?: unknown; args?: unknown };
    // Own-property lookup: "__proto__" or "constructor" must not resolve to Object internals.
    const definition =
      typeof action === "string" && Object.hasOwn(catalog, action) ? catalog[action] : undefined;
    if (!definition) {
      errors.push(`step ${index + 1}: unknown action ${JSON.stringify(action)}`);
      return;
    }
    const parsed = definition.args.safeParse(args ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push(
          `step ${index + 1} (${definition.id}): ${issue.path.join(".")} ${issue.message}`,
        );
      return;
    }
    compiled.push({
      action: definition.id,
      args: parsed.data,
      risk: definition.risk,
      kind: definition.kind,
    });
  });
  return errors.length ? { ok: false, errors } : { ok: true, steps: compiled };
}

type JsonProperty = { type?: string; enum?: unknown[] };
function signature(args: z.ZodObject): string {
  const schema = z.toJSONSchema(args, { io: "input" }) as {
    properties?: Record<string, JsonProperty>;
    required?: string[];
  };
  return Object.entries(schema.properties ?? {})
    .map(([name, property]) => {
      const type = property.enum ? property.enum.join("|") : (property.type ?? "value");
      return `${name}${schema.required?.includes(name) ? "" : "?"}: ${type}`;
    })
    .join(", ");
}

export function catalogLines(): string {
  return definitions
    .map((d) => `${d.id}(${signature(d.args)}) — ${d.description.tr} / ${d.description.en}`)
    .join("\n");
}
