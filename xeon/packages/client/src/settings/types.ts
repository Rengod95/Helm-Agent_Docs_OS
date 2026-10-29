import type {
  RuntimeChange,
  SettingEditor,
  SettingKey,
  SettingLockReason,
  SettingScope,
  SettingsTab,
} from "@xeon/contracts/settings";

// 설정 화면 view-model 타입(L4.settings-ui §3.4). 화면 부품 없이 값만 담는다. 쓰기 흐름의 초안·저장 중·오류 필드는 M3 쓰기 단계에서 더한다.

/** 쓰기 범위 후보. managed는 화면이 쓰지 않는다(§4.3.6) */
export type WritableScope = Exclude<SettingScope, "managed">;
export type BadgeScope = SettingScope | "default";

export interface ScopeBadge {
  readonly scope: BadgeScope;
  /** "관리", "사용자", "프로젝트", "로컬", "세션", "기본값" */
  readonly text: string;
  /** 렌더러가 색 토큰으로 바꾼다(§4.3.1) */
  readonly tone: BadgeScope;
}

export interface RuntimeBadge {
  readonly change: RuntimeChange;
  /** "즉시 적용", "다음 턴부터", "재시작 필요" */
  readonly text: string;
  /** EffectiveSetting.pendingUntil */
  readonly pending: "nextTurn" | "restart" | null;
  /** "다음 턴부터 적용돼요", "재시작해야 적용돼요". 대기가 없으면 null */
  readonly pendingText: string | null;
}

export interface LockInfo {
  /** 잠금 사유의 종류. 문장이 아니다(§4.8.3) */
  readonly reason: SettingLockReason;
  /** 정책 파일 경로. `managed_file`에서만 값이 있다 */
  readonly path: string | null;
  readonly text: string;
}

export interface ShadowedVM {
  readonly scope: BadgeScope;
  readonly path: string | null;
}

export interface DeprecatedVM {
  readonly since: string;
  readonly replacedBy: SettingKey | null;
  /** 대체 키 정의의 ui.label. 대체 키 정의가 없으면 null */
  readonly replacedByLabel: string | null;
  readonly note: string | null;
}

export type ListItemKind = "string" | "number" | "integer" | "boolean";

export interface TableColumn {
  /** rows는 속성 이름, record는 "이름"·"값", fixed는 속성 이름 */
  readonly name: string;
  /** "json"은 중첩 객체 열이다. 읽기만 하고 편집은 파일 편집기로 넘긴다(§4.2.1) */
  readonly kind: ListItemKind | "enum" | "json";
  readonly options: readonly (string | number)[] | null;
  readonly required: boolean;
}

export type WidgetVM =
  | { readonly kind: "toggle" }
  | { readonly kind: "select"; readonly options: readonly (string | number)[] }
  | {
      readonly kind: "number";
      readonly min: number | null;
      readonly max: number | null;
      readonly integer: boolean;
      readonly unit: string | null;
    }
  | {
      readonly kind: "text";
      readonly minLength: number | null;
      readonly maxLength: number | null;
      readonly pattern: string | null;
    }
  | { readonly kind: "list"; readonly item: ListItemKind; readonly maxItems: number | null }
  | {
      /** fixed: 속성이 고정된 객체(예: `l1.models.thinkingBudgets`). rows: 객체 배열. record: 원시 값 맵 */
      readonly kind: "table";
      readonly shape: "rows" | "record" | "fixed";
      readonly columns: readonly TableColumn[];
      readonly maxItems: number | null;
    }
  | { readonly kind: "secret" }
  | { readonly kind: "readonly" };

/** 비밀 참조 상태. 저장소 상태(registered·missing)는 L0 상태를 받을 때 더한다(§4.6.2) */
export type SecretStatus = "unset" | "referenced";

export interface SecretFieldVM {
  /** `secret://<이름>` 참조 문자열만 담는다. 값이 아니다 */
  readonly ref: string | null;
  readonly status: SecretStatus;
}

export interface FieldVM {
  readonly key: SettingKey;
  readonly tab: SettingsTab;
  readonly order: number;
  readonly label: string;
  readonly help: string | null;
  readonly widget: WidgetVM;
  /** 유효 값. secret이면 SecretRef 문자열 또는 null만 담긴다 */
  readonly value: unknown;
  readonly scope: ScopeBadge;
  readonly runtime: RuntimeBadge;
  readonly lock: LockInfo | null;
  readonly shadowed: readonly ShadowedVM[];
  readonly filePath: string | null;
  readonly writableScopes: readonly WritableScope[];
  /** 기본 쓰기 범위(user > project > local > session). 후보가 없으면 null */
  readonly selectedScope: WritableScope | null;
  readonly canReset: boolean;
  readonly editable: boolean;
  readonly deprecated: DeprecatedVM | null;
  readonly secret: SecretFieldVM | null;
  /** EffectiveSetting.problem을 옮긴 값. 호스트가 아는 사실로 쓸 수 없는 값일 때 */
  readonly problem: {
    readonly kind: string;
    readonly args: Readonly<Record<string, string | number | boolean | null>> | null;
  } | null;
  /** 전용 편집기 힌트. 모르는 값은 일반 위젯으로 그린다(§4.2.4) */
  readonly editor: SettingEditor | null;
}

export interface GaugeSlotVM {
  readonly tab: "budgets" | "providers";
  readonly status: "unavailable";
  readonly text: string;
}

export interface TabVM {
  readonly id: SettingsTab;
  readonly label: string;
  readonly fields: readonly FieldVM[];
  readonly gauge: GaugeSlotVM | null;
  /** 항목이 비었을 때의 이유 문구. 항목이 있으면 null */
  readonly emptyText: string | null;
}

export interface FileOnlyEntryVM {
  readonly key: SettingKey;
  /** secret이면 SecretRef 문자열 또는 null */
  readonly value: unknown;
  readonly scope: ScopeBadge;
  readonly lock: LockInfo | null;
  readonly writableScopes: readonly WritableScope[];
  /** 값 검사용 JSON Schema(toValueJsonSchema) */
  readonly jsonSchema: Readonly<Record<string, unknown>>;
}

export type ViewDiagnostic =
  | { readonly code: "widgetMismatch"; readonly key: SettingKey; readonly widget: string }
  | { readonly code: "unknownWidget"; readonly key: SettingKey; readonly widget: string }
  | { readonly code: "unknownTab"; readonly key: SettingKey; readonly tab: string }
  | { readonly code: "missingValue"; readonly key: SettingKey }
  | { readonly code: "duplicateKey"; readonly key: SettingKey };

export interface OverviewVM {
  readonly countsByScope: Readonly<Record<BadgeScope, number>>;
  readonly locked: readonly SettingKey[];
  readonly pendingRestart: readonly SettingKey[];
  readonly pendingNextTurn: readonly SettingKey[];
  readonly deprecatedInUse: readonly SettingKey[];
  readonly secretRefs: readonly {
    readonly key: SettingKey;
    readonly tab: SettingsTab | null;
    readonly status: SecretStatus;
  }[];
}

export interface SettingsView {
  /** TAB_ORDER 순서, 항상 13개 */
  readonly tabs: readonly TabVM[];
  readonly fileOnly: readonly FileOnlyEntryVM[];
  readonly overview: OverviewVM;
  readonly diagnostics: readonly ViewDiagnostic[];
  readonly restartBanner: { readonly count: number; readonly text: string } | null;
}
