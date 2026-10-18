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
export type PermissionMode = "ask" | "allow" | "deny";
export type Preset = "guarded" | "trusted" | "autonomous";
export type PermissionChange = {
  actions?: Record<string, { mode: PermissionMode; expiresInMs?: number }>;
  settings?: { learning?: boolean; reflexes?: boolean };
};
export type BrainView = {
  stats: {
    experiences: number;
    skills: number;
    preferences: number;
    planSuccessRate: number | null;
    correctionRate: number | null;
    reflexShare: number | null;
    lastConsolidatedAt: number | null;
  };
  skills: {
    id: string;
    goal: string;
    phrases: string[];
    steps: string[];
    strength: number;
    successes: number;
    uses: number;
  }[];
};
export type MemoryNote = { id: string; note: string; createdAt: number };
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
  permissions: {
    get(): Promise<PermissionView>;
    set(change: PermissionChange): Promise<PermissionView>;
    preset(name: Preset, expiresInMs?: number): Promise<PermissionView>;
  };
  brain: {
    get(): Promise<BrainView>;
    consolidate(): Promise<void>;
    forgetSkill(id: string): Promise<void>;
    reset(): Promise<void>;
  };
  memories: {
    get(): Promise<MemoryNote[]>;
    forget(id: string): Promise<void>;
    clear(): Promise<void>;
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

import type { PermissionView } from "../../../src/permissions";
import type { PlanView } from "../../../src/plans";

export type { PermissionView, PlanView };
