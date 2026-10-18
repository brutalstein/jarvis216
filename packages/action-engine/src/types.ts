export type Lang = "tr" | "en";
// Cycle 1 has no HIGH actions: they wait for Windows Hello signed approvals.
export type Risk = "LOW" | "MEDIUM";
export type Kind = "desktop" | "info";
export type Step = { action: string; args: Record<string, unknown> };
export type CompiledStep = Step & { risk: Risk; kind: Kind };
export type ToolResult = { ok: boolean; text: string };
export interface ToolPort {
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>;
}
