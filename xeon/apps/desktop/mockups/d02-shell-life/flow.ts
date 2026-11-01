// 셸 수명 상태 기계(목업 전용). 엔진 실패·재기동(N-54), 안전 모드 제안·표시(N-55, N-56, 계획에 없음 5), 앱 업데이트(계획에 없음 1),
// 진행 중·백그라운드 작업(N-58, 계획에 없음 10), 토스트 자리(S-04, 결정 14), OS 알림(N-53), 메뉴 막대·앱 메뉴(N-51, N-52).
// ?state=, ?scenario=, &step=을 한 기계로 돌린다(_chat-rt useMachine).
import { josa, T } from "../_shell";
import type { After, ChatItem } from "../_chat-rt";
import type { OsKind } from "./parts/os-chrome";
import type { Upd } from "./parts/life";

export type Engine = "running" | "restarting" | "failed" | "starting-safe";

export interface Toast {
  n: number;
  title: string;
  description?: string;
  tone?: "neutral" | "danger" | "success";
  action?: string;
}

export interface S {
  script: string;
  open: "t1" | "t2" | "t3";
  engine: Engine;
  attempt: number;
  suggest: boolean;
  busy: "safe" | "retry" | null;
  safe: boolean;
  reattach: "none" | "blank";
  upd: Upd;
  pct: number;
  confirm: boolean;
  running: boolean;
  items: ChatItem[];
  bgFail: boolean;
  os: OsKind[];
  perm: "granted" | "denied";
  focusCard: boolean;
  view: "chat" | "settings";
  well: boolean | null;
  toast: Toast | null;
  web: boolean;
}

export type A =
  | { t: "start" }
  | { t: "crash" }
  | { t: "back" }
  | { t: "failAgain" }
  | { t: "retryEngine" }
  | { t: "safeStart" }
  | { t: "safeUp" }
  | { t: "safeOff" }
  | { t: "copyDiag" }
  | { t: "blank" }
  | { t: "reattached" }
  | { t: "updAvail" }
  | { t: "download" }
  | { t: "pct"; v: number }
  | { t: "ready" }
  | { t: "failDownload" }
  | { t: "failSignature" }
  | { t: "apply" }
  | { t: "confirmClose" }
  | { t: "afterTurn" }
  | { t: "applyNow" }
  | { t: "applied" }
  | { t: "os"; k: OsKind }
  | { t: "osOpen"; k: OsKind }
  | { t: "osClose"; k: OsKind }
  | { t: "denied" }
  | { t: "openSettings" }
  | { t: "decide" }
  | { t: "bgFail" }
  | { t: "go"; id: "t1" | "t2" | "t3" }
  | { t: "well"; open: boolean }
  | {
      t: "toast";
      title: string;
      description?: string;
      tone?: "neutral" | "danger" | "success";
      action?: string;
    };

let n = 0;
const mk = (t: Omit<Toast, "n">): Toast => ({ ...t, n: ++n });
const row = (
  text: string,
  icon: "ok" | "warn" | "clock" | "play" | "step" | "danger",
  source = "core",
  tone?: "warning" | "danger",
): ChatItem => ({
  k: "row",
  text,
  source,
  icon,
  ...(tone !== undefined ? { tone } : {}),
});

export const init = (script: string): S => ({
  script,
  open: script === "notifications" || script === "notifications-denied" ? "t2" : "t1",
  engine: "running",
  attempt: 0,
  suggest: false,
  busy: null,
  safe: false,
  reattach: "none",
  upd: "none",
  pct: 0,
  confirm: false,
  running: true,
  items: [],
  bgFail: false,
  os: [],
  perm: script === "notifications-denied" ? "denied" : "granted",
  focusCard: false,
  view: "chat",
  well: null,
  toast: null,
  web: false,
});

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "start":
      return s;
    case "crash":
      return {
        ...s,
        engine: "restarting",
        attempt: 1,
        running: false,
        items: [
          ...s.items,
          row(
            `${josa(T.engine, "이", "가")} 멈췄어요 · 종료 코드 137(메모리) · 다시 시작해요`,
            "warn",
            "core",
            "warning",
          ),
        ],
      };
    case "back":
      return {
        ...s,
        engine: "running",
        attempt: 0,
        busy: null,
        items: [
          ...s.items,
          row(`${josa(T.engine, "이", "가")} 다시 시작됐어요 · 멈춘 ${T.turn} 1`, "ok"),
          {
            k: "row",
            text: `멈춘 ${josa(T.turn, "이", "가")} 있어요 · 14:02 시작`,
            source: "core",
            icon: "clock",
            action: { label: T.resume, onClick: () => {} },
          },
        ],
      };
    case "failAgain": {
      const next = s.attempt + 1;
      if (next > 3) return { ...s, engine: "failed", attempt: 3, suggest: true, busy: null };
      return { ...s, attempt: next, busy: null };
    }
    case "retryEngine":
      return { ...s, engine: "restarting", attempt: 3, busy: "retry" };
    case "safeStart":
      return { ...s, busy: "safe", engine: "starting-safe" };
    case "safeUp":
      return {
        ...s,
        engine: "running",
        busy: null,
        suggest: false,
        safe: true,
        attempt: 0,
        items: [
          ...s.items,
          row(
            `${josa(T.safeMode, "으로", "로")} 시작했어요 · ${T.group} 3, ${T.extension} 2, ${T.xHook} 2를 싣지 않았어요`,
            "warn",
            "core",
            "warning",
          ),
          {
            k: "row",
            text: `멈춘 ${josa(T.turn, "이", "가")} 있어요 · ${josa(T.safeMode, "이라", "라")} Helm 없이 이어가요`,
            source: "core",
            icon: "clock",
            action: { label: T.resume, onClick: () => {} },
          },
        ],
        toast: mk({
          title: `${josa(T.safeMode, "으로", "로")} 시작했어요`,
          description: "Acme 노트를 끄거나 고친 뒤 다시 시작하세요",
        }),
      };
    case "safeOff":
      return { ...s, safe: false, engine: "restarting", attempt: 1 };
    case "copyDiag":
      return {
        ...s,
        toast: mk({ title: "진단을 복사했어요", description: "비밀 값은 빼고 복사했어요" }),
      };
    case "blank":
      return { ...s, reattach: "blank" };
    case "reattached":
      return {
        ...s,
        reattach: "none",
        items: [
          ...s.items,
          row(`화면을 다시 붙였어요 · 진행 중 ${josa(T.turn, "은", "는")} 계속됐어요`, "ok"),
        ],
        toast: mk({
          title: "화면을 다시 불러왔어요",
          description: `진행 중 ${josa(T.turn, "은", "는")} 끊기지 않았어요`,
        }),
      };
    case "updAvail":
      return { ...s, upd: "available", pct: 0 };
    case "download":
      return { ...s, upd: "downloading", pct: 4 };
    case "pct":
      return { ...s, pct: a.v };
    case "ready":
      return { ...s, upd: "ready", pct: 100 };
    case "failDownload":
      return {
        ...s,
        upd: "failDownload",
        toast: mk({
          title: "업데이트를 내려받지 못했어요",
          description: "연결이 끊겼어요 · 다시 시도할 수 있어요",
          tone: "danger",
        }),
      };
    case "failSignature":
      return {
        ...s,
        upd: "failSignature",
        toast: mk({
          title: "업데이트를 설치하지 않았어요",
          description: "서명이 맞지 않아요 · 받은 파일을 지웠어요",
          tone: "danger",
          action: "진단 복사",
        }),
      };
    case "apply":
      return s.running ? { ...s, confirm: true } : { ...s, upd: "applying" };
    case "confirmClose":
      return { ...s, confirm: false };
    case "afterTurn":
      return {
        ...s,
        confirm: false,
        toast: mk({
          title: `${josa(T.turn, "이", "가")} 끝나면 다시 시작해요`,
          description: "0.4.2 · 받아 둔 파일로",
        }),
      };
    case "applyNow":
      return { ...s, confirm: false, upd: "applying", running: false };
    case "applied":
      return {
        ...s,
        upd: "done",
        items: [
          ...s.items,
          row(`0.4.2로 다시 시작했어요 · 멈춘 ${T.turn} 1`, "ok"),
          {
            k: "row",
            text: `멈춘 ${josa(T.turn, "이", "가")} 있어요 · 14:02 시작`,
            source: "core",
            icon: "clock",
            action: { label: T.resume, onClick: () => {} },
          },
        ],
        toast: mk({ title: "0.4.2로 업데이트했어요", action: "바뀐 점" }),
      };
    case "os":
      return { ...s, os: s.os.includes(a.k) ? s.os : [...s.os, a.k] };
    case "osClose":
      return { ...s, os: s.os.filter((k) => k !== a.k) };
    case "osOpen":
      return {
        ...s,
        os: s.os.filter((k) => k !== a.k),
        open: a.k === "approval_waiting" ? "t1" : a.k === "question_waiting" ? "t2" : "t3",
        focusCard: a.k === "approval_waiting",
        view: "chat",
      };
    case "denied":
      return {
        ...s,
        toast: mk({
          title: `${josa(T.osNotice, "이", "가")} 꺼져 있어요`,
          description: "시스템 설정에서 Xeon 알림을 허용하면 창 밖에서도 알려 드려요",
          action: "설정 보기",
        }),
      };
    case "openSettings":
      return { ...s, view: "settings" };
    case "decide":
      return {
        ...s,
        focusCard: false,
        items: [...s.items, row("bash 실행을 허용했어요 · 1번만", "ok")],
      };
    case "bgFail":
      return {
        ...s,
        bgFail: true,
        toast: mk({
          title: "예약 실패: 매일 정리",
          description: "rate_limited · 10분 뒤 다시 시도해요",
          tone: "danger",
          action: "열기",
        }),
      };
    case "go":
      return { ...s, open: a.id, view: "chat" };
    case "well":
      return { ...s, well: a.open };
    case "toast": {
      const { t: _t, ...rest } = a;
      return { ...s, toast: mk(rest) };
    }
  }
}

export function effect(a: A, s: S, after: After<A>) {
  const sc = s.script;
  switch (a.t) {
    case "start":
      if (sc === "engine-crash" || sc === "engine-crash-safe") after(1500, { t: "crash" });
      else if (sc === "webview-reattach") after(1500, { t: "blank" });
      else if (sc === "app-update" || sc === "app-update-fail") after(1000, { t: "updAvail" });
      else if (sc === "notifications") after(1500, { t: "os", k: "approval_waiting" });
      else if (sc === "notifications-denied") after(1500, { t: "denied" });
      else if (sc === "background-work") after(4000, { t: "bgFail" });
      else if (sc === "toast-well") {
        after(800, {
          t: "toast",
          title: "학습 검토 끝: 후보 3",
          description: "받은 요청에 제안 3개",
        });
        after(2200, { t: "well", open: false });
        after(1200, { t: "toast", title: "복사했어요", tone: "success" });
        after(2200, { t: "well", open: true });
        after(1200, {
          t: "toast",
          title: "예약 실패: 매일 정리",
          description: "rate_limited",
          tone: "danger",
          action: "열기",
        });
      }
      return;
    case "crash":
      after(2600, sc === "engine-crash-safe" ? { t: "failAgain" } : { t: "back" });
      return;
    case "failAgain":
      if (s.engine === "restarting") after(2200, { t: "failAgain" });
      return;
    case "retryEngine":
      after(1800, { t: "failAgain" });
      return;
    case "safeStart":
      after(2000, { t: "safeUp" });
      return;
    case "safeOff":
      after(2000, { t: "back" });
      return;
    case "blank":
      after(1600, { t: "reattached" });
      return;
    case "download": {
      // app-update-fail: 첫 내려받기는 21%에서 연결 끊김, "다시 시도"는 끝까지 받지만 서명이 맞지 않음.
      const second = failedOnce.v;
      if (sc === "app-update-fail") failedOnce.v = true;
      const steps =
        sc !== "app-update-fail" ? [18, 37, 58, 79, 100] : second ? [34, 71, 100] : [12, 21];
      let at = 0;
      for (const v of steps) {
        at += 500;
        after(at, { t: "pct", v });
      }
      after(
        at + 300,
        sc !== "app-update-fail"
          ? { t: "ready" }
          : second
            ? { t: "failSignature" }
            : { t: "failDownload" },
      );
      return;
    }
    case "applyNow":
      after(2200, { t: "applied" });
      return;
    case "os":
      return;
    default:
      return;
  }
}

/** app-update-fail: 첫 내려받기는 연결 끊김, 다시 시도하면 서명 불일치(목업 전용 카운터). */
const failedOnce = { v: false };

const start: A = { t: "start" };
export const SCRIPTS: Record<string, readonly A[]> = {
  base: [start],
  "engine-crash": [start, { t: "crash" }, { t: "back" }],
  "engine-crash-safe": [
    start,
    { t: "crash" },
    { t: "failAgain" },
    { t: "failAgain" },
    { t: "failAgain" },
    { t: "safeStart" },
    { t: "safeUp" },
  ],
  "webview-reattach": [start, { t: "blank" }, { t: "reattached" }],
  "app-update": [
    start,
    { t: "updAvail" },
    { t: "download" },
    { t: "pct", v: 58 },
    { t: "ready" },
    { t: "apply" },
    { t: "applyNow" },
    { t: "applied" },
  ],
  "app-update-fail": [
    start,
    { t: "updAvail" },
    { t: "download" },
    { t: "pct", v: 21 },
    { t: "failDownload" },
    { t: "download" },
    { t: "failSignature" },
  ],
  notifications: [
    start,
    { t: "os", k: "approval_waiting" },
    { t: "osOpen", k: "approval_waiting" },
    { t: "decide" },
  ],
  "notifications-denied": [start, { t: "denied" }, { t: "openSettings" }],
  "background-work": [start, { t: "bgFail" }, { t: "go", id: "t3" }],
  "toast-well": [
    start,
    { t: "toast", title: "학습 검토 끝: 후보 3", description: "받은 요청에 제안 3개" },
    { t: "well", open: false },
    { t: "toast", title: "복사했어요", tone: "success" },
    { t: "well", open: true },
    {
      t: "toast",
      title: "예약 실패: 매일 정리",
      description: "rate_limited",
      tone: "danger",
      action: "열기",
    },
  ],
  "os-all": [
    start,
    { t: "os", k: "approval_waiting" },
    { t: "os", k: "question_waiting" },
    { t: "os", k: "background_completed" },
    { t: "os", k: "error" },
  ],
};
