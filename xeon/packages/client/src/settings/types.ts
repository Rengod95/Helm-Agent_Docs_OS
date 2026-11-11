import type {
  EffectiveSetting,
  RuntimeChange,
  SettingEditor,
  SettingKey,
  SettingLockReason,
  SettingScope,
  SettingsTab,
} from "@fresnel/contracts/settings";

// 설정 화면 view-model 타입(L4.settings-ui §3.4). 화면 부품 없이 값만 담는다. 초안·저장 중·오류·외부 변경 필드는 `settingsViewOf`(state.ts)가 채운다.

/** 정의 하나가 어느 원천에서 왔는가(L4.settings-ui §4.1.3). `l4.desktop.` 접두사 키는 desktop이다 */
export type SettingOrigin = "engine" | "desktop";

/** 데스크톱 로컬 저장소의 쓰기 실패(L4.desktop.spec §3.6). `storage`는 파일 쓰기 실패다 */
export interface LocalWriteFailure {
  readonly ok: false;
  readonly kind: "settings.unknownKey" | "settings.invalidValue" | "storage";
  readonly details: Readonly<Record<string, unknown>>;
}

/** 데스크톱 로컬 저장소의 쓰기 결과. 성공하면 바뀐 유효 값을 돌려준다 */
export type LocalWrite =
  | { readonly ok: true; readonly setting: EffectiveSetting }
  | LocalWriteFailure;

/** 클라이언트 검사나 서버 거절의 한 항목. `message`는 화면 문장이고 `path`는 JSON Pointer다 */
export interface ValueIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * 필드 아래에 보이는 저장 오류 일곱 종(L4.settings-ui §4.4.4). 서버 `message`는 담지 않는다.
 * `transient`는 연결이 끊기거나 엔진이 종료 중일 때, `internal`은 그 밖의 모든 오류다.
 */
export type FieldError =
  | {
      readonly kind: "invalidValue";
      readonly message: string;
      readonly issues: readonly ValueIssue[];
    }
  | {
      readonly kind: "scopeNotAllowed";
      readonly message: string;
      readonly allowed: readonly SettingScope[];
    }
  | { readonly kind: "locked"; readonly message: string }
  | { readonly kind: "secretValue"; readonly message: string }
  | { readonly kind: "unknownKey"; readonly message: string }
  | { readonly kind: "transient"; readonly message: string }
  | { readonly kind: "internal"; readonly message: string; readonly traceId: string | null };

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

/**
 * 가려진 범위의 값. wire의 `shadowed`는 범위와 경로만 싣는다(F.wire-settings §4.7), 그래서 값은 그 범위 파일을 읽어 채운다.
 * `value`는 정의 검사를 통과한 값이다. `secret`은 시크릿 키라 값을 싣지 않는다(화면은 "값 가려짐"). `unknown`은 읽지 못했거나
 * 값이 파일에 없는 범위(`launch`는 파일이 없다)다.
 */
export type ShadowedValueVM =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "secret" }
  | { readonly kind: "unknown" };

export interface ShadowedVM {
  readonly scope: BadgeScope;
  readonly path: string | null;
  readonly value: ShadowedValueVM;
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
      /** 화면에 보이는 단위 글(번역을 거친다) */
      readonly unit: string | null;
      /** 정의의 `ui.unit` 원문(예: "tokens", "B", "ms"). 단위 종류를 가릴 때 쓴다 */
      readonly unitId: string | null;
    }
  | {
      readonly kind: "text";
      readonly minLength: number | null;
      readonly maxLength: number | null;
      readonly pattern: string | null;
    }
  | {
      readonly kind: "list";
      readonly item: ListItemKind;
      /** 원소가 고를 수 있는 값(열거형 원소). 자유 입력이면 null */
      readonly options: readonly (string | number)[] | null;
      readonly maxItems: number | null;
    }
  | {
      /** fixed: 속성이 고정된 객체(예: `l1.models.thinkingBudgets`). rows: 객체 배열. record: 원시 값 맵 */
      readonly kind: "table";
      readonly shape: "rows" | "record" | "fixed";
      readonly columns: readonly TableColumn[];
      readonly maxItems: number | null;
    }
  | { readonly kind: "secret" }
  | { readonly kind: "readonly" };

/** 시크릿 참조 상태. 저장소 상태(registered·missing)는 L0 상태를 받을 때 더한다(§4.6.2) */
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
  // ── 원천과 쓰기 상태(settingsViewOf가 채운다. buildSettingsView만 쓰면 기본값이다) ──
  /** 정의가 온 원천. 엔진 연결이 없으면 `engine` 항목은 바꿀 수 없다(§4.1.3) */
  readonly origin: SettingOrigin;
  /** 엔진과 연결되지 않아 바꿀 수 없는 `engine` 항목에 보이는 안내 문장. 해당하지 않으면 null */
  readonly offlineNote: string | null;
  /** 초안이 있다. `value`는 그때 초안 값이다 */
  readonly dirty: boolean;
  /** 초안의 클라이언트 검사 결과. 비어 있으면 저장할 수 있다 */
  readonly issues: readonly ValueIssue[];
  /** 전송 중이다 */
  readonly saving: boolean;
  /** 마지막 저장 시도의 오류. 다음 편집이나 성공 때 지운다 */
  readonly error: FieldError | null;
  /** 초안을 가진 채 다른 곳에서 값이 바뀌었다(L4.settings-ui §4.5.3) */
  readonly remoteChanged: boolean;
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
