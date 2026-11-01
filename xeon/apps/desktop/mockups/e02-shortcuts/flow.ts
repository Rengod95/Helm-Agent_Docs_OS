// e02 상태 기계(목업 전용): O-09 바로 가기 키 도움말 + 키 바꾸기(계획에 없음 11) + 웹 키 표(계획에 없음 9).
// 키는 공백으로 나눈 낱키("Mod Shift N"). Mod = macOS ⌘, Linux Ctrl.
import { L2, T } from "../_shell";
import type { After } from "../_chat-rt";

export interface Binding {
  /** 동작 id(§4.8). 없으면 바꿀 수 없는 키(입력창·승인 카드 글자 키). */
  id?: string;
  label: string;
  keys: string;
  /** 웹에서 브라우저가 가져가는 키면 웹 대체 키. */
  web?: string;
}

export interface Group {
  id: string;
  title: string;
  items: Binding[];
}

export const GROUPS: Group[] = [
  {
    id: "global",
    title: L2("어디서나", "Anywhere"),
    items: [
      { id: "palette.open", label: L2("명령 팔레트", "Command palette"), keys: "Mod K" },
      {
        id: "thread.new",
        label: L2("새 대화", "New conversation"),
        keys: "Mod N",
        web: "Alt Shift N",
      },
      { id: "settings.open", label: L2("설정", "Settings"), keys: "Mod ," },
      { id: "help.shortcuts", label: T.keybinding, keys: "Mod /" },
    ],
  },
  {
    id: "nav",
    title: L2("이동", "Go to"),
    items: [
      {
        id: "nav.1–5",
        label: `${T.thread} · ${T.inbox} · ${T.proposals} · ${T.schedules} · ${T.connection}`,
        keys: "Mod 1–5",
        web: "Alt Shift 1–5",
      },
      { id: "thread.next", label: L2("다음 대화", "Next conversation"), keys: "Alt Mod ↓" },
      { id: "thread.prev", label: L2("이전 대화", "Previous conversation"), keys: "Alt Mod ↑" },
    ],
  },
  {
    id: "area",
    title: L2("영역", "Areas"),
    items: [
      { id: "area.toggle", label: `${T.thread} ↔ ${T.workbench}`, keys: "Mod E" },
      { id: "area.chat", label: L2(`${T.thread} 영역`, `${T.thread} area`), keys: "Alt Mod 1" },
      {
        id: "area.workbench",
        label: L2(`${T.workbench} 영역`, `${T.workbench} area`),
        keys: "Alt Mod 2",
      },
      {
        id: "region.next",
        label: L2(
          "다음 구역(왼쪽 → 가운데 → well → 상태 표시줄)",
          "Next region (left → center → well → status bar)",
        ),
        keys: "F6",
      },
    ],
  },
  {
    id: "panel",
    title: L2("패널", "Panels"),
    items: [
      {
        id: "sidebar.toggle",
        label: L2("왼쪽 패널 열고 닫기", "Toggle left panel"),
        keys: "Mod \\",
      },
      {
        id: "panel.toggle",
        label: L2("오른쪽 패널 열고 닫기", "Toggle right panel"),
        keys: "Mod J",
      },
      { id: "panel.inbox", label: T.inbox, keys: "Mod Shift I" },
      { id: "panel.helm", label: `${T.inquiry} (Helm)`, keys: "Mod Shift H" },
      { id: "panel.work", label: L2("작업", "Work"), keys: "Mod Shift T" },
    ],
  },
  {
    id: "chat",
    title: T.thread,
    items: [
      {
        id: "turn.interrupt",
        label: L2("진행 중 턴 중단", "Stop the running turn"),
        keys: "Mod .",
      },
      { id: "composer.focus", label: L2("입력창으로", "Focus the composer"), keys: "Mod L" },
      {
        id: "approval.next",
        label: L2("다음 대기 승인", "Next pending approval"),
        keys: "Mod Shift A",
      },
    ],
  },
  {
    id: "composer",
    title: L2("입력창", "Composer"),
    items: [
      { label: L2("보내기", "Send"), keys: "Enter" },
      { label: L2("줄바꿈", "New line"), keys: "Shift Enter" },
      { label: L2("슬래시 명령", "Slash commands"), keys: "/" },
    ],
  },
  {
    id: "approval",
    title: L2("승인 카드", "Approval card"),
    items: [
      { label: L2("허용", "Allow"), keys: "Y" },
      { label: L2("거부", "Deny"), keys: "N" },
      { label: L2("이 대화에서 항상", "Always in this conversation"), keys: "Shift Y" },
    ],
  },
];

export const LEFT = ["global", "nav", "area", "chat"];
export const RIGHT = ["panel", "composer", "approval"];

/** 웹에서 브라우저가 가져가 막을 수 없는 키(Chrome·Safari·Firefox 공통). */
export const BROWSER_KEYS = new Set([
  "Mod N",
  "Mod W",
  "Mod T",
  "Mod 1–5",
  "Mod Shift N",
  "Mod Shift T",
  "Mod Shift W",
]);

export function find(id: string): Binding | undefined {
  for (const g of GROUPS) for (const b of g.items) if (b.id === id) return b;
  return undefined;
}

export interface S {
  platform: "desktop" | "web";
  os: "mac" | "linux";
  q: string;
  /** 키를 기다리는 동작 id. */
  rec: string | null;
  /** 겹침: 누른 키와 그 키를 이미 쓰는 동작(또는 브라우저). */
  conflict: { id: string; keys: string; other: string | "browser" } | null;
  /** 사용자가 바꾼 키(null = 키 없음). */
  over: Record<string, string | null>;
  /** 방금 바꾼 행(저장됨 표시). */
  saved: string | null;
  confirmReset: boolean;
  toast: { n: number; title: string; tone: "neutral" | "success" | "danger" } | null;
}

export type A =
  | { t: "start" }
  | { t: "platform"; p: "desktop" | "web" }
  | { t: "os"; os: "mac" | "linux" }
  | { t: "q"; q: string }
  | { t: "record"; id: string }
  | { t: "press"; keys: string }
  | { t: "swap" }
  | { t: "cancel" }
  | { t: "reset"; id: string }
  | { t: "resetAsk" }
  | { t: "resetAll" }
  | { t: "unsaved" };

export function init(): S {
  return {
    platform: "desktop",
    os: "mac",
    q: "",
    rec: null,
    conflict: null,
    over: {},
    saved: null,
    confirmReset: false,
    toast: null,
  };
}

/** 지금 쓰이는 키(바꾼 값 > 웹 대체 > 기본). */
export function keysOf(s: S, b: Binding): string | null {
  if (b.id !== undefined && b.id in s.over) return s.over[b.id] ?? null;
  if (s.platform === "web" && b.web !== undefined) return b.web;
  return b.keys;
}

function owner(s: S, keys: string, except: string): string | undefined {
  for (const g of GROUPS)
    for (const b of g.items)
      if (b.id !== undefined && b.id !== except && keysOf(s, b) === keys) return b.id;
  return undefined;
}

let n = 0;
export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "start":
      return s;
    case "platform":
      return { ...s, platform: a.p, rec: null, conflict: null };
    case "os":
      return { ...s, os: a.os };
    case "q":
      return { ...s, q: a.q };
    case "record":
      return { ...s, rec: a.id, conflict: null, saved: null };
    case "press": {
      const id = s.rec;
      if (id === null) return s;
      if (s.platform === "web" && BROWSER_KEYS.has(a.keys))
        return { ...s, conflict: { id, keys: a.keys, other: "browser" } };
      const other = owner(s, a.keys, id);
      if (other !== undefined) return { ...s, conflict: { id, keys: a.keys, other } };
      n += 1;
      return {
        ...s,
        rec: null,
        over: { ...s.over, [id]: a.keys },
        saved: id,
        toast: {
          n,
          title: L2(
            `${find(id)?.label ?? id} 키를 바꿨어요`,
            `Changed the shortcut for ${find(id)?.label ?? id}`,
          ),
          tone: "success",
        },
      };
    }
    case "swap": {
      const c = s.conflict;
      if (c === null || c.other === "browser") return s;
      n += 1;
      return {
        ...s,
        rec: null,
        conflict: null,
        over: { ...s.over, [c.id]: c.keys, [c.other]: null },
        saved: c.id,
        toast: {
          n,
          title: L2(
            `${find(c.other)?.label ?? c.other}에는 이제 키가 없어요`,
            `${find(c.other)?.label ?? c.other} has no shortcut now`,
          ),
          tone: "neutral",
        },
      };
    }
    case "cancel":
      return { ...s, rec: null, conflict: null, confirmReset: false };
    case "reset": {
      const over = { ...s.over };
      delete over[a.id];
      return { ...s, over, saved: null };
    }
    case "resetAsk":
      return { ...s, confirmReset: true };
    case "resetAll":
      n += 1;
      return {
        ...s,
        over: {},
        confirmReset: false,
        saved: null,
        toast: {
          n,
          title: L2("모든 키를 기본값으로 돌렸어요", "All shortcuts are back to default"),
          tone: "neutral",
        },
      };
    case "unsaved":
      return s;
  }
}

export const SCRIPTS: Record<string, readonly A[]> = {
  base: [],
  "rebind-key": [
    { t: "record", id: "thread.new" },
    { t: "press", keys: "Mod Shift N" },
  ],
  "rebind-key-conflict": [
    { t: "record", id: "thread.new" },
    { t: "press", keys: "Mod K" },
    { t: "swap" },
  ],
  "web-keys": [
    { t: "platform", p: "web" },
    { t: "record", id: "thread.new" },
    { t: "press", keys: "Mod N" },
    { t: "press", keys: "Alt Shift M" },
  ],
  changed: [
    { t: "record", id: "thread.new" },
    { t: "press", keys: "Mod Shift N" },
    { t: "record", id: "panel.work" },
    { t: "press", keys: "Mod Shift W" },
  ],
  "reset-all": [
    { t: "record", id: "thread.new" },
    { t: "press", keys: "Mod Shift N" },
    { t: "record", id: "panel.work" },
    { t: "press", keys: "Mod Shift W" },
    { t: "resetAsk" },
    { t: "resetAll" },
  ],
};

export function effect(_a: A, _s: S, _after: After<A>): void {}
