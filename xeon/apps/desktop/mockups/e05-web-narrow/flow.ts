// e05 상태 기계(목업 전용): 웹 연결(계획에 없음 7), 좁은 폭·모바일(계획에 없음 8, N-59), 원격 크래프트(N-60).
// 웹은 데스크톱과 같은 연결 상태 기계를 쓴다: idle → connecting → live | authFailed | unreachable, live → reconnecting → live | offline.
import { L2 } from "../_shell";
import type { After } from "../_chat-rt";

export type Conn =
  | "idle"
  | "connecting"
  | "authFailed"
  | "unreachable"
  | "live"
  | "reconnecting"
  | "offline";
export type MScreen = "chat" | "other" | "inbox" | "approve" | "workbench";

export interface S {
  conn: Conn;
  token: string;
  /** 남은 토큰 시도(5번 틀리면 10분 막힘). */
  left: number;
  attempt: number;
  missed: number;
  m: MScreen;
  sheet: null | "left" | "well";
  banner: boolean;
  badge: number;
  decision: "pending" | "allowed" | "denied" | "elsewhere";
  /** 원격 크래프트: 켜기 요청 중인 확장, 거부됨. */
  pending: string | null;
  denied: boolean;
  menu: string | null;
  toast: {
    n: number;
    title: string;
    description?: string;
    tone: "neutral" | "success" | "danger";
  } | null;
}

export type A =
  | { t: "start" }
  | { t: "token"; v: string }
  | { t: "connect" }
  | { t: "authFail" }
  | { t: "unreachable" }
  | { t: "live" }
  | { t: "drop" }
  | { t: "offline" }
  | { t: "retryConn" }
  | { t: "reconnected" }
  | { t: "notify" }
  | { t: "go"; m: MScreen }
  | { t: "sheet"; v: null | "left" | "well" }
  | { t: "decide"; d: "allowed" | "denied"; late?: boolean }
  | { t: "elsewhere" }
  | { t: "toggle"; name: string }
  | { t: "denied" }
  | { t: "menu"; name: string | null };

export function init(): S {
  return {
    conn: "idle",
    token: "",
    left: 5,
    attempt: 0,
    missed: 0,
    m: "chat",
    sheet: null,
    banner: false,
    badge: 1,
    decision: "pending",
    pending: null,
    denied: false,
    menu: null,
    toast: null,
  };
}

let n = 0;
const tst = (
  title: string,
  tone: "neutral" | "success" | "danger" = "neutral",
  description?: string,
) => {
  n += 1;
  return { n, title, tone, ...(description !== undefined ? { description } : {}) };
};

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "start":
      return s;
    case "token":
      return { ...s, token: a.v };
    case "connect":
      return { ...s, conn: "connecting" };
    case "authFail":
      return { ...s, conn: "authFailed", left: s.left - 1 };
    case "unreachable":
      return { ...s, conn: "unreachable" };
    case "live":
      return { ...s, conn: "live", attempt: 0 };
    case "drop":
      return { ...s, conn: "reconnecting", attempt: 1 };
    case "offline":
      return { ...s, conn: "offline", attempt: 3 };
    case "retryConn":
      return { ...s, conn: "reconnecting", attempt: s.attempt + 1 };
    case "reconnected":
      return {
        ...s,
        conn: "live",
        attempt: 0,
        missed: 2,
        toast: tst(
          L2("다시 연결됐어요", "Reconnected"),
          "success",
          L2("끊긴 동안 놓친 항목 2개를 받았어요", "Fetched the 2 items you missed"),
        ),
      };
    case "notify":
      return { ...s, m: "other", banner: true, badge: 2 };
    case "go":
      return { ...s, m: a.m, sheet: null, banner: a.m === "other" ? s.banner : false };
    case "sheet":
      return { ...s, sheet: a.v };
    case "decide":
      if (a.late === true) return { ...s, decision: "elsewhere" };
      return {
        ...s,
        decision: a.d,
        badge: Math.max(0, s.badge - 1),
        m: "inbox",
        toast: tst(
          a.d === "allowed"
            ? L2("bash 실행을 허용했어요", "Allowed the bash run")
            : L2("거부했어요", "Denied"),
          "success",
        ),
      };
    case "elsewhere":
      return { ...s, decision: "elsewhere", badge: Math.max(0, s.badge - 1) };
    case "toggle":
      return { ...s, pending: a.name, denied: false };
    case "denied":
      return {
        ...s,
        pending: null,
        denied: true,
        toast: null,
      };
    case "menu":
      return { ...s, menu: a.name };
  }
}

export const SCRIPTS: Record<string, readonly A[]> = {
  base: [],
  "web-login": [
    { t: "token", v: "xk_wrong_7f2a" },
    { t: "connect" },
    { t: "authFail" },
    { t: "token", v: "xk_live_93c1" },
    { t: "connect" },
    { t: "live" },
    { t: "drop" },
    { t: "offline" },
    { t: "retryConn" },
    { t: "reconnected" },
  ],
  "web-unreachable": [{ t: "token", v: "xk_live_93c1" }, { t: "connect" }, { t: "unreachable" }],
  "mobile-approve": [
    { t: "notify" },
    { t: "go", m: "inbox" },
    { t: "go", m: "approve" },
    { t: "decide", d: "allowed" },
  ],
  "mobile-approve-expired": [
    { t: "notify" },
    { t: "go", m: "inbox" },
    { t: "go", m: "approve" },
    { t: "decide", d: "allowed", late: true },
  ],
  "remote-enable": [{ t: "toggle", name: "review" }, { t: "denied" }],
  "remote-menu": [{ t: "menu", name: "acme-notes" }],
  "m-left": [{ t: "sheet", v: "left" }],
  "m-well": [{ t: "sheet", v: "well" }],
  "m-wb": [{ t: "go", m: "workbench" }],
};

export function effect(a: A, s: S, after: After<A>): void {
  switch (a.t) {
    case "connect":
      after(
        900,
        s.token.startsWith("xk_wrong")
          ? { t: "authFail" }
          : s.token === ""
            ? { t: "unreachable" }
            : { t: "live" },
      );
      return;
    case "live":
      after(3000, { t: "drop" });
      return;
    case "drop":
      after(1800, { t: "offline" });
      return;
    case "retryConn":
      after(1200, { t: "reconnected" });
      return;
    case "start":
      after(1500, { t: "notify" });
      return;
    case "toggle":
      after(900, { t: "denied" });
      return;
    default:
      return;
  }
}
