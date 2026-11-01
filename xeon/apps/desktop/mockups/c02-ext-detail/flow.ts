// P-17 확장 상세 상태 기계(목업 전용). 버전 탭과 되돌리기(spec §6.24.1, O-11 §6.31, 결정 6), 설정 탭 값 출처(N-32),
// 화면 탭(N-33), 기록 탭 진단 위치(N-34), X 훅(N-36, 결정 12).
import type { After } from "../_chat-rt";
import { extJ } from "../_shell";
import { helmHistory, type VersionEntry } from "../_wb-c/data";

export type Tab =
  | "overview"
  | "points"
  | "lease"
  | "settings"
  | "metrics"
  | "log"
  | "versions"
  | "views"
  | "hooks";
export type RevertStep = "closed" | "confirm" | "off" | "files" | "migrate" | "enable" | "rollback";
export type RevertResult = null | "done" | "failed" | "cleared" | "code";

export interface S {
  script: string;
  ext: string;
  tab: Tab;
  web: boolean;
  safe: boolean;
  /** 되돌릴 버전(대화 상자) */
  target: string;
  revert: RevertStep;
  /** 형식 변환이 없을 때 고른 길: clear = 저장 데이터를 비움, code = 코드만 */
  mode: "migrate" | "clear" | "code";
  result: RevertResult;
  history: VersionEntry[];
  /** 화면 다시 켜기 */
  reenabled: boolean;
  note: {
    id: number;
    title: string;
    body?: string;
    tone?: "neutral" | "success" | "warning" | "danger";
  } | null;
}

export type A =
  | { t: "tab"; tab: Tab }
  | { t: "ask"; version: string }
  | { t: "cancel" }
  | { t: "go"; mode?: "clear" | "code" }
  | { t: "files" }
  | { t: "migrate" }
  | { t: "enable" }
  | { t: "done" }
  | { t: "fail" }
  | { t: "rolledBack" }
  | { t: "reenableView" };

export const SCHEMA: Record<string, number> = Object.fromEntries(
  helmHistory.map((v) => [v.version, v.schema]),
);
/** 내려가는 형식 변환이 있는 쌍(지금 3 → 2만). */
export const hasDown = (from: number, to: number) => from === to || (from === 3 && to === 2);

export const init = (script: string, ext = "helm", tab: Tab = "versions"): S => ({
  script,
  ext,
  tab,
  web: false,
  safe: false,
  target: "0.0.9",
  revert: "closed",
  mode: "migrate",
  result: null,
  history: helmHistory,
  reenabled: false,
  note: null,
});

const note = (
  s: S,
  title: string,
  body?: string,
  tone?: NonNullable<S["note"]>["tone"],
): S["note"] => ({
  id: (s.note?.id ?? 0) + 1,
  title,
  ...(body !== undefined ? { body } : {}),
  ...(tone !== undefined ? { tone } : {}),
});

const current = (s: S) => s.history.find((v) => v.current === true)?.version ?? "0.1.0";

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "tab":
      return { ...s, tab: a.tab };
    case "ask":
      return { ...s, target: a.version, revert: "confirm", result: null };
    case "cancel":
      return { ...s, revert: "closed" };
    case "go":
      return s.revert === "confirm" ? { ...s, revert: "off", mode: a.mode ?? "migrate" } : s;
    case "files":
      return { ...s, revert: "files" };
    case "migrate":
      return { ...s, revert: "migrate" };
    case "enable":
      return { ...s, revert: "enable" };
    case "done": {
      const cleared = s.mode === "clear";
      return {
        ...s,
        revert: "closed",
        result: cleared ? "cleared" : s.mode === "code" ? "code" : "done",
        history: s.history.map((v) => ({ ...v, current: v.version === s.target })),
        note: note(
          s,
          `${extJ(s.ext, "을", "를")} ${s.target}로 되돌렸어요`,
          cleared
            ? "저장 데이터를 비웠어요 · 이번 단계가 끝나면 켜져요"
            : s.mode === "code"
              ? "저장 데이터는 남겨 뒀어요 · 이번 단계가 끝나면 켜져요"
              : "저장 형식 3 → 2 · 이번 단계가 끝나면 켜져요",
          "success",
        ),
      };
    }
    case "fail":
      return { ...s, revert: "rollback" };
    case "rolledBack":
      return {
        ...s,
        revert: "closed",
        result: "failed",
        note: note(
          s,
          "되돌리지 못했어요",
          `${current(s)}로 돌려 놨어요 · 저장 데이터는 그대로예요`,
          "danger",
        ),
      };
    case "reenableView":
      return {
        ...s,
        reenabled: true,
        note: note(s, "화면을 다시 켰어요", "helm/suggested · 실패 기록을 비웠어요", "neutral"),
      };
  }
}

export function effect(a: A, n: S, after: After<A>) {
  switch (a.t) {
    case "go":
      after(900, { t: "files" });
      return;
    case "files":
      after(1000, { t: "migrate" });
      return;
    case "migrate":
      after(1300, n.script === "revert-fail" ? { t: "fail" } : { t: "enable" });
      return;
    case "enable":
      after(1100, { t: "done" });
      return;
    case "fail":
      after(1400, { t: "rolledBack" });
      return;
    default:
      return;
  }
}

export const SCRIPTS: Record<string, readonly A[]> = {
  // O-11 → 진행 → 끝
  revert: [
    { t: "ask", version: "0.0.9" },
    { t: "go" },
    { t: "files" },
    { t: "migrate" },
    { t: "enable" },
    { t: "done" },
  ],
  // 실패: 형식 변환 실패 → 이전 파일로 원복
  "revert-fail": [
    { t: "ask", version: "0.0.9" },
    { t: "go" },
    { t: "files" },
    { t: "migrate" },
    { t: "fail" },
    { t: "rolledBack" },
  ],
  // 내려가는 변환이 없음 → 저장 데이터를 비우고 되돌리기
  "revert-no-migration": [
    { t: "ask", version: "0.0.6" },
    { t: "go", mode: "clear" },
    { t: "files" },
    { t: "migrate" },
    { t: "enable" },
    { t: "done" },
  ],
  // 화면 탭: 꺼진 화면 다시 켜기
  "views-reenable": [{ t: "tab", tab: "views" }, { t: "reenableView" }],
  base: [],
};
