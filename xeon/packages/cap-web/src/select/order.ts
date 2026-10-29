import type { ProviderCandidate } from "@xeon/contracts/capabilities";

// L2.web.spec §4.8.2 (D-M3-23 행 1). 검색·브라우저 provider의 자동 선택 순서 하나.
// 호출 인자 provider → 설정 provider → auto. auto는 사용자가 설정 화면에서 끌어 옮겨 정한 `order` 목록이 먼저다.
// 목록은 등록된 도구 전부(내장 기본 도구와 플러그인)이고 목록에 없는 후보는 뒤에 붙는다: 사용자가 주소를 설정한 내장(detected),
// 기본 내장(builtin), 플러그인 순이다. 플러그인은 사용자가 순서에 올리기 전까지 기본 후순위다.

type SelectedBy = "call" | "setting" | "auto";

export interface SelectionInput {
  readonly candidates: readonly ProviderCandidate[];
  readonly callProvider?: string;
  /** `l2.web.<능력>.provider`. "auto" 또는 provider id */
  readonly settingProvider: string;
  /** `l2.web.<능력>.order`. 후보에 없는 id는 건너뛴다 */
  readonly order: readonly string[];
}

export interface SelectionPlan {
  readonly selectedBy: SelectedBy;
  /** 시도 순서의 provider ID. 명시 선택이면 원소 하나, 후보에 없으면 빈 배열 */
  readonly order: readonly string[];
}

const ORIGIN_RANK: Readonly<Record<ProviderCandidate["origin"], number>> = {
  detected: 0,
  builtin: 1,
  plugin: 2,
};

function byRankThenBytes(a: ProviderCandidate, b: ProviderCandidate): number {
  const rank = ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
  if (rank !== 0) return rank;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function planSelection(input: SelectionInput): SelectionPlan {
  const known = (id: string): boolean => input.candidates.some((candidate) => candidate.id === id);
  if (input.callProvider !== undefined) {
    return { selectedBy: "call", order: known(input.callProvider) ? [input.callProvider] : [] };
  }
  if (input.settingProvider !== "auto") {
    return {
      selectedBy: "setting",
      order: known(input.settingProvider) ? [input.settingProvider] : [],
    };
  }
  const listed: string[] = [];
  for (const id of input.order) {
    if (known(id) && !listed.includes(id)) listed.push(id);
  }
  const rest = input.candidates
    .filter((candidate) => !listed.includes(candidate.id))
    .toSorted(byRankThenBytes)
    .map((candidate) => candidate.id);
  return { selectedBy: "auto", order: [...listed, ...rest] };
}
