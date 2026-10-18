export type State = "idle" | "listening" | "thinking" | "speaking" | "approval" | "error";
export type Block =
  | { type: "text"; title?: string; body: string }
  | { type: "list"; title?: string; items: string[] }
  | { type: "code"; language?: string; code: string };
export type UiEvent =
  | { type: "state"; value: State }
  | { type: "caption"; role: "user" | "jarvis"; text: string }
  | { type: "display"; blocks: Block[] }
  | { type: "listening"; value: boolean }
  | { type: "error"; code: string };
export type Voice = { url: string; token: string; test?: boolean };
export interface Bridge {
  voice(): Promise<Voice>;
  onEvent(cb: (event: UiEvent) => void): void;
  turns: { export(): Promise<unknown>; deleteAll(): Promise<void> };
  enrollment: { start(): Promise<void>; finish(): Promise<void>; remove(): Promise<void> };
  setListening(on: boolean): void;
}
declare global {
  interface Window {
    jarvis: Bridge;
  }
}
