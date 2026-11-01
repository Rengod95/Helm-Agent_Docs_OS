// P-09 설정 보탬 행 상태 기계(목업 전용): 프레임 행과 "묻지 않기" 목록(N-27, 계획에 없음 13), 계측 행(N-28, 결정 캔버스 5),
// 언어 행(N-29), 개발 모드 행(N-30), settings slot(N-25).
import type { After } from "../_chat-rt";
import { extJ, T } from "../_shell";

export type Tab = "plugins" | "appearance";
export type Locale = "auto" | "ko" | "en";

export interface AskSkip {
  id: string;
  ext: string;
  view: string;
  action: string;
  scope: string;
}
export const ASK_SKIPS: AskSkip[] = [
  { id: "a1", ext: "acme-notes", view: "acme-notes/board", action: "노트 저장", scope: "이 기기" },
  { id: "a2", ext: "helm", view: "helm/inquiry", action: "렌즈 다시 돌리기", scope: "이 대화" },
  { id: "a3", ext: "web-exa", view: "web-exa/results", action: "결과 고정", scope: "이 기기" },
];

export interface S {
  script: string;
  tab: Tab;
  frames: boolean;
  projectFrames: boolean;
  projectFramesError: boolean;
  skips: AskSkip[];
  trace: boolean;
  traceError: boolean;
  saving: string | null;
  saved: string | null;
  locale: Locale;
  devMode: boolean;
  note: {
    id: number;
    title: string;
    body?: string;
    tone?: "neutral" | "success" | "warning" | "danger";
    to?: string;
  } | null;
}

export type A =
  | { t: "tab"; tab: Tab }
  | { t: "frames"; on: boolean }
  | { t: "projectFrames"; on: boolean }
  | { t: "rejected" }
  | { t: "askAgain"; id: string }
  | { t: "trace"; on: boolean }
  | { t: "traceFail" }
  | { t: "locale"; v: Locale }
  | { t: "devMode"; on: boolean }
  | { t: "settle" };

export const init = (script: string, tab: Tab = "plugins"): S => ({
  script,
  tab,
  frames: true,
  projectFrames: false,
  projectFramesError: false,
  skips: ASK_SKIPS,
  trace: true,
  traceError: false,
  saving: null,
  saved: null,
  locale: "ko",
  devMode: false,
  note: null,
});

const note = (
  s: S,
  title: string,
  body?: string,
  tone?: NonNullable<S["note"]>["tone"],
  to?: string,
): S["note"] => ({
  id: (s.note?.id ?? 0) + 1,
  title,
  ...(body !== undefined ? { body } : {}),
  ...(tone !== undefined ? { tone } : {}),
  ...(to !== undefined ? { to } : {}),
});

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "tab":
      return { ...s, tab: a.tab };
    case "frames":
      return { ...s, frames: a.on, saved: "frames" };
    case "projectFrames":
      return s.script === "settings-frames-fail" && a.on
        ? { ...s, projectFrames: true, saving: "projectFrames" }
        : { ...s, projectFrames: a.on, saved: "projectFrames", projectFramesError: false };
    case "rejected":
      return { ...s, projectFrames: false, saving: null, projectFramesError: true };
    case "askAgain": {
      const x = s.skips.find((k) => k.id === a.id);
      return {
        ...s,
        skips: s.skips.filter((k) => k.id !== a.id),
        note: note(
          s,
          `다시 물어요`,
          x !== undefined
            ? `${extJ(x.ext, "이", "가")} "${x.action}"을 하려 하면 확인 줄을 띄워요`
            : undefined,
          "neutral",
        ),
      };
    }
    case "trace":
      if (s.script === "trace-off-fail" && !a.on) return { ...s, trace: false, saving: "trace" };
      return {
        ...s,
        trace: a.on,
        traceError: false,
        saved: "trace",
        ...(a.on
          ? {}
          : {
              note: note(
                s,
                `${T.instrumentation}을 껐어요`,
                `${T.turnReplay}가 잠겼어요. 이미 남은 기록은 지웠어요.`,
                "neutral",
                "c01-trials",
              ),
            }),
      };
    case "traceFail":
      return { ...s, trace: true, saving: null, traceError: true };
    case "locale":
      return { ...s, locale: a.v, saving: "locale", saved: null };
    case "devMode":
      return { ...s, devMode: a.on, saved: "devMode" };
    case "settle":
      return { ...s, saving: null, saved: s.saving ?? s.saved };
  }
}

export function effect(a: A, n: S, after: After<A>) {
  if (a.t === "projectFrames" && n.saving === "projectFrames") after(900, { t: "rejected" });
  if (a.t === "trace" && n.saving === "trace") after(900, { t: "traceFail" });
  if (a.t === "locale") after(700, { t: "settle" });
}

export const SCRIPTS: Record<string, readonly A[]> = {
  // 프레임 끄기 → "묻지 않기" 하나 되돌리기
  "settings-frames": [
    { t: "frames", on: false },
    { t: "askAgain", id: "a2" },
  ],
  // 실패: 프로젝트 확장의 자체 코드 화면 허용을 관리 정책이 거부
  "settings-frames-fail": [{ t: "projectFrames", on: true }, { t: "rejected" }],
  // 계측 끄기 → 턴 다시 보기 잠김
  "trace-off": [{ t: "trace", on: false }],
  // 실패: 엔진이 저장을 거부(연결 끊김)
  "trace-off-fail": [{ t: "trace", on: false }, { t: "traceFail" }],
  // 영어로 바꾸기 → 다시 시작하면 적용 배지
  "locale-switch": [{ t: "tab", tab: "appearance" }, { t: "locale", v: "en" }, { t: "settle" }],
  // 실패 갈래: 자동(OS)인데 OS 언어가 지원 밖 → 영어로 대신
  "locale-auto-fallback": [
    { t: "tab", tab: "appearance" },
    { t: "locale", v: "auto" },
    { t: "settle" },
  ],
  base: [],
  dev: [{ t: "devMode", on: true }],
};
