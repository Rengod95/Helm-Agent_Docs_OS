import type { SettingsTab } from "@xeon/contracts/settings";

// 설정 탭 표(L4.settings-ui §4.1.1, 탭 13개). 값이 `SettingsTab`과 어긋나면 Record 타입이 컴파일 오류로 잡는다.

export interface TabSpec {
  readonly id: SettingsTab;
  readonly label: string;
  /** 0..12, 탭 표시 순서 */
  readonly position: number;
  /** 상태 게이지 자리가 있는 탭(§4.7). M3에서는 budgets와 providers만 참이다 */
  readonly gauge: boolean;
  readonly emptyText: string;
}

export const TAB_SPECS: Readonly<Record<SettingsTab, TabSpec>> = {
  overview: {
    id: "overview",
    label: "개요",
    position: 0,
    gauge: false,
    emptyText: "요약할 설정이 아직 없어요",
  },
  models: {
    id: "models",
    label: "모델",
    position: 1,
    gauge: false,
    emptyText: "이 탭에는 아직 모델 설정이 없어요",
  },
  budgets: {
    id: "budgets",
    label: "예산과 한도",
    position: 2,
    gauge: true,
    emptyText: "이 탭에는 아직 예산 설정이 없어요",
  },
  providers: {
    id: "providers",
    label: "계정과 제공자",
    position: 3,
    gauge: true,
    emptyText: "이 탭에는 아직 계정과 제공자 설정이 없어요",
  },
  secrets: {
    id: "secrets",
    label: "비밀",
    position: 4,
    gauge: false,
    emptyText: "이 탭에는 아직 비밀 설정이 없어요",
  },
  permissions: {
    id: "permissions",
    label: "권한",
    position: 5,
    gauge: false,
    emptyText: "이 탭에는 아직 권한 설정이 없어요",
  },
  sandbox: {
    id: "sandbox",
    label: "샌드박스",
    position: 6,
    gauge: false,
    emptyText: "이 탭에는 아직 샌드박스 설정이 없어요",
  },
  sessions: {
    id: "sessions",
    label: "세션과 컨텍스트",
    position: 7,
    gauge: false,
    emptyText: "이 탭에는 아직 세션 설정이 없어요",
  },
  tools: {
    id: "tools",
    label: "도구와 웹",
    position: 8,
    gauge: false,
    emptyText: "이 탭에는 아직 도구와 웹 설정이 없어요",
  },
  plugins: {
    id: "plugins",
    label: "플러그인과 그룹",
    position: 9,
    gauge: false,
    emptyText: "이 탭에는 아직 플러그인 설정이 없어요",
  },
  execution: {
    id: "execution",
    label: "실행과 서비스",
    position: 10,
    gauge: false,
    emptyText: "이 탭에는 아직 실행 설정이 없어요",
  },
  appearance: {
    id: "appearance",
    label: "외관",
    position: 11,
    gauge: false,
    emptyText: "이 탭에는 아직 외관 설정이 없어요",
  },
  advanced: {
    id: "advanced",
    label: "고급",
    position: 12,
    gauge: false,
    emptyText: "이 탭에는 아직 고급 설정이 없어요",
  },
};

/** 탭 id를 표시 순서(position)대로 나열한다 */
export const TAB_ORDER: readonly SettingsTab[] = Object.values(TAB_SPECS)
  .toSorted((a, b) => a.position - b.position)
  .map((spec) => spec.id);
