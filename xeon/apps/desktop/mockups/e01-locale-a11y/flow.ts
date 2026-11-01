// e01 상태 기계(목업 전용): 영어 스모크(N-49)와 접근성(N-50). ?state=, ?scenario=, &step=을 한 기계로 돌린다(_chat-rt useMachine).
// 초점 정류장(stop) 1~5 = 찾기·영역 바꾸기 → 보기 기준 칸(작업대)·내비 → 가운데 → well → 상태 표시줄(§4.8, Y14).
import { L2, LANG, type Decision } from "../_shell";
import type { After } from "../_chat-rt";

export type View = "chat" | "wb" | "settings";
export type Contrast = "off" | "broken" | "fixed";

/** 화면 낭독기가 읽는 문장 하나(aria-live polite 또는 role=alert). 목업은 개발용 자막으로도 보인다. */
export interface Cap {
  n: number;
  text: string;
  kind: "polite" | "alert";
}

export interface S {
  view: View;
  /** 지금 초점 정류장(0이면 없음). */
  stop: number;
  /** 정류장 3에서 초점이 입력창에 있는지(승인 카드가 아니라). */
  inComposer: boolean;
  /** 프로그램이 초점을 옮길 때마다 늘린다(App의 effect가 이 값으로 초점을 옮긴다). */
  focusReq: number;
  overlay: boolean;
  decision: Decision;
  draft: string;
  answered: boolean;
  caps: Cap[];
  captions: boolean;
  reduced: boolean;
  contrast: Contrast;
  /** 설정 화면 언어 Select 값과 바꾸는 중. */
  langPick: "system" | "ko" | "en";
  langBusy: boolean;
  langFailed: boolean;
  toast: { n: number; title: string; tone: "neutral" | "danger" | "success" } | null;
  pop: string | null;
}

export type A =
  | { t: "start" }
  | { t: "view"; v: View }
  | { t: "overlay"; on: boolean }
  | { t: "focus"; stop: number; composer?: boolean }
  | { t: "at"; stop: number; composer: boolean }
  | { t: "decide"; d: "allowed" | "always" | "denied" }
  | { t: "typeY" }
  | { t: "approvalNext" }
  | { t: "agentDone" }
  | { t: "captions"; on: boolean }
  | { t: "reduced"; on: boolean }
  | { t: "contrast"; c: Contrast }
  | { t: "lang"; v: "system" | "ko" | "en"; fail?: boolean }
  | { t: "langOk" }
  | { t: "langFail" };

export function init(): S {
  return {
    view: "chat",
    stop: 0,
    inComposer: false,
    focusReq: 0,
    overlay: false,
    decision: "pending",
    draft: "",
    answered: false,
    caps: [],
    captions: false,
    reduced: false,
    contrast: "off",
    langPick: LANG === "en" ? "en" : "system",
    langBusy: false,
    langFailed: false,
    toast: null,
    pop: null,
  };
}

let capN = 0;
function cap(s: S, text: string, kind: Cap["kind"] = "polite"): Cap[] {
  capN += 1;
  return [...s.caps, { n: capN, text, kind }].slice(-5);
}

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "start":
      return s;
    case "view":
      return { ...s, view: a.v, stop: 0 };
    case "overlay":
      return { ...s, overlay: a.on, captions: a.on || s.captions };
    case "focus":
      return { ...s, stop: a.stop, inComposer: a.composer === true, focusReq: s.focusReq + 1 };
    case "at":
      return s.stop === a.stop && s.inComposer === a.composer
        ? s
        : { ...s, stop: a.stop, inComposer: a.composer };
    case "decide": {
      const text =
        a.d === "denied"
          ? L2("bash 실행을 거부했어요", "Denied the bash run")
          : a.d === "always"
            ? L2("bash를 이 대화에서 항상 허용해요", "bash is always allowed in this conversation")
            : L2("bash 실행을 허용했어요 · 한 번", "Allowed the bash run once");
      return {
        ...s,
        decision: a.d,
        // 답한 뒤 초점은 입력창으로(카드가 사라져 초점을 잃지 않게).
        inComposer: true,
        focusReq: s.focusReq + 1,
        caps: cap(s, `${text}. ${L2("승인 대기 0개", "0 approvals waiting")}`),
      };
    }
    case "typeY":
      return {
        ...s,
        draft: `${s.draft}y`,
        caps: cap(
          s,
          L2(
            "입력란 안이라 Y는 글자로 들어갔어요(승인은 입력란 밖에서만)",
            "Y was typed as a letter: approval keys work only outside text fields",
          ),
          "alert",
        ),
      };
    case "approvalNext":
      return {
        ...s,
        stop: 3,
        inComposer: false,
        focusReq: s.focusReq + 1,
        caps: cap(
          s,
          L2(
            "승인 카드: bash, 위험도 exec. 캐시 무효화 조사",
            "Approval card: bash, risk exec. Investigate cache invalidation",
          ),
        ),
      };
    case "agentDone":
      return {
        ...s,
        answered: true,
        caps: cap(
          s,
          L2(
            "답이 왔어요: 캐시를 지우고 시험 12개가 모두 통과해요",
            "Reply: cleared the cache and all 12 tests pass",
          ),
        ),
      };
    case "captions":
      return { ...s, captions: a.on };
    case "reduced":
      return { ...s, reduced: a.on };
    case "contrast":
      return { ...s, contrast: a.c };
    case "lang":
      return { ...s, langPick: a.v, langBusy: a.v === "en" && LANG !== "en", langFailed: false };
    case "langOk":
      return {
        ...s,
        langBusy: false,
        toast: {
          n: s.focusReq + 100,
          title: L2("화면 언어를 바꿨어요", "Display language changed"),
          tone: "success",
        },
      };
    case "langFail":
      return {
        ...s,
        langBusy: false,
        langFailed: true,
        langPick: "system",
        caps: cap(
          s,
          L2(
            "영어 문구 묶음을 읽지 못해 한국어로 둬요",
            "Couldn't load the English strings, staying in Korean",
          ),
          "alert",
        ),
        toast: {
          n: s.focusReq + 200,
          title: L2("영어 문구 묶음을 읽지 못했어요", "Couldn't load the English strings"),
          tone: "danger",
        },
      };
  }
}

/** 대본: ?scenario=<id>, 정적 상태는 대본의 앞 n개. */
export const SCRIPTS: Record<string, readonly A[]> = {
  base: [],
  "keyboard-only": [
    { t: "overlay", on: true },
    { t: "focus", stop: 1 },
    { t: "focus", stop: 2 },
    { t: "focus", stop: 3 },
    { t: "decide", d: "allowed" },
    { t: "agentDone" },
    { t: "focus", stop: 4 },
    { t: "focus", stop: 5 },
  ],
  "keyboard-only-fail": [
    { t: "overlay", on: true },
    { t: "focus", stop: 3, composer: true },
    { t: "typeY" },
    { t: "approvalNext" },
    { t: "decide", d: "denied" },
  ],
  "lang-switch": [{ t: "view", v: "settings" }, { t: "lang", v: "en" }, { t: "langOk" }],
  "lang-switch-fail": [
    { t: "view", v: "settings" },
    { t: "lang", v: "en", fail: true },
    { t: "langFail" },
  ],
  "keyboard-live": [
    { t: "overlay", on: true },
    { t: "focus", stop: 1 },
    { t: "focus", stop: 2 },
    { t: "focus", stop: 3 },
    { t: "decide", d: "allowed" },
    { t: "agentDone" },
    { t: "overlay", on: false },
    { t: "captions", on: true },
  ],
  "wb-focus": [
    { t: "view", v: "wb" },
    { t: "overlay", on: true },
    { t: "focus", stop: 2 },
  ],
};

export function effect(a: A, s: S, after: After<A>): void {
  switch (a.t) {
    case "decide":
      if (a.d !== "denied") after(1800, { t: "agentDone" });
      return;
    case "lang":
      if (a.v === "en" && LANG !== "en")
        after(900, a.fail === true ? { t: "langFail" } : { t: "langOk" });
      return;
    case "langOk":
      // 목업: 언어는 모듈을 읽을 때 정해지므로 ?lang=en으로 다시 읽는다. 다시 읽은 뒤에는 LANG이 en이라 그대로 멈춘다.
      if (LANG !== "en") {
        const url = new URL(window.location.href);
        url.searchParams.set("lang", "en");
        if (url.searchParams.has("scenario")) url.searchParams.set("step", "3");
        window.location.assign(url.toString());
      }
      return;
    default:
      void s;
  }
}
