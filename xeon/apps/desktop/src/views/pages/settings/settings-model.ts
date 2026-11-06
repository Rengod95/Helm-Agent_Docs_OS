import type {
  BadgeScope,
  FieldVM,
  SettingsView,
  TabVM,
  WidgetVM,
  WritableScope,
} from "@fresnel/client/settings";
import { tKey } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { SettingEditor, SettingKey, SettingsTab } from "@fresnel/contracts/settings";

// 설정 화면(P-09)의 순수 모델. 탭 고르기, 키 찾기, 탭 옮길 때 초안 묻기, 입력 칸 고르기, 화면 상태를 값으로 만든다.
// 입력은 `SettingsView`(client)와 화면 상태뿐이다. 호스트를 부르지 않고 DOM도 보지 않는다.

/** 옵션이 이 개수 이하이면 라디오 묶음, 넘으면 선택 상자다(L4.settings-ui §4.2.1) */
const RADIO_MAX_OPTIONS = 8;

/** "저장됨" 표시가 보이는 시간(ms). L4.desktop-ux §6.13 */
export const SAVED_MARK_MS = 2000;

// ── 탭 ─────────────────────────────────────────────────────────────────────

/** 탭 목록의 ↑↓. 끝에서 한 바퀴 돈다. 모르는 탭이면 현재 탭을 돌려준다 */
export function tabStep(
  current: SettingsTab,
  order: readonly SettingsTab[],
  delta: 1 | -1,
): SettingsTab {
  const index = order.indexOf(current);
  if (index === -1 || order.length === 0) return current;
  const next = (index + delta + order.length) % order.length;
  return order[next] ?? current;
}

/** 탭 전환 결정. `ask`이면 저장하지 않은 초안을 먼저 묻는다 */
export type TabSwitch =
  | { readonly kind: "stay" }
  | { readonly kind: "move"; readonly to: SettingsTab }
  | { readonly kind: "ask"; readonly to: SettingsTab; readonly keys: readonly SettingKey[] };

/** 같은 탭이면 머문다. 초안이 없으면 바로 옮긴다. 초안이 있으면 그 키들과 함께 묻는다 */
export function tabSwitchOf(input: {
  readonly current: SettingsTab;
  readonly to: SettingsTab;
  readonly dirtyKeys: readonly SettingKey[];
}): TabSwitch {
  if (input.to === input.current) return { kind: "stay" };
  if (input.dirtyKeys.length === 0) return { kind: "move", to: input.to };
  return { kind: "ask", to: input.to, keys: input.dirtyKeys };
}

// ── 고급 탭 구역 ──────────────────────────────────────────────────────────

/** 고급 탭에서 운영자가 만지는 항목. 하트비트, 임대, fsync, FTS5, 수집기, 외부 실행 파일 같은 것이다 */
const OPERATOR_KEYS: ReadonlySet<string> = new Set([
  "l0.store.heartbeatMs",
  "l0.store.leaseTtlMs",
  "l0.store.macFullFsync",
  "l0.store.requireFts5",
  "l0.os.telemetry.enabled",
  "l0.os.telemetry.exporter",
  "l0.os.telemetry.endpoint",
  "l0.secrets.sops.binary",
  "l2.knowledge.search.likeScanLimit",
  "l2.knowledge.write.trustedEvidenceSources",
  "l2.work.goal.delegatedTimeoutSec",
  "l4.desktop.engine.shutdownGraceMs",
]);

export interface AdvancedGroups {
  readonly general: readonly FieldVM[];
  readonly operator: readonly FieldVM[];
}

/** 고급 탭의 항목을 일반 항목과 운영자용 항목으로 가른다. 순서는 그대로다 */
export function advancedGroupsOf(fields: readonly FieldVM[]): AdvancedGroups {
  return {
    general: fields.filter((field) => !OPERATOR_KEYS.has(field.key)),
    operator: fields.filter((field) => OPERATOR_KEYS.has(field.key)),
  };
}

// ── 키 찾기 ────────────────────────────────────────────────────────────────

/** 찾기 입력은 앞뒤 공백을 뺀 소문자로 비교한다 */
function normalizeQuery(text: string): string {
  return text.trim().toLocaleLowerCase();
}

/** 라벨, 키, 설명 가운데 하나라도 찾는 글을 포함하면 맞는다. 빈 찾기는 모든 항목이 맞는다 */
export function fieldMatches(field: FieldVM, query: string): boolean {
  const needle = normalizeQuery(query);
  if (needle === "") return true;
  const haystack = [field.label, field.key, field.help ?? ""].join("\n").toLocaleLowerCase();
  return haystack.includes(needle);
}

export interface SearchGroup {
  readonly tab: SettingsTab;
  readonly label: string;
  readonly fields: readonly FieldVM[];
}

/** 찾기 결과를 탭별로 묶는다. 맞는 항목이 없는 탭은 뺀다. 탭 순서와 항목 순서는 그대로다 */
export function searchGroupsOf(tabs: readonly TabVM[], query: string): readonly SearchGroup[] {
  return tabs
    .map((tab) => ({
      tab: tab.id,
      label: tab.label,
      fields: tab.fields.filter((field) => fieldMatches(field, query)),
    }))
    .filter((group) => group.fields.length > 0);
}

// ── 초안과 저장 ────────────────────────────────────────────────────────────

/** 저장하지 않은 초안의 키. 화면 순서(탭 순서, 항목 순서)를 따른다 */
export function dirtyKeysOf(tabs: readonly TabVM[]): readonly SettingKey[] {
  return tabs.flatMap((tab) => tab.fields.filter((field) => field.dirty).map((field) => field.key));
}

/** 항목마다 저장 버튼이 따로 있는 위젯인가. 목록과 전용 편집기는 저장과 되돌리기 줄을 쓴다(L4.settings-ui §4.4.1) */
export function hasFooter(field: FieldVM): boolean {
  const control = fieldControlOf(field);
  return control === "tags" || control === "editor";
}

/** 바깥 변경을 알리는 줄을 보인다. 초안이 있는 항목에서만 참이다 */
export function remoteNoticeOf(field: FieldVM): boolean {
  return field.remoteChanged && field.dirty;
}

/**
 * 배지 범위를 쓸 수 있는 범위로 좁힌다. 기본값과 `managed`는 쓸 수 없으니 `null`이다.
 * 되돌리기 버튼이 이 값으로 범위를 정한다.
 */
export function writableOf(scope: BadgeScope): WritableScope | null {
  switch (scope) {
    case "user":
    case "project":
    case "local":
    case "launch":
      return scope;
    case "managed":
    case "default":
      return null;
    default:
      return assertNever(scope, "BadgeScope");
  }
}

/** 대화 범위 체크를 껐을 때 돌아갈 범위. 대화 범위가 아닌 첫 후보다 */
export function fallbackScopeOf(field: FieldVM): WritableScope | null {
  return field.writableScopes.find((scope) => scope !== "launch") ?? null;
}

/** "이번 대화에만 적용" 체크를 보이는가와 켜졌는가. 열린 대화가 있고 대화 범위를 쓸 수 있을 때만 보인다 */
export function launchChoiceOf(
  field: FieldVM,
  hasThread: boolean,
): { readonly shown: boolean; readonly checked: boolean } {
  return {
    shown: hasThread && field.writableScopes.includes("launch"),
    checked: field.selectedScope === "launch",
  };
}

/** 쓸 범위가 둘 이상이면 범위를 고르는 선택 상자를 보인다 */
export function scopeChoiceShown(field: FieldVM): boolean {
  return field.writableScopes.length > 1;
}

// ── 입력 칸 ────────────────────────────────────────────────────────────────

/** 위젯 하나가 그려지는 칸. `editor`는 전용 편집기(P-11), `summary`는 읽기 요약과 "파일로 보기" 안내다 */
export type FieldControl = "switch" | "select" | "number" | "text" | "tags" | "editor" | "summary";

/**
 * 화면이 전용 편집기로 그리는 종류. 계정 풀, 레이트 리밋 표, 모델 역할, 대체 사슬(P-11), 권한 규칙, 샌드박스 목록,
 * 시크릿 참조(P-09 §6.13), 외부 훅 정의(X.operations §4.7)와 일반 표(`table` 위젯의 세 모양)다.
 */
export type DedicatedEditorKind =
  | "accountPool"
  | "modelRoles"
  | "fallbackChain"
  | "rateLimit"
  | "permissionRules"
  | "sandboxLists"
  | "secretRef"
  | "hookDefs"
  | "table";

/** 키 이름으로 고르는 전용 편집기(L4.settings-ui §4.2.4). 편집기 힌트가 없을 때 쓴다 */
const EDITOR_BY_KEY: ReadonlyMap<SettingKey, DedicatedEditorKind> = new Map<
  SettingKey,
  DedicatedEditorKind
>([
  ["l1.models.accounts", "accountPool"],
  ["l1.models.rateLimit", "rateLimit"],
  ["l1.models.fallbackChains", "fallbackChain"],
  ["l1.tools.rules", "permissionRules"],
  ["l0.sandbox.writeRoots.extra", "sandboxLists"],
  ["l0.sandbox.network.blockedDomains", "sandboxLists"],
  ["x.operations.hookDefs", "hookDefs"],
]);

/** 검색 순서 키. 도구와 웹 패널이 맡으므로 항목 목록에서 뺀다(`panelOwnedOf`) */
const SEARCH_ORDER_KEY: SettingKey = "l2.web.search.order";

/** 편집기 힌트(`ui.editor`)를 화면 종류로. 화면이 그리지 않는 힌트는 `null`이다(요약으로 둔다) */
function editorHintOf(editor: SettingEditor | null): DedicatedEditorKind | null {
  switch (editor) {
    case "accountPool":
      return "accountPool";
    case "modelRoles":
      return "modelRoles";
    case "fallbackChain":
      return "fallbackChain";
    case "permissionRules":
      return "permissionRules";
    case "sandboxLists":
      return "sandboxLists";
    case "searchOrder":
    case null:
      return null;
    default:
      return assertNever(editor, "SettingEditor");
  }
}

/** 위젯 종류로 고르는 일반 편집기. 시크릿은 참조 선택기, 표는 표 편집기다 */
function widgetEditorOf(widget: WidgetVM): DedicatedEditorKind | null {
  switch (widget.kind) {
    case "secret":
      return "secretRef";
    case "table":
      return "table";
    case "toggle":
    case "select":
    case "number":
    case "text":
    case "list":
    case "readonly":
      return null;
    default:
      return assertNever(widget, "WidgetVM");
  }
}

/**
 * 항목을 그릴 전용 편집기 종류. 편집기 힌트가 먼저이고, 없으면 키 이름이고, 그다음은 위젯 종류다.
 * 해당 없으면 `null`이다
 */
export function dedicatedEditorOf(field: FieldVM): DedicatedEditorKind | null {
  return editorHintOf(field.editor) ?? EDITOR_BY_KEY.get(field.key) ?? widgetEditorOf(field.widget);
}

/** 읽기 전용 값을 접어 보일 가치가 있는가. 객체와 배열은 JSON으로 접어 보이고, 원시 값은 글로 보인다 */
export function foldableOf(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/** 확장 켜짐 키. "플러그인과 그룹" 탭의 실행 화면(`PluginsPanel`)이 스위치로 그리므로 항목 목록에서는 뺀다 */
const EXT_ENABLED_KEY = /^ext\.[^.]+\.enabled$/;

/** 도구와 웹 패널이 맡는 항목인가(검색 순서)과 확장 켜짐 스위치. 패널이 그리므로 탭의 항목 목록에서는 뺀다 */
export function panelOwnedOf(field: FieldVM): boolean {
  return (
    field.editor === "searchOrder" ||
    field.key === SEARCH_ORDER_KEY ||
    EXT_ENABLED_KEY.test(field.key)
  );
}

/**
 * 위젯 종류에서 칸을 고른다. 전용 편집기가 있으면 `editor`다(표와 시크릿도 여기서 편집기를 얻는다).
 * 편집기가 없는 힌트와 읽기 전용은 요약이다.
 */
export function fieldControlOf(field: FieldVM): FieldControl {
  if (dedicatedEditorOf(field) !== null) return "editor";
  if (field.editor !== null) return "summary";
  const widget = field.widget;
  switch (widget.kind) {
    case "toggle":
      return "switch";
    case "select":
      return "select";
    case "number":
      return "number";
    case "text":
      return "text";
    case "list":
      return "tags";
    case "table":
    case "secret":
    case "readonly":
      return "summary";
    default:
      return assertNever(widget, "WidgetVM");
  }
}

/** 선택 항목이 라디오 묶음이면 `radio`, 선택 상자면 `select`다. 경계는 `RADIO_MAX_OPTIONS`다 */
export function selectControlOf(optionCount: number): "radio" | "select" {
  return optionCount <= RADIO_MAX_OPTIONS ? "radio" : "select";
}

/** 옵션 값을 화면 문자열로. 라디오와 선택 상자의 값은 문자열이다 */
export function optionTextOf(option: string | number): string {
  return String(option);
}

function camel(word: string): string {
  return word.replace(/[-_]+([A-Za-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * 선택지의 화면 라벨. 카탈로그에 `settings.<설정 키>.option.<값>`이 있으면 그 문장이고, 없으면 값 그대로다.
 * 키 조각은 영문자와 숫자만 쓰므로 `-`와 `_`로 이은 값은 camelCase로 바꾼다(`disable_execute` → `disableExecute`).
 */
export function optionLabelOf(key: SettingKey, option: string | number): string {
  const text = optionTextOf(option);
  const base = `settings.${camel(key)}`;
  return tKey(`${base}.option.${camel(text)}`, text);
}

/** 화면 문자열을 원래 옵션 값(문자열 또는 숫자)으로 되돌린다. 맞는 옵션이 없으면 `null`이다 */
export function optionOf(
  options: readonly (string | number)[],
  text: string,
): string | number | null {
  return options.find((option) => optionTextOf(option) === text) ?? null;
}

/** 숫자 칸의 값. 숫자가 아니면 `null`이다 */
export function numberValueOf(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** 글 칸의 값. 글이 아니면 빈 글이다 */
export function textValueOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 목록 칸의 값. 배열이 아니면 빈 목록이다. 원소는 글로 바꾼다 */
export function tagsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

/** 값이 있는 요약. 표와 객체는 원소 수로, 원시 값은 글로 보인다 */
export type ValueSummary =
  | { readonly kind: "empty" }
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "text"; readonly text: string };

export function valueSummaryOf(value: unknown): ValueSummary {
  if (value === null || value === undefined) return { kind: "empty" };
  if (Array.isArray(value)) return { kind: "count", count: value.length };
  if (typeof value === "object") return { kind: "count", count: Object.keys(value).length };
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { kind: "text", text: String(value) };
  }
  return { kind: "text", text: JSON.stringify(value) };
}

// ── 바로 가기 키 ───────────────────────────────────────────────────────────

/** 설정 화면의 바로 가기 뜻. ⌘S 저장, Esc 되돌리기, ⌘F 키 찾기(L4.desktop-ux §6.13) */
export type SettingsKeyIntent = "save" | "discard" | "search";

/** 키 입력이 설정 화면의 바로 가기면 그 뜻을 돌려준다. ⌘와 Ctrl은 같은 뜻이다 */
export function settingsKeyOf(input: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}): SettingsKeyIntent | null {
  const modified = input.metaKey || input.ctrlKey;
  if (input.key === "Escape") return "discard";
  if (!modified) return null;
  const letter = input.key.toLocaleLowerCase();
  if (letter === "s") return "save";
  if (letter === "f") return "search";
  return null;
}

// ── 화면 상태 ──────────────────────────────────────────────────────────────

/** 화면 본문이 무엇을 보이는가. 읽기 전용(오프라인)은 `ready`에서 따로 묻는다 */
export type PageStatus = "offline" | "loading" | "failed" | "ready";

/**
 * 연결과 읽기 상태로 본문을 고른다. 컨트롤러가 없고 연결도 없으면 오프라인이다.
 * 컨트롤러가 있으면 읽은 값을 보인다. 연결이 끊겼으면 읽기 전용이다(`ready`에서 `readOnly`).
 */
export function pageStatusOf(input: {
  readonly live: boolean;
  readonly hasController: boolean;
  readonly loadStatus: "idle" | "loading" | "ready" | "failed";
}): PageStatus {
  if (!input.hasController) return input.live ? "loading" : "offline";
  if (input.loadStatus === "failed") return "failed";
  if (input.loadStatus === "ready") return "ready";
  return "loading";
}

/** 화면 위쪽의 재시작 띠 문장 수. 재시작이 필요한 변경이 없으면 0이다 */
export function restartCountOf(view: SettingsView): number {
  return view.restartBanner?.count ?? 0;
}

/** 탭 순서대로 모든 항목. 초안 묻기와 저장·버리기 묶음이 이 목록을 쓴다 */
export function allFieldsOf(view: SettingsView): readonly FieldVM[] {
  return view.tabs.flatMap((tab) => tab.fields);
}

/**
 * 숫자 칸이 알려 주는 글 초안을 컨트롤러가 어떻게 받는가. 쓸 수 있는 글은 초안으로 올린다. 글이 비워졌을 때(칸이 끝났다고 알림)
 * 초안이 있으면: Esc였으면 버리고, 아니면(블러나 Enter. 올린 초안이 칸의 값이라 칸은 `onValueChange`를 따로 부르지 않는다) 저장한다.
 * 저장 호출이 이미 간 뒤의 알림(`committing`)은 건드리지 않는다.
 */
export function numberDraftActionOf(
  draft: { readonly dirty: boolean; readonly error: string | null; readonly value: number | null },
  state: { readonly fieldDirty: boolean; readonly committing: boolean; readonly escaped: boolean },
):
  | { readonly kind: "edit"; readonly value: number }
  | { readonly kind: "discard" }
  | { readonly kind: "commit" }
  | null {
  if (draft.dirty && draft.error === null && draft.value !== null) {
    return { kind: "edit", value: draft.value };
  }
  if (draft.dirty || !state.fieldDirty || state.committing) return null;
  return state.escaped ? { kind: "discard" } : { kind: "commit" };
}
