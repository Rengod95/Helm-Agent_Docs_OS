import type { HelmLens, HelmPending, HelmSignalKind } from "./state.ts";

export interface LensDef {
  readonly id: string;
  readonly title: string;
  /** explorer 과제 문장 틀. {topic} 자리표시자 하나 */
  readonly taskTemplate: string;
}

/** M3 내장 렌즈 6개(L3.helm.spec §3.6). 순서가 기본 우선순위다 */
export const BUILTIN_LENSES: readonly LensDef[] = [
  {
    id: "analogy",
    title: "다른 분야의 유사 문제",
    taskTemplate:
      "{topic}과 구조가 같은 문제를 다른 분야(생물, 물리, 경제, 운영 등)에서 찾고, 그 분야의 해법을 옮길 수 있는지 본다.",
  },
  {
    id: "prior-art",
    title: "선행 사례와 문헌",
    taskTemplate:
      "{topic}을 이미 다룬 논문, 오픈소스, 표준, 사후 분석을 찾고 채택된 방법과 버린 방법을 모은다.",
  },
  {
    id: "first-principles",
    title: "기본 원리로 다시 보기",
    taskTemplate: "{topic}의 전제를 나열하고 각 전제를 빼면 무엇이 달라지는지 본다.",
  },
  {
    id: "failure-modes",
    title: "실패 사례",
    taskTemplate: "{topic}과 비슷한 시도가 실패한 사례와 원인을 모은다.",
  },
  {
    id: "inversion",
    title: "반대로 보기",
    taskTemplate: "{topic}의 목표를 뒤집어(어떻게 하면 확실히 실패하는가) 피할 조건을 찾는다.",
  },
  {
    id: "constraints",
    title: "제약 바꾸기",
    taskTemplate:
      "{topic}에서 시간, 비용, 규모 같은 제약 하나를 크게 바꿨을 때의 해법을 찾고 현재 제약으로 되돌려 본다.",
  },
];

/** 신호(또는 명령)별 렌즈 우선순위 */
export const LENS_PRIORITY: Readonly<Record<HelmSignalKind | "command", readonly string[]>> = {
  stuck: ["failure-modes", "first-principles", "analogy", "prior-art", "inversion", "constraints"],
  repeat: ["inversion", "analogy", "constraints", "first-principles", "prior-art", "failure-modes"],
  newDomain: [
    "prior-art",
    "analogy",
    "first-principles",
    "failure-modes",
    "constraints",
    "inversion",
  ],
  command: [
    "analogy",
    "prior-art",
    "first-principles",
    "inversion",
    "failure-modes",
    "constraints",
  ],
};

/** 순수 함수. 우선순위 앞에서부터 maxLenses개를 고른다. 같은 입력이면 같은 결과다 */
export function selectLenses(
  pending: Readonly<HelmPending>,
  maxLenses: number,
  catalog: readonly LensDef[],
): readonly HelmLens[] {
  const order =
    LENS_PRIORITY[pending.source === "signal" ? (pending.signal ?? "command") : "command"];
  const chosen: HelmLens[] = [];
  for (const id of order) {
    if (chosen.length >= maxLenses) break;
    const def = catalog.find((lens) => lens.id === id);
    if (def !== undefined) chosen.push({ id: def.id, title: def.title, status: "pending" });
  }
  return chosen;
}
