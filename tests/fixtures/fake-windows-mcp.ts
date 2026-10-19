// A stdio MCP server that behaves like Windows-MCP 0.8.8 over a simulated desktop, so the real
// McpToolPort, DesktopExecutor, guards and grounding run end to end in tests.
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

type Window = { title: string; elements: { role: string; name: string }[] };
const launchable: Record<string, Window> = {
  "not defteri": {
    title: "Adsız - Not Defteri",
    elements: [
      { role: "belge", name: "Metin düzenleyici" },
      { role: "menü öğesi", name: "Dosya" },
    ],
  },
  notepad: {
    title: "Untitled - Notepad",
    elements: [{ role: "document", name: "Text editor" }],
  },
  spotify: { title: "Spotify Premium", elements: [{ role: "düğme", name: "Oynat" }] },
};
const windows: Window[] = [
  {
    title: "Raporlar - Dosya Gezgini",
    elements: [
      { role: "düğme", name: "Kaydet" },
      { role: "düğme", name: "Kaydetme" },
    ],
  },
];
let focused: string | null = windows[0]?.title ?? null;
const calls: { tool: string; args: unknown }[] = [];

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const row = (title: string) =>
  `${title.padEnd(40)}  ${"2".padStart(7)}  Normal     1600      1000    263838`;
function snapshot(): string {
  const focus = windows.find((window) => window.title === focused);
  const others = windows.filter((window) => window.title !== focused);
  const tree = windows.flatMap((window, w) => [
    `    ├── window "${window.title}"`,
    ...window.elements.map(
      (element, i) =>
        `    │   ├── (${100 + w * 10 + i},${200 + i * 20}) ${element.role} "${element.name}"  [action: click]`,
    ),
  ]);
  return [
    "    Focused Window:",
    "    Name                                        Depth  Status       Width    Height    Handle",
    "----------------------------------------  -------  ---------  -------  --------  --------",
    ...(focus ? [row(focus.title)] : []),
    "",
    "    Opened Windows:",
    "    Name                                        Depth  Status       Width    Height    Handle",
    "----------------------------------------  -------  ---------  -------  --------  --------",
    ...others.map((window) => row(window.title)),
    "",
    "    UI Tree:",
    "    desktop",
    ...tree,
    "",
  ].join("\n");
}

const server = new McpServer({ name: "fake-windows-mcp", version: "0.8.8" });
const anything = { inputSchema: z.object({}).passthrough() };
server.registerTool("App", anything, async (args) => {
  calls.push({ tool: "App", args });
  const { mode, name } = args as { mode?: string; name?: string };
  if (mode === "launch") {
    const window = launchable[(name ?? "").toLocaleLowerCase("tr")];
    if (!window) return text(`Error: ${name} not found in Start menu`);
    if (!windows.some((open) => open.title === window.title)) windows.push({ ...window });
    focused = window.title;
    return text(`Opened ${name}`);
  }
  if (mode === "switch") {
    const window = windows.find((open) => open.title === name);
    if (!window) return text(`Error: ${name} not found`);
    focused = window.title;
    return text(`Switched to ${name}`);
  }
  return text("ok");
});
server.registerTool("Shortcut", anything, async (args) => {
  calls.push({ tool: "Shortcut", args });
  if ((args as { shortcut?: string }).shortcut === "alt+f4" && focused) {
    windows.splice(
      windows.findIndex((window) => window.title === focused),
      1,
    );
    focused = windows.at(-1)?.title ?? null;
  }
  return text("Pressed");
});
server.registerTool("Snapshot", anything, async (args) => {
  calls.push({ tool: "Snapshot", args });
  return text(snapshot());
});
for (const name of [
  "Click",
  "Type",
  "Scroll",
  "Screenshot",
  "FileSystem",
  "Clipboard",
  "Wait",
  "WaitFor",
  "ControlStatus",
])
  server.registerTool(name, anything, async (args) => {
    calls.push({ tool: name, args });
    return text("ok");
  });
// Test-only inspection of what JARVIS asked the desktop to do (not allowlisted in Core).
server.registerTool("Calls", anything, async () => text(JSON.stringify(calls)));
await server.connect(new StdioServerTransport());
