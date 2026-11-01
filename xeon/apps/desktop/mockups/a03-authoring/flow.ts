// 대화에서 제작(authoring) 상태 기계(목업 전용). L3.authoring.spec §4.1(단계 intent→compose→scaffold→validate⇄fix→trial→(replay)→package),
// §4.2(쓰기 범위 가드), §5(실패), 결정 1(화면 방식은 에이전트가 고름), 결정 4·10(replay는 개발 모드만, 자동 replay 없음),
// 결정 캔버스 8(사람 확인 = drive 원시 loop.ask, 기다리는 동안 진행권 반납). 확인 카드 다섯: 종류·이름, 고치기 한도, 시험 비용, 묶기 전, 연결 전.
import { T, josa } from "../_shell";
import type { After, ChatItem } from "../_chat-rt";

export type Stage =
  | "idle"
  | "intent"
  | "compose"
  | "scaffold"
  | "validate"
  | "fix"
  | "trial"
  | "package"
  | "done"
  | "stopped";

export type AskKey = "kind" | "fix" | "trial" | "package" | "link";
export type AskState = "pending" | "done" | "declined";

export interface S {
  script: string;
  stage: Stage;
  ext: "off" | "on" | "safe";
  asks: Partial<Record<AskKey, AskState>>;
  /** 종류 확인에서 고른 것(kind id). */
  kind: string;
  fixes: number;
  linked: boolean;
  /** 결과 카드의 화면 방식(에이전트가 고른 것): 선언형 well 또는 프레임 page. */
  view: "declarative" | "frame";
  items: ChatItem[];
}

export type A =
  | { t: "start" }
  | { t: "user"; text: string }
  | { t: "offReply" }
  | { t: "enable" }
  | { t: "intent" }
  | { t: "blocked" }
  | { t: "askKind" }
  | { t: "answerKind"; kind: string }
  | { t: "compose" }
  | { t: "scaffold" }
  | { t: "scopeDenied" }
  | { t: "validate" }
  | { t: "validateFail" }
  | { t: "fix" }
  | { t: "askFix" }
  | { t: "fixStop" }
  | { t: "fixRedo" }
  | { t: "askTrial" }
  | { t: "trialYes" }
  | { t: "trialSkip" }
  | { t: "trialDone" }
  | { t: "askPackage" }
  | { t: "packageYes" }
  | { t: "packageNo" }
  | { t: "result" }
  | { t: "askLink" }
  | { t: "linkYes" }
  | { t: "linkNo" }
  | { t: "replay" }
  | { t: "stop" };

export const NAME = "daily-digest";
export const DISPLAY = "아침 요약";
export const DIR = `~/code/xeon-ext/${NAME}`;
export const PROMPT = "매일 아침 열린 PR과 실패한 예약을 모아 요약해 주는 그룹 만들어줘";
export const PROMPT_HOOK = "도구 호출마다 감사 기록을 남기는 X 훅 만들어줘";
export const SRC = "grp:authoring";

export const STAGES: { id: Stage; label: string }[] = [
  { id: "intent", label: T.stageIntent },
  { id: "compose", label: T.stageCompose },
  { id: "scaffold", label: T.stageScaffold },
  { id: "validate", label: T.stageValidate },
  { id: "trial", label: T.trial },
  { id: "package", label: T.stagePackage },
];

const LEAD_O = josa(T.lead, "을", "를");
const GATE_O = josa(T.humanGate, "을", "를");

const row = (
  text: string,
  icon:
    | "author"
    | "ask"
    | "lease"
    | "danger"
    | "warn"
    | "ok"
    | "lock"
    | "stop"
    | "flask" = "author",
  tone?: "danger" | "warning" | "success",
  source = SRC,
): ChatItem => ({ k: "row", text, source, icon, ...(tone !== undefined ? { tone } : {}) });

const waitRow = row(`authoring이 ${GATE_O} 기다려요 · ${T.lead} ${T.leadReturn}`, "ask");
const retakeRow = (what: string) => row(`${what} · authoring이 ${LEAD_O} ${T.leadRetake}`, "lease");

export const init = (script: string): S => ({
  script,
  stage: "idle",
  ext: script === "authoring-off" ? "off" : script === "authoring-safe" ? "safe" : "on",
  asks: {},
  kind: "group.drive",
  fixes: 0,
  linked: false,
  view: script === "authoring-frame" ? "frame" : "declarative",
  items: [],
});

const add = (s: S, ...xs: ChatItem[]): S => ({ ...s, items: [...s.items, ...xs] });

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "start":
      return s;
    case "user":
      return add(s, { k: "user", text: a.text });
    case "offReply":
      if (s.ext === "safe")
        return add(
          s,
          {
            k: "agent",
            text: `지금은 ${T.safeMode}라 ${T.authoringExt}이 빠져 있어요. 그룹, 외부 확장, X 훅이 모두 꺼진 상태예요.`,
          },
          { k: "node", key: "safe-row", node: null },
        );
      return add(
        s,
        {
          k: "agent",
          text: `그룹을 만들려면 ${josa(T.authoringExt, "이", "가")} 필요해요. 지금은 꺼져 있어요.`,
        },
        { k: "node", key: "enable-row", node: null },
      );
    case "enable":
      if (s.ext !== "off") return s;
      return add(
        { ...s, ext: "on" },
        row(
          `${josa(T.authoringExt, "을", "를")} 켰어요 · 이 ${T.thread}에서 · 다음 ${T.stepBoundary}에 적용`,
          "ok",
          undefined,
          "core",
        ),
      );
    case "intent":
      return add(
        { ...s, stage: "intent" },
        row(`authoring이 ${LEAD_O} 받았어요 · ${T.stageIntent}`, "lease"),
        {
          k: "agent",
          live: true,
          text:
            s.script === "authoring-blocked"
              ? `X 훅으로 만들려면 ${T.kind} x.hook이 필요해요.`
              : `매일 정해진 시각에 PR과 예약을 읽고 요약을 남기는 일이라 턴을 직접 구동하는 의도 ${T.group}(group.drive)이 맞아요.`,
        },
      );
    case "blocked":
      return add(
        s,
        row(
          `${T.kind} x.hook은 ${T.catalogBlocked}이에요 · 외부 훅 규약이 정해지면 열려요`,
          "lock",
          "warning",
          SRC,
        ),
        {
          k: "agent",
          live: true,
          text: `대신 tool.call.after를 보는 관찰 ${T.group}(group.observe)으로 같은 기록을 남길 수 있어요.`,
        },
      );
    case "askKind":
      return add({ ...s, asks: { ...s.asks, kind: "pending" } }, waitRow, {
        k: "node",
        key: "ask-kind",
        node: null,
      });
    case "answerKind":
      return add(
        { ...s, kind: a.kind, asks: { ...s.asks, kind: "done" } },
        retakeRow(
          `${a.kind} · ${s.script === "authoring-blocked" ? "audit-trail" : NAME}로 정했어요`,
        ),
      );
    case "compose":
      return add(
        { ...s, stage: "compose" },
        row(`${T.stageCompose} · ${T.block} 4 · ${T.step} 선언 3 · validateComposition 통과`),
      );
    case "scaffold":
      return add({ ...s, stage: "scaffold" }, row(`${T.stageScaffold} · 파일 9개 · ${DIR}`), {
        k: "tool",
        name: "write",
        detail: `${DIR}/xeon.extension.json 외 8`,
        status: "done",
        duration: "210ms",
      });
    case "scopeDenied":
      return add(
        s,
        {
          k: "tool",
          name: "edit",
          detail: "~/code/xeon/packages/group-kit/src/define.ts",
          status: "failed",
          duration: "0ms",
          output: `denied: write_scope\n  ${T.targetFolder} ${DIR} 밖이에요`,
        },
        row(
          `${T.writeScope} 밖이라 막았어요 · group-kit/src/define.ts · ${T.targetFolder} 밖`,
          "danger",
          "danger",
        ),
        {
          k: "agent",
          live: true,
          text: `${T.groupKit}은 고치지 않고 ${T.targetFolder} 안에서 setup 등록 줄만 바꿀게요.`,
        },
      );
    case "validate":
      return add(
        { ...s, stage: "validate" },
        row(
          `${T.stageValidate} · ${T.authoringCheck} 12 통과 · 경고 2(AU-010, AU-011) · 오류 0`,
          "ok",
        ),
      );
    case "validateFail":
      return add(
        { ...s, stage: "validate" },
        row(`${T.stageValidate} · 오류 1 · AU-003 구성 초안과 points가 달라요`, "danger", "danger"),
      );
    case "fix": {
      const n = s.fixes + 1;
      return add(
        { ...s, stage: "fix", fixes: n },
        row(
          `${T.stageFix} ${n}/3 · ${n < 3 ? "AU-003 그대로" : "AU-003이 세 번째 남았어요"}`,
          n < 3 ? "author" : "warn",
          n < 3 ? undefined : "warning",
        ),
      );
    }
    case "askFix":
      return add({ ...s, asks: { ...s.asks, fix: "pending" } }, waitRow, {
        k: "node",
        key: "ask-fix",
        node: null,
      });
    case "fixStop":
      return add(
        { ...s, stage: "stopped", asks: { ...s.asks, fix: "done" } },
        row(`제작을 멈췄어요 · 파일 9개는 ${DIR}에 남겨요`, "stop", undefined, SRC),
        { k: "node", key: "stopped-row", node: null },
      );
    case "fixRedo":
      return add(
        { ...s, asks: { ...s.asks, fix: "done" }, fixes: 0 },
        retakeRow(`${T.stageCompose}부터 다시`),
        row(`${T.stageCompose} · drive ${T.block}의 points를 매니페스트에 맞췄어요`),
      );
    case "askTrial":
      return add({ ...s, asks: { ...s.asks, trial: "pending" } }, waitRow, {
        k: "node",
        key: "ask-trial",
        node: null,
      });
    case "trialYes":
      return add(
        { ...s, stage: "trial", asks: { ...s.asks, trial: "done" } },
        retakeRow(`${T.trial} 하기로 했어요`),
        { k: "node", key: "trial-row", node: null },
      );
    case "trialSkip":
      return add(
        { ...s, stage: "trial", asks: { ...s.asks, trial: "declined" } },
        retakeRow(`${T.trial}을 건너뛰었어요`),
      );
    case "trialDone":
      return add(
        s,
        row(`${T.trial} 끝 · ${T.step} 4 · 실패 0 · 토큰 31k`, "flask", "success"),
        row(`${T.replay}는 ${T.devMode}에서만 돌아요 · 건너뜀`, "lock"),
      );
    case "askPackage":
      return add({ ...s, asks: { ...s.asks, package: "pending" } }, waitRow, {
        k: "node",
        key: "ask-package",
        node: null,
      });
    case "packageYes":
      return add(
        { ...s, stage: "package", asks: { ...s.asks, package: "done" } },
        retakeRow(`${T.stagePackage}로 했어요`),
        row(`${T.stagePackage} · ${NAME}-0.1.0.tgz · 파일 9 · 18.4KB`),
      );
    case "packageNo":
      return add(
        { ...s, stage: "stopped", asks: { ...s.asks, package: "declined" } },
        row(`묶지 않았어요 · 파일은 ${DIR}에 남겨요`, "stop"),
      );
    case "result":
      return add({ ...s, stage: "done" }, { k: "node", key: "result", node: null });
    case "askLink":
      if (s.asks.link === "pending" || s.linked) return s;
      return add({ ...s, asks: { ...s.asks, link: "pending" } }, waitRow, {
        k: "node",
        key: "ask-link",
        node: null,
      });
    case "linkYes":
      return add(
        { ...s, linked: true, asks: { ...s.asks, link: "done" } },
        retakeRow(`${T.installLink}하기로 했어요`),
        row(
          `${T.userExtDir}에 ${T.installLink}했어요 · 꺼진 채로 · 켜려면 ${T.trust} 확인`,
          "ok",
          undefined,
          "core",
        ),
        row(`authoring이 ${LEAD_O} 놓았어요 · 제작 끝`, "lease"),
      );
    case "linkNo":
      return add(
        { ...s, asks: { ...s.asks, link: "declined" } },
        retakeRow(`${T.installLink}하지 않았어요`),
      );
    case "replay":
      return add(s, { k: "node", key: "dev-row", node: null });
    case "stop":
      if (s.stage === "idle" || s.stage === "done" || s.stage === "stopped") return s;
      return add(
        { ...s, stage: "stopped" },
        row(`제작을 멈췄어요 · 만든 파일은 ${DIR}에 남겨요`, "stop"),
        { k: "node", key: "stopped-row", node: null },
      );
  }
}

/** 지연 효과. 확인 카드(ask*)에서는 멈추고 사용자를 기다린다. */
export function effect(a: A, n: S, after: After<A>) {
  if (n.stage === "stopped") return;
  const sc = n.script;
  switch (a.t) {
    case "start":
      if (sc === "authoring-off" || sc === "authoring-safe")
        after(600, { t: "user", text: PROMPT });
      else if (sc === "authoring-blocked") after(600, { t: "user", text: PROMPT_HOOK });
      else after(600, { t: "user", text: PROMPT });
      return;
    case "user":
      after(900, n.ext === "on" ? { t: "intent" } : { t: "offReply" });
      return;
    case "enable":
      after(1200, { t: "intent" });
      return;
    case "intent":
      after(1600, sc === "authoring-blocked" ? { t: "blocked" } : { t: "askKind" });
      return;
    case "blocked":
      after(1600, { t: "askKind" });
      return;
    case "answerKind":
      after(900, { t: "compose" });
      return;
    case "compose":
      after(1200, { t: "scaffold" });
      return;
    case "scaffold":
      after(
        1300,
        sc === "authoring-scope-denied"
          ? { t: "scopeDenied" }
          : sc === "authoring-fix-limit"
            ? { t: "validateFail" }
            : { t: "validate" },
      );
      return;
    case "scopeDenied":
      after(2000, { t: "validate" });
      return;
    case "validateFail":
      after(1200, { t: "fix" });
      return;
    case "fix":
      after(1400, n.fixes < 3 ? { t: "fix" } : { t: "askFix" });
      return;
    case "fixRedo":
      after(1200, { t: "validate" });
      return;
    case "validate":
      after(1200, { t: "askTrial" });
      return;
    case "trialYes":
      after(2600, { t: "trialDone" });
      return;
    case "trialSkip":
    case "trialDone":
      after(1200, { t: "askPackage" });
      return;
    case "packageYes":
      after(1100, { t: "result" });
      return;
    default:
      return;
  }
}

const happyTail: A[] = [
  { t: "answerKind", kind: "group.drive" },
  { t: "compose" },
  { t: "scaffold" },
  { t: "validate" },
  { t: "askTrial" },
  { t: "trialYes" },
  { t: "trialDone" },
  { t: "askPackage" },
  { t: "packageYes" },
  { t: "result" },
  { t: "askLink" },
  { t: "linkYes" },
];
const head: A[] = [{ t: "start" }, { t: "user", text: PROMPT }, { t: "intent" }, { t: "askKind" }];

export const SCRIPTS: Record<string, readonly A[]> = {
  // 0 start 1 user 2 intent 3 askKind 4 answerKind 5 compose 6 scaffold 7 validate 8 askTrial 9 trialYes
  // 10 trialDone 11 askPackage 12 packageYes 13 result 14 askLink 15 linkYes
  "authoring-happy": [...head, ...happyTail],
  "authoring-frame": [...head, ...happyTail.slice(0, 10)],
  // 4 answerKind 5 compose 6 scaffold 7 validateFail 8..10 fix×3 11 askFix 12 fixStop
  "authoring-fix-limit": [
    ...head,
    { t: "answerKind", kind: "group.drive" },
    { t: "compose" },
    { t: "scaffold" },
    { t: "validateFail" },
    { t: "fix" },
    { t: "fix" },
    { t: "fix" },
    { t: "askFix" },
    { t: "fixStop" },
  ],
  // 4 answerKind 5 compose 6 scaffold 7 scopeDenied 8 validate 9 askTrial
  "authoring-scope-denied": [
    ...head,
    { t: "answerKind", kind: "group.drive" },
    { t: "compose" },
    { t: "scaffold" },
    { t: "scopeDenied" },
    { t: "validate" },
    { t: "askTrial" },
  ],
  // 0 start 1 user 2 offReply 3 enable 4 intent 5 askKind
  "authoring-off": [
    { t: "start" },
    { t: "user", text: PROMPT },
    { t: "offReply" },
    { t: "enable" },
    { t: "intent" },
    { t: "askKind" },
  ],
  "authoring-safe": [{ t: "start" }, { t: "user", text: PROMPT }, { t: "offReply" }],
  // 0 start 1 user 2 intent 3 blocked 4 askKind
  "authoring-blocked": [
    { t: "start" },
    { t: "user", text: PROMPT_HOOK },
    { t: "intent" },
    { t: "blocked" },
    { t: "askKind" },
  ],
  "authoring-dev-required": [...head, ...happyTail.slice(0, 10), { t: "replay" }],
  // 진행 중 멈춤: 뼈대 뒤 사용자가 중단
  "authoring-stop": [
    ...head,
    { t: "answerKind", kind: "group.drive" },
    { t: "compose" },
    { t: "scaffold" },
    { t: "stop" },
  ],
};
