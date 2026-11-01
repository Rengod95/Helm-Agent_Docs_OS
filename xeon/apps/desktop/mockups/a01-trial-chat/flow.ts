// 시험 대화 상태 기계(목업 전용). spec §6.30, §6.26, 결정 캔버스 9(멈춤은 다음 단계 사이에서 실제로 멈추고 진행권을 쥔 채 둠),
// W-48(멈춤·이어서·한 단계씩), X-19, 계획에 없음 4(시험 대화 정리).
import { EXT, T, josa } from "../_shell";
import type { After } from "../_chat-rt";

export type TrialPhase =
  | "draft" // 시험 대화를 만들었고 아직 보내지 않음
  | "running"
  | "pausing" // 멈춤을 눌렀고 이번 단계가 끝나길 기다림
  | "paused" // 단계 사이에서 멈춤, 진행권 유지
  | "stepping" // 한 단계만 진행 중
  | "disabled" // 대상이 자동 꺼져 시험이 멈춤
  | "finished"
  | "cleared";

export type Item =
  | { k: "user"; text: string; meta?: string }
  | { k: "agent"; text: string; live: boolean }
  | {
      k: "row";
      text: string;
      source: string;
      icon?: "pause" | "play" | "step" | "flask" | "danger";
      tone?: "danger" | "info" | "success";
    }
  | { k: "tool"; name: string; detail: string; status: "done" | "failed"; duration: string };

export interface S {
  phase: TrialPhase;
  steps: number;
  gen: number;
  items: Item[];
  queued: string[];
  /** 지금 시나리오(효과가 고른다). */
  script: string;
}

export type A =
  | { t: "send"; text: string }
  | { t: "tick"; gen?: number }
  | { t: "pause" }
  | { t: "boundary"; gen?: number }
  | { t: "stepOnce" }
  | { t: "resume" }
  | { t: "finish" }
  | { t: "clear" }
  | { t: "queue"; text: string }
  | { t: "autoDisable" }
  | { t: "reenable" };

export const TOTAL = 6;
export const PROMPT = "렌즈 5개로 캐시 무효화 원인을 넓게 봐줘";

/** 단계마다 트랜스크립트에 붙는 것(시험 대상 helm, 프로필 "탐구 중심"). */
const STEP_ITEMS: Item[][] = [
  [
    {
      k: "row",
      text: `${EXT.helm}이 ${josa(T.lead, "을", "를")} 받았어요 · ${T.inquiry} 시작`,
      source: "grp:helm",
    },
    {
      k: "agent",
      text: `${T.lens} 5개를 띄울게요: 실패 사례, 기본 원리, 다른 분야 유사, 시계 경계, 저장 형식.`,
      live: true,
    },
  ],
  [{ k: "row", text: `${T.lens} 5개를 띄웠어요 · spawn 5/8`, source: "grp:helm" }],
  [
    { k: "tool", name: "read", detail: "src/cache.ts", status: "done", duration: "40ms" },
    {
      k: "agent",
      text: `실패 사례 ${T.lens}가 TTL 단위를 섞어 쓴 사례 2건을 찾았어요.`,
      live: true,
    },
  ],
  [
    { k: "row", text: `수렴 ${T.step}로 넘어가요 · ${T.finding} 4`, source: "grp:helm" },
    {
      k: "agent",
      text: `${T.finding} 4개를 3개로 좁혔어요. 저장 형식 ${T.lens}는 근거가 약해요.`,
      live: true,
    },
  ],
  [{ k: "tool", name: "bash", detail: "bun test cache", status: "done", duration: "1.1s" }],
  [
    {
      k: "agent",
      text: `${T.trialThread}라 적용은 하지 않고 결과만 남겨요. ${T.finding} 3개, ${T.lens} 5개 중 실패 0.`,
      live: true,
    },
  ],
];

const settle = (items: Item[]): Item[] =>
  items.map((i) => (i.k === "agent" && i.live ? { ...i, live: false } : i));

export const init = (script: string): S => ({
  phase: "draft",
  steps: 0,
  gen: 0,
  items: [],
  queued: [],
  script,
});

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "send":
      if (s.phase !== "draft") return s;
      return { ...s, phase: "running", gen: s.gen + 1, items: [{ k: "user", text: a.text }] };
    case "tick": {
      if (a.gen !== undefined && a.gen !== s.gen) return s;
      if (s.phase !== "running" && s.phase !== "stepping") return s;
      if (s.steps >= TOTAL) return s;
      const add = STEP_ITEMS[s.steps] ?? [];
      const items = [...settle(s.items), ...add];
      if (s.phase === "stepping")
        return {
          ...s,
          steps: s.steps + 1,
          gen: s.gen + 1,
          phase: "paused",
          items: [
            ...items,
            {
              k: "row",
              text: `${T.step} ${s.steps + 1}만 진행하고 ${T.stepBoundary}에서 다시 멈췄어요`,
              source: "core",
              icon: "step",
            },
          ],
        };
      return { ...s, steps: s.steps + 1, items };
    }
    case "pause":
      if (s.phase !== "running") return s;
      return { ...s, phase: "pausing", gen: s.gen + 1 };
    case "boundary":
      if (s.phase !== "pausing") return s;
      return {
        ...s,
        phase: "paused",
        items: [
          ...settle(s.items),
          {
            k: "row",
            text: `${T.stepBoundary}에서 멈췄어요 · ${T.step} ${s.steps}/${TOTAL} · ${T.lead} ${EXT.helm} 유지`,
            source: "core",
            icon: "pause",
          },
        ],
      };
    case "stepOnce":
      if (s.phase !== "paused") return s;
      return { ...s, phase: "stepping", gen: s.gen + 1 };
    case "resume": {
      if (s.phase !== "paused" && s.phase !== "disabled") return s;
      const queued: Item[] = s.queued.map((text) => ({
        k: "user",
        text,
        meta: "멈춘 동안 보낸 입력",
      }));
      return {
        ...s,
        phase: "running",
        gen: s.gen + 1,
        queued: [],
        items: [
          ...settle(s.items),
          {
            k: "row",
            text: `이어서 진행해요 · ${T.step} ${s.steps + 1}부터`,
            source: "core",
            icon: "play",
          },
          ...queued,
        ],
      };
    }
    case "finish":
      if (s.phase !== "running" || s.steps < TOTAL) return s;
      return {
        ...s,
        phase: "finished",
        gen: s.gen + 1,
        items: [
          ...settle(s.items),
          {
            k: "row",
            text: `${EXT.helm}이 ${josa(T.lead, "을", "를")} 놓았어요 · ${T.trial} 끝 · ${T.step} ${TOTAL} · 실패 0`,
            source: "grp:helm",
            icon: "flask",
            tone: "success",
          },
        ],
      };
    case "clear":
      return s.phase === "finished" ? { ...s, phase: "cleared" } : s;
    case "queue":
      if (s.phase !== "paused" && s.phase !== "pausing") return s;
      return { ...s, queued: [...s.queued, a.text] };
    case "autoDisable":
      if (s.phase !== "running") return s;
      return {
        ...s,
        phase: "disabled",
        gen: s.gen + 1,
        items: [
          ...settle(s.items),
          {
            k: "row",
            text: `${EXT.helm}이 ${T.autoDisabled} · boundary.settle.after 연속 실패 5 · ${T.trial} 멈춤`,
            source: "core",
            icon: "danger",
            tone: "danger",
          },
        ],
      };
    case "reenable":
      if (s.phase !== "disabled") return s;
      return reduce(
        {
          ...s,
          phase: "paused",
          items: [
            ...s.items,
            {
              k: "row",
              text: `${EXT.helm}을 다시 켰어요 · 이 ${T.trialThread}에만`,
              source: "core",
              icon: "play",
            },
          ],
        },
        { t: "resume" },
      );
  }
}

/** 지연 효과: 실행 중이면 다음 단계, 멈춤이면 이번 단계 끝(경계), 한 단계씩이면 한 번만. */
export function effect(a: A, n: S, after: After<A>) {
  const g = n.gen;
  switch (a.t) {
    case "send":
    case "resume":
      after(1100, { t: "tick", gen: g });
      return;
    case "reenable":
      after(1100, { t: "tick", gen: g });
      return;
    case "tick":
      if (n.phase === "running") {
        if (n.script === "trial-autodisable" && n.steps === 3) after(2200, { t: "autoDisable" });
        else if (n.steps < TOTAL) after(2600, { t: "tick", gen: g });
        else after(1600, { t: "finish" });
      }
      return;
    case "pause":
      after(2600, { t: "boundary", gen: g });
      return;
    case "stepOnce":
      after(2200, { t: "tick", gen: g });
      return;
    default:
      return;
  }
}

const tick: A = { t: "tick" };
export const SCRIPTS: Record<string, readonly A[]> = {
  // 시작 → 멈춤 → 경계 기다림 → 한 단계씩 → 이어서 → 끝 → 정리
  "trial-pause-resume": [
    { t: "send", text: PROMPT },
    tick,
    tick,
    { t: "pause" },
    { t: "boundary" },
    { t: "stepOnce" },
    tick,
    { t: "resume" },
    tick,
    tick,
    tick,
    { t: "finish" },
    { t: "clear" },
  ],
  // 멈춘 동안 보낸 입력은 큐에만 들어가고, 이어서 하면 들어간다
  "trial-queue": [
    { t: "send", text: PROMPT },
    tick,
    tick,
    { t: "pause" },
    { t: "boundary" },
    { t: "queue", text: "기본 원리 렌즈는 빼도 돼" },
    { t: "resume" },
  ],
  // 실패 갈래: 시험 중 대상이 자동 꺼짐 → 시험 멈춤, 실패 기록 → 다시 켜고 이어서
  "trial-autodisable": [
    { t: "send", text: PROMPT },
    tick,
    tick,
    tick,
    { t: "autoDisable" },
    { t: "reenable" },
  ],
};
