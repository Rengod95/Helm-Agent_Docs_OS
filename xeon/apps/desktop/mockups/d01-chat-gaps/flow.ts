// 대화 영역 빈칸 상태 기계(목업 전용). ?state=, ?scenario=, &step=을 한 기계로 돌린다(_chat-rt useMachine).
// N-42 읽기·turn 실패·새 메시지, N-43 승인 카드 네 종류 동기화, N-44 이어서 실행 결과 셋, N-45 행 메뉴, N-46 목록 상태,
// O-06 대화·예약 삭제, 계획에 없음 6 내보내기.
import { threads as baseThreads, T, type Thread } from "../_shell";
import type { After, ChatItem } from "../_chat-rt";
import type { CardKind, CardStatus } from "./parts/approval-card";
import type { ExportFormat, ExportPhase } from "./parts/dialogs";

export type Dialog =
  | null
  | { k: "rename"; id: string }
  | { k: "delete"; id: string }
  | { k: "deleteSchedule" }
  | { k: "export"; id: string };

export type Resume =
  | "none"
  | "restarting"
  | "offered"
  | "resuming"
  | "resumed"
  | "closed"
  | "nothing";

export interface Toast {
  n: number;
  title: string;
  description?: string;
  tone?: "neutral" | "danger" | "success";
  action?: string;
}

export interface S {
  script: string;
  list: Thread[];
  listState: "ok" | "loading" | "error";
  more: "hidden" | "shown" | "loading" | "done";
  open: string;
  view: "ok" | "loading" | "readFail" | "rereading";
  stage: "chat" | "inbox";
  items: ChatItem[];
  running: boolean;
  fail: string | null;
  resume: Resume;
  newMsgs: number;
  menu: string | null;
  dialog: Dialog;
  exportFmt: ExportFormat;
  exportPhase: ExportPhase;
  cards: Record<CardKind, CardStatus | "none">;
  toast: Toast | null;
}

export type A =
  | { t: "start" }
  | { t: "send"; text: string }
  | { t: "tool" }
  | { t: "fail" }
  | { t: "retry" }
  | { t: "retryOk" }
  | { t: "dismissFail" }
  | { t: "restart" }
  | { t: "restarted" }
  | { t: "resume" }
  | { t: "resumeResult"; r: "resumed" | "closed" | "nothing" }
  | { t: "leave" }
  | { t: "menu"; id: string | null }
  | { t: "renameOpen"; id: string }
  | { t: "rename"; id: string; title: string }
  | { t: "fork"; id: string }
  | { t: "compact"; id: string }
  | { t: "close"; id: string }
  | { t: "deleteOpen"; id: string }
  | { t: "deleteConfirm"; id: string }
  | { t: "deleteSchedule" }
  | { t: "deleteScheduleConfirm" }
  | { t: "exportOpen"; id: string }
  | { t: "exportFmt"; f: ExportFormat }
  | { t: "exportGo" }
  | { t: "exportDone" }
  | { t: "exportFail" }
  | { t: "dialogClose" }
  | { t: "listLoad" }
  | { t: "listFail" }
  | { t: "listRetry" }
  | { t: "listLoaded" }
  | { t: "moreShow" }
  | { t: "more" }
  | { t: "moreLoaded" }
  | { t: "openThread"; id: string }
  | { t: "readFail" }
  | { t: "reread" }
  | { t: "readOk" }
  | { t: "scrollUp" }
  | { t: "tick" }
  | { t: "jump" }
  | { t: "ask"; k: CardKind }
  | { t: "decide"; k: CardKind; d: CardStatus }
  | { t: "stage"; v: "chat" | "inbox" };

export const FAIL_REASON = "model_unavailable: sonnet-5-5가 잠시 응답하지 않아요(503).";

/** 50개 뒤 "더 보기"로 오는 옛 대화(nextCursor). */
const OLDER: Thread[] = [
  { id: "o1", folder: "~/notes", title: "9월 회고 초안", status: "idle", approvals: 0 },
  { id: "o2", folder: "~/notes", title: "읽을 논문 정리", status: "idle", approvals: 0 },
];

const LONG_OUTPUT = [
  '$ rg -n "ttl" src',
  ...Array.from({ length: 34 }, (_, i) => {
    const files = ["src/cache.ts", "src/cache/store.ts", "src/cache/policy.ts", "src/http/etag.ts"];
    const f = files[i % files.length] ?? "src/cache.ts";
    return `${f}:${12 + i * 7}:  const ttl = opts.ttl ?? DEFAULT_TTL_SECONDS; // ${i % 3 === 0 ? "seconds" : "ms?"}`;
  }),
].join("\n");

export const toolLong: ChatItem = { k: "node", key: "long-tool", node: null };
export const LONG = { name: "rg", detail: "rg -n ttl src", duration: "0.3s", output: LONG_OUTPUT };

const NO_CARDS: Record<CardKind, CardStatus | "none"> = {
  tool: "none",
  question: "none",
  plan: "none",
  review: "none",
};

export const init = (script: string): S => ({
  script,
  list: baseThreads,
  listState: "ok",
  more: "hidden",
  open: "t1",
  view: "ok",
  stage: "chat",
  items: [toolLong],
  running: false,
  fail: null,
  resume: "none",
  newMsgs: 0,
  menu: null,
  dialog: null,
  exportFmt: "md",
  exportPhase: "idle",
  cards: { ...NO_CARDS, tool: "pending" },
  toast: null,
});

const row = (
  text: string,
  icon: "ok" | "warn" | "clock" | "play" | "step",
  source = "core",
): ChatItem => ({
  k: "row",
  text,
  source,
  icon,
});

let toastN = 0;
const toast = (t: Omit<Toast, "n">): Toast => ({ ...t, n: ++toastN });

const title = (s: S, id: string) => {
  const t = s.list.find((x) => x.id === id);
  return t === undefined ? id : t.title === "" ? "제목 없음" : t.title;
};

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "start":
      return s;
    case "send":
      return {
        ...s,
        running: true,
        fail: null,
        cards: { ...s.cards, tool: "none" },
        items: [
          ...s.items,
          { k: "user", text: a.text },
          {
            k: "agent",
            live: true,
            text: "만료 시각 비교를 밀리초로 맞추고 경계 시험을 돌려 볼게요.",
          },
        ],
      };
    case "tool":
      return {
        ...s,
        items: [
          ...s.items.map((it) => (it.k === "agent" ? { ...it, live: false } : it)),
          { k: "tool", name: "edit", detail: "src/cache.ts", status: "done", duration: "60ms" },
        ],
      };
    case "fail":
      return { ...s, running: false, fail: FAIL_REASON };
    case "dismissFail":
      return { ...s, fail: null };
    case "retry":
      return {
        ...s,
        fail: null,
        running: true,
        items: [...s.items, row(`같은 입력으로 다시 시도해요 · 새 ${T.turn}`, "step")],
      };
    case "retryOk":
      return {
        ...s,
        running: false,
        items: [
          ...s.items,
          { k: "tool", name: "bash", detail: "bun test cache", status: "done", duration: "1.1s" },
          {
            k: "agent",
            live: true,
            text: "경계 시험 3개가 모두 통과했어요. set과 isExpired 모두 밀리초를 써요.",
          },
        ],
      };
    case "restart":
      return {
        ...s,
        running: false,
        resume: "restarting",
        cards: { ...s.cards, tool: "none" },
        items: [
          ...s.items,
          { k: "user", text: "만료 단위 고치고 시험 다시 돌려줘" },
          { k: "agent", text: "src/cache.ts의 비교를 밀리초로 바꿀게요." },
          { k: "tool", name: "edit", detail: "src/cache.ts", status: "done", duration: "60ms" },
        ],
      };
    case "restarted":
      return {
        ...s,
        resume: "offered",
        list: s.list.map((t) => (t.id === "t1" ? { ...t, status: "resumable", approvals: 0 } : t)),
      };
    case "resume":
      return s.resume === "offered" ? { ...s, resume: "resuming" } : s;
    case "resumeResult": {
      const listBack = s.list.map((t) =>
        t.id === "t1"
          ? { ...t, status: a.r === "resumed" ? ("running" as const) : ("idle" as const) }
          : t,
      );
      if (a.r === "resumed")
        return {
          ...s,
          resume: "resumed",
          running: true,
          list: listBack,
          items: [
            ...s.items,
            row(`${T.resume}했어요 · 마지막 단계 사이부터`, "play"),
            { k: "agent", live: true, text: "멈춘 곳부터 이어서 시험을 돌릴게요." },
          ],
        };
      if (a.r === "closed")
        return {
          ...s,
          resume: "closed",
          list: listBack,
          items: [
            ...s.items,
            row(`이어갈 수 없어서 ${T.turn}을 닫았어요 · 재개 횟수 3/3 다 씀`, "warn"),
          ],
        };
      return {
        ...s,
        resume: "nothing",
        list: listBack,
        items: [...s.items, row(`이어서 할 일이 없어요 · 다른 창에서 이미 끝냈어요`, "ok")],
      };
    }
    case "leave":
      return {
        ...s,
        resume: "none",
        list: s.list.map((t) => (t.id === "t1" ? { ...t, status: "idle" } : t)),
        items: [
          ...s.items,
          row(`멈춘 ${T.turn}을 그대로 뒀어요 · 목록에서 다시 이어갈 수 있어요`, "clock"),
        ],
      };
    case "menu":
      return { ...s, menu: a.id };
    case "renameOpen":
      return { ...s, menu: null, dialog: { k: "rename", id: a.id } };
    case "rename":
      return {
        ...s,
        dialog: null,
        list: s.list.map((t) => (t.id === a.id ? { ...t, title: a.title } : t)),
        toast: toast({ title: "이름을 바꿨어요", description: a.title }),
      };
    case "fork": {
      const src = s.list.find((t) => t.id === a.id);
      if (src === undefined) return s;
      const idx = s.list.indexOf(src);
      const copy: Thread = {
        ...src,
        id: `${a.id}-fork`,
        title: `${src.title} (${T.fork})`,
        status: "idle",
        approvals: 0,
      };
      return {
        ...s,
        menu: null,
        open: copy.id,
        list: [...s.list.slice(0, idx + 1), copy, ...s.list.slice(idx + 1)],
        toast: toast({ title: `${T.fork}했어요`, description: `${src.title} · 메시지 24개 복사` }),
      };
    }
    case "compact":
      return {
        ...s,
        menu: null,
        items: [
          ...s.items,
          row(`${T.compaction} · 41k → 9k 토큰 · 앞 18개 항목을 줄였어요`, "ok", "l1:context"),
        ],
        toast: toast({ title: `${T.compaction}했어요`, description: "41k → 9k 토큰" }),
      };
    case "close":
      return {
        ...s,
        menu: null,
        list: s.list.filter((t) => t.id !== a.id),
        toast: toast({
          title: `‘${title(s, a.id)}’ ${T.thread}를 닫았어요`,
          description: "닫힌 대화는 찾기에서 열 수 있어요",
          action: "되돌리기",
        }),
      };
    case "deleteOpen":
      return { ...s, menu: null, dialog: { k: "delete", id: a.id } };
    case "deleteConfirm":
      return {
        ...s,
        dialog: null,
        list: s.list.filter((t) => t.id !== a.id),
        open: s.open === a.id ? "t1" : s.open,
        toast: toast({ title: `‘${title(s, a.id)}’ ${T.thread}를 지웠어요` }),
      };
    case "deleteSchedule":
      return { ...s, menu: null, dialog: { k: "deleteSchedule" } };
    case "deleteScheduleConfirm":
      return {
        ...s,
        dialog: null,
        toast: toast({
          title: "‘매일 정리’ 예약을 지웠어요",
          description: "지난 실행 대화는 남아요",
        }),
      };
    case "exportOpen":
      return { ...s, menu: null, dialog: { k: "export", id: a.id }, exportPhase: "idle" };
    case "exportFmt":
      return { ...s, exportFmt: a.f };
    case "exportGo":
      return { ...s, exportPhase: "saving" };
    case "exportDone":
      return {
        ...s,
        dialog: null,
        exportPhase: "idle",
        toast: toast({
          title: "내보냈어요",
          description: `~/Downloads/${s.dialog?.k === "export" ? title(s, s.dialog.id) : ""}.${s.exportFmt}`,
          tone: "success",
          action: "폴더 열기",
        }),
      };
    case "exportFail":
      return { ...s, exportPhase: "fail" };
    case "dialogClose":
      return { ...s, dialog: null, exportPhase: "idle" };
    case "listLoad":
      return { ...s, listState: "loading" };
    case "listFail":
      return { ...s, listState: "error" };
    case "listRetry":
      return { ...s, listState: "loading" };
    case "listLoaded":
      return { ...s, listState: "ok", more: "shown" };
    case "moreShow":
      return { ...s, more: "shown" };
    case "more":
      return { ...s, more: "loading" };
    case "moreLoaded":
      return { ...s, more: "done", list: [...s.list, ...OLDER] };
    case "openThread":
      return { ...s, open: a.id, view: "loading" };
    case "readFail":
      return { ...s, view: "readFail" };
    case "reread":
      return { ...s, view: "rereading" };
    case "readOk":
      return { ...s, view: "ok" };
    case "scrollUp":
      return { ...s, running: true, newMsgs: 0 };
    case "tick":
      return {
        ...s,
        newMsgs: s.newMsgs + 1,
        items: [
          ...s.items,
          s.newMsgs % 3 === 0
            ? {
                k: "tool",
                name: "read",
                detail: `src/cache/part-${s.newMsgs}.ts`,
                status: "done",
                duration: "30ms",
              }
            : {
                k: "agent",
                text: `파일 ${s.newMsgs + 1}개째를 확인했어요. 같은 단위 섞임이 있는지 보고 있어요.`,
              },
        ],
      };
    case "jump":
      return { ...s, newMsgs: 0, running: false };
    case "ask":
      return { ...s, cards: { ...s.cards, [a.k]: "pending" } };
    case "decide":
      return { ...s, cards: { ...s.cards, [a.k]: a.d } };
    case "stage":
      return { ...s, stage: a.v };
  }
}

export function effect(a: A, n: S, after: After<A>) {
  switch (a.t) {
    case "start":
      if (n.script === "turn-fail-retry")
        after(900, { t: "send", text: "만료 단위 고치고 시험 돌려줘" });
      else if (n.script.startsWith("resume-")) after(900, { t: "restart" });
      else if (n.script === "list-states") after(300, { t: "listLoad" });
      else if (n.script === "read-fail") after(500, { t: "openThread", id: "t3" });
      else if (n.script === "new-messages") after(700, { t: "scrollUp" });
      else if (n.script === "approval-sync") {
        after(600, { t: "ask", k: "question" });
        after(1400, { t: "ask", k: "plan" });
        after(2200, { t: "ask", k: "review" });
      }
      return;
    case "send":
      after(1600, { t: "tool" });
      return;
    case "tool":
      after(1400, { t: "fail" });
      return;
    case "retry":
      after(1500, { t: "retryOk" });
      return;
    case "restart":
      after(2200, { t: "restarted" });
      return;
    case "resume": {
      const r =
        n.script === "resume-closed"
          ? "closed"
          : n.script === "resume-nothing"
            ? "nothing"
            : "resumed";
      after(1300, { t: "resumeResult", r });
      return;
    }
    case "exportGo":
      after(1100, n.script === "export-fail" ? { t: "exportFail" } : { t: "exportDone" });
      return;
    case "listLoad":
      after(1500, { t: "listFail" });
      return;
    case "listRetry":
      after(1200, { t: "listLoaded" });
      return;
    case "more":
      after(900, { t: "moreLoaded" });
      return;
    case "openThread":
      after(
        n.script === "read-fail" ? 1500 : 500,
        n.script === "read-fail" ? { t: "readFail" } : { t: "readOk" },
      );
      return;
    case "reread":
      after(1100, { t: "readOk" });
      return;
    case "scrollUp":
    case "tick":
      if (n.newMsgs < 11 && n.running) after(a.t === "scrollUp" ? 900 : 650, { t: "tick" });
      return;
    default:
      return;
  }
}

const start: A = { t: "start" };
export const SCRIPTS: Record<string, readonly A[]> = {
  base: [start],
  "turn-fail-retry": [
    start,
    { t: "send", text: "만료 단위 고치고 시험 돌려줘" },
    { t: "tool" },
    { t: "fail" },
    { t: "retry" },
    { t: "retryOk" },
  ],
  "resume-after-restart": [
    start,
    { t: "restart" },
    { t: "restarted" },
    { t: "resume" },
    { t: "resumeResult", r: "resumed" },
  ],
  "resume-closed": [
    start,
    { t: "restart" },
    { t: "restarted" },
    { t: "resume" },
    { t: "resumeResult", r: "closed" },
  ],
  "resume-nothing": [
    start,
    { t: "restart" },
    { t: "restarted" },
    { t: "resume" },
    { t: "resumeResult", r: "nothing" },
  ],
  "thread-menu": [
    start,
    { t: "menu", id: "t2" },
    { t: "renameOpen", id: "t2" },
    { t: "rename", id: "t2", title: "단위 테스트 정리" },
    { t: "menu", id: "t3" },
    { t: "fork", id: "t3" },
    { t: "menu", id: "t1" },
    { t: "deleteOpen", id: "t1" },
    { t: "dialogClose" },
    { t: "menu", id: "t5" },
    { t: "deleteOpen", id: "t5" },
    { t: "deleteConfirm", id: "t5" },
  ],
  "schedule-delete": [
    start,
    { t: "menu", id: "t4" },
    { t: "deleteSchedule" },
    { t: "deleteScheduleConfirm" },
  ],
  "export-thread": [
    start,
    { t: "menu", id: "t1" },
    { t: "exportOpen", id: "t1" },
    { t: "exportFmt", f: "md" },
    { t: "exportGo" },
    { t: "exportDone" },
  ],
  "export-fail": [
    start,
    { t: "menu", id: "t1" },
    { t: "exportOpen", id: "t1" },
    { t: "exportFmt", f: "json" },
    { t: "exportGo" },
    { t: "exportFail" },
  ],
  "list-states": [
    start,
    { t: "listLoad" },
    { t: "listFail" },
    { t: "listRetry" },
    { t: "listLoaded" },
    { t: "more" },
    { t: "moreLoaded" },
  ],
  "read-fail": [
    start,
    { t: "openThread", id: "t3" },
    { t: "readFail" },
    { t: "reread" },
    { t: "readOk" },
  ],
  "new-messages": [
    start,
    { t: "scrollUp" },
    ...Array.from({ length: 12 }, (): A => ({ t: "tick" })),
    { t: "jump" },
  ],
  "approval-sync": [
    start,
    { t: "ask", k: "question" },
    { t: "ask", k: "plan" },
    { t: "ask", k: "review" },
    { t: "decide", k: "tool", d: "allowed" },
    { t: "decide", k: "question", d: "answered" },
  ],
  "cards-all": [
    start,
    { t: "ask", k: "question" },
    { t: "ask", k: "plan" },
    { t: "ask", k: "review" },
  ],
};
