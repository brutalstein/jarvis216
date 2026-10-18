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
  | { type: "plan"; plan: PlanView }
  | { type: "announce"; text: string; lang: "tr" | "en" }
  | { type: "error"; code: string };
export type Voice = { url: string; token: string; test?: boolean };
export type Enrollment = { enrolled: boolean; seconds: number };
export interface Bridge {
  voice(): Promise<Voice>;
  onEvent(cb: (event: UiEvent) => void): void;
  turns: { export(): Promise<unknown>; deleteAll(): Promise<void> };
  plans: {
    approve(id: string, hash: string): Promise<void>;
    approveAction(id: string): Promise<void>;
    reject(id: string): Promise<void>;
    cancel(id: string): Promise<void>;
    choose(id: string, index: number): Promise<PlanView>;
    open(url: string): Promise<void>;
  };
  enrollment: {
    status(): Promise<Enrollment>;
    start(): Promise<void>;
    finish(): Promise<void>;
    cancel(): Promise<void>;
    remove(): Promise<void>;
  };
  setListening(on: boolean): void;
}
declare global {
  interface Window {
    jarvis: Bridge;
  }
}

import type { PlanView } from "../../../src/plans";

export type { PlanView };
