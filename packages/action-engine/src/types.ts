export type Lang = "tr" | "en";
// Cycle 1 has no HIGH actions: they wait for Windows Hello signed approvals.
export type Risk = "LOW" | "MEDIUM" | "HIGH";
export type Kind = "desktop" | "info" | "integration" | "memory";
export type Step = {
  action: string;
  args: Record<string, unknown>;
  when?: { step: number; contains: string; not?: boolean };
};
export type CompiledStep = Step & { risk: Risk; kind: Kind };
export type ToolResult = {
  ok: boolean;
  text: string;
  images?: { data: string; mimeType: string }[];
};
export interface ToolPort {
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>;
}
