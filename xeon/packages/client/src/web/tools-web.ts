import { err, ok, type Result } from "@xeon/contracts";
import type {
  WebProviderAuth,
  WebProviderCapability,
  WebProviderOrigin,
  WebProviderStatus,
  WebProvidersResult,
} from "@xeon/contracts/wire";
import { t, type MessageId } from "../i18n/index.ts";

// 도구와 웹 탭의 view-model(L4.settings-ui §3.6, §4.11, M3-12 비시각 부분, M3-REQ-96). `web.providers` 결과를 화면 값으로 바꾸고,
// 끌어 옮긴 순서를 `settings.set` 값으로 바꾼다. 순위와 현재 provider는 호스트가 `autoRank`로 정해 싣는다(F.wire-settings.spec
// `web.providers`). 이 모듈은 순위를 다시 계산하지 않는다. 결과는 연결이 스키마로 검증해 건넨다고 보고 여기서 다시 parse하지 않는다.
// wire에는 키 값과 헤더 이름이 없고, 이 모듈도 만들지 않는다.

/** 탐침 상세 문구의 최대 길이. wire는 512자까지 싣고 여기서 자른다 */
const DETAIL_MAX = 200;

/** 자동 선택 순서 설정 키. 검색과 브라우즈가 따로 쓴다 */
const ORDER_KEY_OF = {
  "web.search": "l2.web.search.order",
  "web.browse": "l2.web.browse.order",
} as const;

export type WebToolRow = {
  readonly id: string;
  readonly capability: WebProviderCapability;
  readonly displayName: string;
  readonly origin: WebProviderOrigin;
  readonly auth: WebProviderAuth;
  /** 쓸 수 있으면 참 */
  readonly ok: boolean;
  /** 못 쓸 때 `unavailable.reason` 값. 쓸 수 있으면 null */
  readonly reason: string | null;
  /** 탐침 상세를 200자에서 자른 값. `note`에는 넣지 않는다 */
  readonly detail: string | null;
  /** 한 줄 문구. "사용할 수 있다" | "키가 없다 — 해결: …" | 그 밖의 사유 */
  readonly note: string;
  /** 자동 선택 순서(wire `autoRank`). 웹 fetch 행은 null */
  readonly rank: number | null;
  /** 다음 자동 호출이 이 provider를 먼저 쓴다. 설정이 고정하면 고정된 행만 참이다 */
  readonly current: boolean;
  /** 설정이 이 provider를 고정했으면 참 */
  readonly pinned: boolean;
  /** 키 플러그인의 첫 사용 고지가 아직 나가지 않았으면 참 */
  readonly noticePending: boolean;
  /** 가격표 기준일과 오래됨 여부. 무료거나 가격표가 없으면 null */
  readonly price: { readonly asOf: string; readonly stale: boolean } | null;
};

export type WebSection = {
  readonly capability: WebProviderCapability;
  /** 설정 값. `"auto"` 또는 provider id. fetch는 wire에 설정이 없어 `"auto"`다 */
  readonly provider: string;
  /** 사용자 순서 목록을 저장된 그대로 */
  readonly order: readonly string[];
  /** search·browse는 autoRank 오름차순(없으면 뒤), 같으면 id. fetch는 id */
  readonly rows: readonly WebToolRow[];
};

export type WebRecommendation = {
  readonly label: "Exa" | "Brave";
  readonly providerId: string;
  readonly secretName: string;
  /** 행이 없으면 not-installed, no-key면 needs-key, ok면 ready, 그 밖의 사유면 unavailable */
  readonly state: "not-installed" | "needs-key" | "ready" | "unavailable";
  /** needs-key는 등록 명령, not-installed는 설치 안내, unavailable은 사유 값, ready는 빈 문자열 */
  readonly hint: string;
};

export type ToolsWebView = {
  readonly search: WebSection;
  readonly browse: WebSection;
  readonly fetch: WebSection;
  readonly parallel: number;
  readonly robots: {
    readonly value: "auto" | "always" | "never";
    /** `value`가 `never`가 아니면 참이다. 기본값은 `never`라서 거짓이다 */
    readonly follows: boolean;
  };
  readonly recommendations: readonly WebRecommendation[];
  /** 첫 사용 고지가 남은 provider id. 정렬하고 중복을 없앤다 */
  readonly noticesPending: readonly string[];
};

export type OrderUpdate = {
  readonly key: "l2.web.search.order" | "l2.web.browse.order";
  /** 끌어 옮긴 뒤의 전체 순서 */
  readonly value: readonly string[];
};

export type OrderUpdateError =
  | { readonly kind: "unknown_id"; readonly id: string }
  | { readonly kind: "duplicate_id"; readonly id: string };

type RecommendedKey = {
  readonly label: "Exa" | "Brave";
  readonly providerId: string;
  readonly secretName: string;
};

// 추천 키 플러그인(ADR-0005 §3.1 ④, D-M3-23). Parallel과 Jina는 넣지 않는다
const RECOMMENDED: readonly RecommendedKey[] = [
  { label: "Exa", providerId: "plugin:web-exa", secretName: "exa-api-key" },
  { label: "Brave", providerId: "plugin:web-brave", secretName: "brave-api-key" },
];

// 사유 코드별 한 줄 문구의 id. 목록에 없는 사유는 코드 그대로 보인다
const NOTE_ID_BY_REASON: ReadonlyMap<string, MessageId> = new Map<string, MessageId>([
  ["unreachable", "client.web.note.unreachable"],
  ["json-disabled", "client.web.note.jsonDisabled"],
  ["org-disabled", "client.web.note.orgDisabled"],
  ["unsupported-model", "client.web.note.unsupportedModel"],
]);

function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function byRankThenId(a: WebProviderStatus, b: WebProviderStatus): number {
  if (a.autoRank !== b.autoRank) {
    if (a.autoRank === null) return 1;
    if (b.autoRank === null) return -1;
    return a.autoRank - b.autoRank;
  }
  return compareCodeUnits(a.id, b.id);
}

function keyNoteOf(providerId: string): string {
  const key = RECOMMENDED.find((entry) => entry.providerId === providerId);
  if (key === undefined) return t("client.web.note.noKeyPlugin");
  return t("client.web.note.noKeyCommand", { secretName: key.secretName });
}

function noteOf(row: WebProviderStatus): string {
  const { status } = row;
  if (status.kind === "ok") return t("client.web.note.ok");
  if (status.reason === "no-key") return keyNoteOf(row.id);
  const id = NOTE_ID_BY_REASON.get(status.reason);
  return id === undefined ? status.reason : t(id);
}

function rowOf(row: WebProviderStatus, current: boolean, pinned: boolean): WebToolRow {
  const { status } = row;
  return {
    id: row.id,
    capability: row.capability,
    displayName: row.displayName,
    origin: row.origin,
    auth: row.auth,
    ok: status.kind === "ok",
    reason: status.kind === "unavailable" ? status.reason : null,
    detail:
      status.kind === "unavailable" && status.detail !== undefined
        ? status.detail.slice(0, DETAIL_MAX)
        : null,
    note: noteOf(row),
    rank: row.autoRank,
    current,
    pinned,
    noticePending: !row.firstUseNoticed,
    price: row.pricingAsOf === null ? null : { asOf: row.pricingAsOf, stale: row.pricingStale },
  };
}

function sectionOf(
  providers: readonly WebProviderStatus[],
  capability: WebProviderCapability,
  provider: string,
  order: readonly string[],
): WebSection {
  const sorted = providers.filter((row) => row.capability === capability).toSorted(byRankThenId);
  const fixed = provider !== "auto";
  // 고정이 없으면 순위가 있는 첫 쓸 수 있는 행이 다음 호출의 첫 자리다. fetch는 순위가 없어 아무도 현재가 아니다
  const firstOk = sorted.find((row) => row.status.kind === "ok" && row.autoRank !== null);
  return {
    capability,
    provider,
    order: [...order],
    rows: sorted.map((row) => {
      const pinned = fixed && row.id === provider;
      const current = fixed ? pinned : row === firstOk;
      return rowOf(row, current, pinned);
    }),
  };
}

function recommendationOf(
  key: RecommendedKey,
  providers: readonly WebProviderStatus[],
): WebRecommendation {
  const row = providers.find((entry) => entry.id === key.providerId);
  if (row === undefined) {
    return { ...key, state: "not-installed", hint: t("client.web.hint.installPlugin") };
  }
  if (row.status.kind === "ok") return { ...key, state: "ready", hint: "" };
  if (row.status.reason === "no-key") {
    return { ...key, state: "needs-key", hint: `xeon secret add ${key.secretName}` };
  }
  return { ...key, state: "unavailable", hint: row.status.reason };
}

/** `web.providers` 결과를 도구와 웹 탭 값으로 바꾼다. 결과가 스키마를 통과했다고 가정한다 */
export function toolsWebViewOf(result: WebProvidersResult): ToolsWebView {
  const { providers, settings } = result;
  const pending = providers.filter((row) => !row.firstUseNoticed).map((row) => row.id);
  return {
    search: sectionOf(providers, "web.search", settings.searchProvider, settings.searchOrder),
    browse: sectionOf(providers, "web.browse", settings.browseProvider, settings.browseOrder),
    // 가져오기 설정과 순서는 wire에 없다(F.wire-settings.spec `web.providers`)
    fetch: sectionOf(providers, "web.fetch", "auto", []),
    parallel: settings.searchParallel,
    robots: { value: settings.robots, follows: settings.robots !== "never" },
    recommendations: RECOMMENDED.map((key) => recommendationOf(key, providers)),
    noticesPending: [...new Set(pending)].toSorted(compareCodeUnits),
  };
}

/**
 * 끌어 옮긴 뒤의 전체 순서(`ids`)를 `settings.set` 값으로 바꾼다. 같은 탭에 보이는 행 id만 받고, 알 수 없는 id와
 * 중복 id는 값으로 거부한다. 빠진 id는 거부하지 않는다 [미결: L4.settings-ui §10].
 */
export function orderUpdateOf(
  capability: "web.search" | "web.browse",
  ids: readonly string[],
  known: ToolsWebView,
): Result<OrderUpdate, OrderUpdateError> {
  const section = capability === "web.search" ? known.search : known.browse;
  const visible = new Set(section.rows.map((row) => row.id));
  const seen = new Set<string>();
  for (const id of ids) {
    if (!visible.has(id)) {
      const error: OrderUpdateError = { kind: "unknown_id", id };
      return err(error);
    }
    if (seen.has(id)) {
      const error: OrderUpdateError = { kind: "duplicate_id", id };
      return err(error);
    }
    seen.add(id);
  }
  return ok({ key: ORDER_KEY_OF[capability], value: [...ids] });
}

/**
 * 목록의 `from` 자리 항목을 빼고 `to`가 가리키는 자리에 넣는다. `to`는 옮긴 뒤 그 항목이 갖는 자리다.
 * `from`이나 `to`가 범위 밖(정수가 아님 포함)이면 목록을 바꾸지 않은 복사본을 돌려준다.
 */
export function moveInOrder(ids: readonly string[], from: number, to: number): readonly string[] {
  const inRange = (index: number): boolean =>
    Number.isInteger(index) && index >= 0 && index < ids.length;
  if (!inRange(from) || !inRange(to)) return [...ids];
  const item = ids.at(from);
  if (item === undefined) return [...ids];
  return ids.toSpliced(from, 1).toSpliced(to, 0, item);
}
