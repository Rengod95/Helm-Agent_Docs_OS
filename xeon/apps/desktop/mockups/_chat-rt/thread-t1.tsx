// batch A 공용 고정 데이터: 대화 t1 "캐시 무효화 조사"의 앞부분(p02-opus 트랜스크립트와 같은 사실)과 런타임 탭 기본값.
// a00·a02·a04가 이 위에 자기 상태를 더한다.
import { EXT, josa, T } from "../_shell";
import type { ChatItem } from "./items";
import { baseGroups, type RuntimeData } from "./runtime-panel";

export const T1_TITLE = "캐시 무효화 조사";

export const t1Base: ChatItem[] = [
  { k: "user", text: "무효화 시험이 계속 실패해. 원인 찾아줘" },
  { k: "agent", text: "먼저 실패하는 시험을 돌려 볼게요." },
  {
    k: "tool",
    name: "bash",
    detail: "bun test cache",
    status: "failed",
    duration: "1.2s",
    output: "FAIL test/cache.test.ts > expires after ttl\n  expected true, received false",
  },
  {
    k: "row",
    text: `${EXT.helm}이 ${josa(T.lead, "을", "를")} 받았어요 · ${T.inquiry} 시작 · ${T.lens} 3`,
    source: "grp:helm",
    icon: "lease",
  },
  { k: "tool", name: "read", detail: "src/cache.ts", status: "done", duration: "40ms" },
  {
    k: "agent",
    text: `${T.lens} 3개가 같은 곳을 가리켜요. ttl은 초 단위인데 isExpired가 밀리초로 비교해요.`,
  },
];

export function t1Runtime(over: Partial<RuntimeData> = {}): RuntimeData {
  return {
    caption: `${T1_TITLE} · ${T.turn} 3`,
    holder: "helm",
    phase: `${T.inquiry} · 수렴`,
    since: `${T.turn} 1부터`,
    gauges: { turns: [1, 4], spawns: [3, 8], tokens: "120k / 400k", tokenRatio: 0.3 },
    queue: [{ group: "review", state: "waiting", note: "tool.call.after 뒤 진행 원함" }],
    groups: baseGroups,
    switches: [
      { at: "14:03", turn: 2, text: `${T.lens} 3개 띄움 · spawn 3/8` },
      { at: "14:02", turn: 1, text: `${EXT.helm}이 ${josa(T.lead, "을", "를")} 받았어요` },
      { at: "14:01", turn: 1, text: `${EXT.review} 켜짐 · 다음 ${T.stepBoundary}에 적용` },
    ],
    ...over,
  };
}

/** 대화 머리 런타임 줄 기본(보유 · 단계 · 켜진 확장 수). */
export const t1RuntimeLine = `${EXT.helm} ${T.drive} · ${T.inquiry} 수렴 · ${T.extension} 4`;
