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
const content = z
  .string()
  .max(16_000)
  .refine(
    (value) => value.isWellFormed() && Buffer.byteLength(value, "utf8") <= 16_000,
    "content must be valid UTF8 of at most 16000 bytes",
  );
const owner = label(39).regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/);
const repo = label(100).regex(/^[a-zA-Z0-9_.-]+$/);
const repository = { owner, repo };
const limit = z.number().int().min(1).max(30).optional();
// n8n nodes JARVIS may compose into automations. No code, shell, HTTP or n8n-admin nodes.
export const automationNodeTypes = [
  "scheduleTrigger",
  "manualTrigger",
  "readWriteFile",
  "youTube",
  "googleDrive",
  "set",
  "if",
  "filter",
  "sort",
  "limit",
  "removeDuplicates",
  "splitInBatches",
  "merge",
  "wait",
  "dateTime",
  "noOp",
  "rssFeedRead",
] as const;

const definitions: ActionDef[] = [
  [
    "browser.navigate",
    "integration",
    "MEDIUM",
    "İzinli tarayıcı adresini aç",
    "Navigate to an allowed browser origin",
    { url: z.url().max(2000) },
  ],
  [
    "browser.snapshot",
    "integration",
    "LOW",
    "Tarayıcı sayfasını oku",
    "Read the current browser snapshot",
    {},
  ],
  [
    "browser.fill",
    "integration",
    "MEDIUM",
    "Tarayıcı alanını doldur",
    "Fill a labeled browser field",
    { label: label(120), value: z.string().max(2000) },
  ],
  [
    "browser.click",
    "integration",
    "HIGH",
    "Tarayıcı düğmesini tıkla; form gönderebilir",
    "Click a named browser control; may submit a form",
    { name: label(120) },
  ],
  [
    "browser.verify",
    "integration",
    "LOW",
    "Sayfa sonucunu doğrula",
    "Verify visible browser text",
    { text: label(4096) },
  ],
  [
    "browser.fill_password",
    "integration",
    "MEDIUM",
    "Parola alanına kasadaki parolayı yaz; yoksa güçlü bir parola üretip sakla",
    "Type this site's vault password into a password field, creating and storing a strong one if new; never write passwords yourself",
    { label: label(120) },
  ],
  [
    "browser.save_key",
    "integration",
    "MEDIUM",
    "Sayfada görünen API anahtarını kasaya kaydet",
    "Save the one API key visible on the page to the vault under a name such as OPENROUTER_API_KEY",
    { name: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,59}$/) },
  ],
  [
    "github.profile",
    "integration",
    "LOW",
    "Kimlik doğrulanmış GitHub profilini oku",
    "Read the authenticated GitHub profile",
    {},
  ],
  [
    "github.repositories",
    "integration",
    "LOW",
    "GitHub depolarımı listele",
    "List authenticated GitHub repositories",
    { owner: owner.optional(), limit },
  ],
  [
    "github.repository",
    "integration",
    "LOW",
    "GitHub depo ayrıntılarını oku",
    "Read GitHub repository details",
    repository,
  ],
  [
    "github.file",
    "integration",
    "LOW",
    "GitHub dosyasını oku",
    "Read a GitHub repository file",
    { ...repository, path: label(1024), ref: label(200).optional() },
  ],
  [
    "github.issues",
    "integration",
    "LOW",
    "GitHub sorunlarını listele",
    "List repository issues",
    { ...repository, limit },
  ],
  [
    "github.issue",
    "integration",
    "LOW",
    "GitHub sorununu oku",
    "Read a repository issue",
    { ...repository, number: z.number().int().min(1).max(2147483647) },
  ],
  [
    "github.issue_create",
    "integration",
    "HIGH",
    "Onaylı GitHub sorunu oluştur",
    "Create an approved GitHub issue",
    { ...repository, title: label(256), body: z.string().max(8000) },
  ],
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
    "file.create",
    "desktop",
    "MEDIUM",
    "Yeni metin dosyası oluştur",
    "Create a new UTF8 text file without overwriting",
    { path, content },
  ],
  ["file.read", "desktop", "LOW", "Metin dosyasını oku", "Read a bounded UTF8 text file", { path }],
  [
    "file.write",
    "desktop",
    "MEDIUM",
    "Mevcut metin dosyasına yaz",
    "Replace an existing regular file with UTF8 text",
    { path, content },
  ],
  [
    "file.delete",
    "desktop",
    "HIGH",
    "Tek dosyayı sil",
    "Delete one regular file, never a folder",
    { path },
  ],
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
    "agent.execute",
    "integration",
    "HIGH",
    "Karmaşık bir görevi Claude Code ajanıyla yürüt",
    "Execute an open-ended task with the Claude Code agent and optional MCP tools",
    { instruction: label(8000) },
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
    "browser.read_many",
    "integration",
    "LOW",
    "Birkaç izinli sayfayı oku",
    "Read several allowlisted public pages",
    {
      pages: z
        .array(
          z.strictObject({
            url: z.url({ protocol: /^https$/ }).max(2000),
            expectedText: label(4096),
          }),
        )
        .min(1)
        .max(4),
    },
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
    "automation.create",
    "integration",
    "HIGH",
    "Zamanlanmış n8n otomasyonu oluştur ya da aynı adlıyı güncelle ve yayınla",
    "Create (or update the same-named) scheduled n8n automation and publish it. " +
      "nodes: [{name, type, typeVersion?, parameters, credentials?: {credentialType: name or ''}}]; " +
      "connections: [{from, to, output?}]. One scheduleTrigger or manualTrigger is required. " +
      "Files: readWriteFile reads only under /home/node/.n8n-files/ (the operator's mounted folder), " +
      "glob fileSelector, binary in 'data'. youTube upload: resource 'video', operation 'upload', " +
      "title, regionCode, categoryId, binaryProperty 'data', options.privacyStatus, " +
      "credentials {youTubeOAuth2Api: ''}. Skip already handled items with removeDuplicates " +
      "operation 'removeItemsSeenInPreviousExecutions' and dedupeValue.",
    {
      name: label(80),
      nodes: z
        .array(
          z.strictObject({
            name: label(80),
            type: z.enum(automationNodeTypes),
            typeVersion: z.number().min(1).max(10).optional(),
            parameters: z.record(z.string(), z.json()).default({}),
            credentials: z
              .record(z.string().regex(/^[A-Za-z0-9]{1,80}$/), z.string().max(120))
              .optional(),
          }),
        )
        .min(2)
        .max(30),
      connections: z
        .array(
          z.strictObject({
            from: label(80),
            to: label(80),
            output: z.number().int().min(0).max(9).default(0),
          }),
        )
        .max(60),
    },
  ],
  [
    "help.guide",
    "integration",
    "LOW",
    "Operatörün yapması gereken kurulumu (API anahtarı, giriş, OAuth) resmi kaynaktan adım adım göster ve sayfayı aç",
    "Show, from the vendor's official pages, the exact steps the operator must do (API key, " +
      "sign-in, OAuth connection, account setting) and open the page. Plan it whenever a request " +
      "needs something only the operator can provide or an action is missing because it is not " +
      "configured. Any vendor or service works: the topic is researched live on its official " +
      "site. Write the topic as the need in plain words (e.g. 'n8n API key for JARVIS " +
      "automations', 'connect YouTube OAuth2 credential in n8n', 'Spotify client id').",
    { topic: label(200) },
  ],
  [
    "computer.use",
    "integration",
    "HIGH",
    "Bilgisayarda istenen işi baştan sona kendisi yap (uygulamalar, ayarlar, dosyalar, tarayıcı)",
    "Do a whole task on the operator's computer by itself: any desktop app, window, setting, " +
      "file dialog or the operator's signed-in Chrome, looking at the screen and acting step by " +
      "step until it is done. Plan it for anything to do on this computer that no narrower " +
      "action covers, or when a narrower one failed. Write the task as one complete goal in " +
      "plain words with every detail the operator gave (e.g. 'open Spotify and play my Discover " +
      "Weekly', 'turn on dark mode in Windows settings', 'rename the newest screenshot on the " +
      "Desktop to receipt.png').",
    { task: label(2000) },
  ],
  [
    "memory.save",
    "memory",
    "MEDIUM",
    "Operatörün açıkça hatırlamamı istediği notu kaydet",
    "Remember a note the operator explicitly asked to keep",
    { note: label(500) },
  ],
  [
    "memory.forget",
    "memory",
    "MEDIUM",
    "Bir konudaki notları unut",
    "Forget the notes about a topic",
    { about: label(200) },
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
    const conditional = z
      .strictObject({
        step: z.number().int().min(1).max(Math.max(1, index)),
        contains: z.string().min(1).max(4096),
        not: z.boolean().optional(),
      })
      .optional()
      .safeParse(step?.when);
    if (!conditional.success || (conditional.data && index === 0)) {
      errors.push(`step ${index + 1}: condition must reference an earlier step`);
      return;
    }
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
      ...(conditional.data && { when: conditional.data }),
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

/**
 * Integration and memory actions only when `enabled` has their id.
 * `hidden` (actions the operator turned off) are never listed.
 * When supplied, `available` also limits desktop/info to configured actions.
 */
export function catalogLines(
  enabled?: ReadonlySet<string>,
  hidden?: ReadonlySet<string>,
  available?: ReadonlySet<string>,
): string {
  return definitions
    .filter(
      (d) =>
        !hidden?.has(d.id) &&
        (!available || available.has(d.id)) &&
        ((d.kind !== "integration" && d.kind !== "memory") || !enabled || enabled.has(d.id)),
    )
    .map((d) => `${d.id}(${signature(d.args)}) — ${d.description.tr} / ${d.description.en}`)
    .join("\n");
}
