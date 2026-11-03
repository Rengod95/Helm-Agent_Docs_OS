// 사람 확인 관문·승인 출처·주도 충돌 상태 기계(목업 전용).
// spec §6.30(사람 확인 관문), X-17(loop.ask, 기다리는 동안 주도 반납), 결정 캔버스 8, 결정 7(자식 승인 출처),
// §6.7 expiresAt(만료 뒤 자동 거부·자동 답), 계획에 없음 3(주도 충돌은 고르는 창 없이 "이 그룹 먼저"), §4.9.8(P-05 정리).
import { EXT, T, josa } from "../_shell";
import type { After, ChatItem } from "../_chat-rt";

export type Gate = "none" | "asking" | "answered" | "denied" | "expired";
export type Appr = "none" | "pending" | "allowed" | "denied" | "expired";
export type First = "none" | "requested" | "switched" | "withdrawn";

export interface S {
  script: string;
  /** 지금 열린 대화(t1 캐시 무효화 조사, t2 테스트 정리). */
  open: "t1" | "t2";
  gate: Gate;
  pick: string;
  holder: string | null;
  appr: Appr;
  first: First;
  /** 다른 대화에 있을 때 온 질문: 받은 요청 항목, OS 알림. */
  inboxAsk: boolean;
  osNotice: boolean;
  items: ChatItem[];
  /** t1이 아닌 곳에 있는 동안 t1에 쌓인 항목 수(목록 표지). */
  gen: number;
}

export type A =
  | { t: "start" }
  | { t: "ask" }
  | { t: "answer"; pick: string }
  | { t: "resume" }
  | { t: "deny" }
  | { t: "expire" }
  | { t: "resumeAuto" }
  | { t: "askElsewhere" }
  | { t: "jump" }
  | { t: "dismissOs" }
  | { t: "childAsk" }
  | { t: "decide"; d: "allowed" | "denied" }
  | { t: "childGo" }
  | { t: "apprExpire" }
  | { t: "first" }
  | { t: "boundary" }
  | { t: "withdraw" };

export const PICKS: Record<string, string> = {
  f1: "발견 1 · 단위 섞임",
  f2: "발견 2 · 저장 때 한 번만 바꾸기",
  f3: "발견 3 · 시계 경계 테스트",
};

const LEAD_O = josa(T.lead, "을", "를");
const GATE_O = josa(T.humanGate, "을", "를");

const converge: ChatItem = {
  k: "row",
  text: `수렴 ${T.step}로 넘어가요 · ${T.finding} 3`,
  source: "grp:helm",
  icon: "lease",
};

export const init = (script: string): S => ({
  script,
  open: script === "ask-other-thread" ? "t2" : "t1",
  gate: "none",
  pick: "f1",
  holder: "helm",
  appr: "none",
  first: "none",
  inboxAsk: false,
  osNotice: false,
  items: [converge],
  gen: 0,
});

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "start":
      return s;
    case "ask":
    case "askElsewhere":
      if (s.gate !== "none") return s;
      return {
        ...s,
        gate: "asking",
        holder: null,
        inboxAsk: a.t === "askElsewhere",
        osNotice: a.t === "askElsewhere",
        items: [
          ...s.items,
          {
            k: "row",
            text: `${EXT.helm}이 ${GATE_O} 기다려요 · ${T.lead} ${T.leadReturn}`,
            source: "grp:helm",
            icon: "ask",
          },
          { k: "node", key: "ask", node: null },
        ],
      };
    case "jump":
      return { ...s, open: "t1", osNotice: false };
    case "dismissOs":
      return { ...s, osNotice: false };
    case "answer":
      if (s.gate !== "asking") return s;
      return {
        ...s,
        gate: "answered",
        pick: a.pick,
        inboxAsk: false,
        osNotice: false,
        holder: "helm",
        items: [
          ...s.items,
          {
            k: "row",
            text: `답했어요 · ${EXT.helm}이 ${LEAD_O} ${T.leadRetake}`,
            source: "grp:helm",
            icon: "lease",
          },
        ],
      };
    case "deny":
      if (s.gate !== "asking") return s;
      return {
        ...s,
        gate: "denied",
        inboxAsk: false,
        osNotice: false,
        holder: "helm",
        items: [
          ...s.items,
          {
            k: "row",
            text: `질문을 거부했어요 · ${EXT.helm}이 ${LEAD_O} ${T.leadRetake} · 적용 없이 ${T.finding}만 남겨요`,
            source: "grp:helm",
            icon: "lease",
          },
        ],
      };
    case "resume":
      if (s.gate !== "answered") return s;
      return {
        ...s,
        items: [
          ...s.items,
          {
            k: "agent",
            live: true,
            text: `${PICKS[s.pick] ?? ""}부터 적용할게요. ttl을 저장할 때 밀리초로 바꾸고 경계 시각 테스트를 더해요.`,
          },
          { k: "tool", name: "edit", detail: "src/cache.ts", status: "done", duration: "120ms" },
        ],
      };
    case "expire":
      if (s.gate !== "asking") return s;
      return {
        ...s,
        gate: "expired",
        inboxAsk: false,
        items: [
          ...s.items,
          {
            k: "row",
            text: `15분 동안 답이 없어 기본 답으로 자동 답했어요 · ${PICKS.f1}`,
            source: "core",
            icon: "clock",
          },
        ],
      };
    case "resumeAuto":
      return {
        ...s,
        holder: "helm",
        items: [
          ...s.items,
          {
            k: "row",
            text: `${EXT.helm}이 기본 답으로 이어서 진행해요 · ${T.lead} ${T.leadRetake}`,
            source: "grp:helm",
            icon: "lease",
          },
          {
            k: "agent",
            live: true,
            text: `답이 없어서 추천안(${PICKS.f1})부터 적용했어요. 다른 순서가 좋으면 말해 주세요.`,
          },
        ],
      };
    case "childAsk":
      if (s.appr !== "none") return s;
      return {
        ...s,
        appr: "pending",
        items: [
          ...s.items,
          {
            k: "row",
            text: `${T.lens} 실패 사례가 도구 ${T.approval}을 기다려요 · 다른 ${T.lens}는 계속`,
            source: "grp:helm",
            icon: "ask",
          },
          { k: "node", key: "appr", node: null },
        ],
      };
    case "decide":
      if (s.appr !== "pending") return s;
      return { ...s, appr: a.d };
    case "childGo":
      return {
        ...s,
        items: [
          ...s.items,
          s.appr === "allowed"
            ? {
                k: "row",
                text: `${T.lens} 실패 사례가 이어서 진행해요 · bash 1회`,
                source: "grp:helm",
                icon: "play",
              }
            : {
                k: "row",
                text: `${T.lens} 실패 사례가 거부를 받고 읽기만으로 이어가요`,
                source: "grp:helm",
                icon: "play",
              },
        ],
      };
    case "apprExpire":
      if (s.appr !== "pending") return s;
      return {
        ...s,
        appr: "expired",
        items: [
          ...s.items,
          {
            k: "row",
            text: `10분 동안 답이 없어 자동 거부했어요 · ${T.lens} 실패 사례`,
            source: "core",
            icon: "clock",
          },
          {
            k: "row",
            text: `${T.lens} 실패 사례가 거부를 받고 읽기만으로 이어가요 · ${EXT.helm} 계속 ${T.drive}`,
            source: "grp:helm",
            icon: "play",
          },
        ],
      };
    case "first":
      if (s.first !== "none") return s;
      return {
        ...s,
        first: "requested",
        items: [
          ...s.items,
          {
            k: "row",
            text: `${EXT.review}가 다음 ${T.stepBoundary}에서 먼저 ${josa(T.lead, "을", "를")} 받아요 · 이 ${T.thread}에만`,
            source: "core",
            icon: "lease",
          },
        ],
      };
    case "boundary":
      if (s.first !== "requested") return s;
      return {
        ...s,
        first: "switched",
        holder: "review",
        items: [
          ...s.items,
          {
            k: "row",
            text: `${EXT.helm}이 ${LEAD_O} 놓았어요 · ${EXT.review}가 받았어요 · ${EXT.helm}은 ${T.leadQueue}`,
            source: "core",
            icon: "lease",
          },
        ],
      };
    case "withdraw":
      if (s.first !== "requested") return s;
      return {
        ...s,
        first: "withdrawn",
        items: [
          ...s.items,
          {
            k: "row",
            text: `${EXT.review}가 더는 기다리지 않아요 · 차례를 거뒀어요 · ${EXT.helm}이 계속 ${T.drive}`,
            source: "grp:review",
            icon: "warn",
            tone: "warning",
          },
        ],
      };
  }
}

export function effect(a: A, n: S, after: After<A>) {
  switch (a.t) {
    case "start":
      if (n.script === "ask-lease-release" || n.script === "ask-expire") after(1800, { t: "ask" });
      else if (n.script === "ask-other-thread") after(2500, { t: "askElsewhere" });
      else if (n.script === "child-approval" || n.script === "approval-expired")
        after(1800, { t: "childAsk" });
      return;
    case "ask":
      if (n.script === "ask-expire") after(6000, { t: "expire" });
      return;
    case "askElsewhere":
      after(7000, { t: "dismissOs" });
      return;
    case "answer":
      after(900, { t: "resume" });
      return;
    case "expire":
      after(1200, { t: "resumeAuto" });
      return;
    case "childAsk":
      if (n.script === "approval-expired") after(6000, { t: "apprExpire" });
      return;
    case "decide":
      after(900, { t: "childGo" });
      return;
    case "first":
      after(3000, n.script === "drive-conflict-withdrawn" ? { t: "withdraw" } : { t: "boundary" });
      return;
    default:
      return;
  }
}

const start: A = { t: "start" };
export const SCRIPTS: Record<string, readonly A[]> = {
  "ask-lease-release": [start, { t: "ask" }, { t: "answer", pick: "f2" }, { t: "resume" }],
  "ask-expire": [start, { t: "ask" }, { t: "expire" }, { t: "resumeAuto" }],
  "ask-other-thread": [
    start,
    { t: "askElsewhere" },
    { t: "jump" },
    { t: "answer", pick: "f1" },
    { t: "resume" },
  ],
  "child-approval": [start, { t: "childAsk" }, { t: "decide", d: "allowed" }, { t: "childGo" }],
  "approval-expired": [start, { t: "childAsk" }, { t: "apprExpire" }],
  "drive-conflict-first": [start, { t: "first" }, { t: "boundary" }],
  "drive-conflict-withdrawn": [start, { t: "first" }, { t: "withdraw" }],
};
