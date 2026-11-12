import type { FieldVM, SettingsView, TabVM, WidgetVM } from "@fresnel/client/settings";
import { createTranslator, isLocale, t, tKey, UI_LOCALE_KEY } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { SettingEditor, SettingKey } from "@fresnel/contracts/settings";
import { shortenHome } from "./settings-file-paths.ts";
import { MCP_SERVERS_KEY } from "./settings-mcp-model.ts";

// 설정 화면(P-09)의 순수 모델. 탭 고르기, 키 찾기, 탭 옮길 때 초안 묻기, 입력 칸 고르기, 화면 상태를 값으로 만든다.
// 입력은 `SettingsView`(client)와 화면 상태뿐이다. 호스트를 부르지 않고 DOM도 보지 않는다.

/** "저장됨" 표시가 보이는 시간(ms). L4.desktop-ux §6.13 */
export const SAVED_MARK_MS = 2000;

// ── 구역 옮기기 ─────────────────────────────────────────────────────────

/** 구역 전환 결정. `ask`이면 저장하지 않은 초안을 먼저 묻는다 */
export type SectionSwitch<T extends string> =
  | { readonly kind: "stay" }
  | { readonly kind: "move"; readonly to: T }
  | { readonly kind: "ask"; readonly to: T; readonly keys: readonly SettingKey[] };

/** 같은 구역이면 머문다. 초안이 없으면 바로 옮긴다. 초안이 있으면 그 키들과 함께 묻는다 */
export function sectionSwitchOf<T extends string>(input: {
  readonly current: T;
  readonly to: T;
  readonly dirtyKeys: readonly SettingKey[];
}): SectionSwitch<T> {
  if (input.to === input.current) return { kind: "stay" };
  if (input.dirtyKeys.length === 0) return { kind: "move", to: input.to };
  return { kind: "ask", to: input.to, keys: input.dirtyKeys };
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
 * 사용자(전역) 값을 덮어쓰는 층의 경고(§4.3 [결정: 2026-11-11 사용자]). 유효 값을 정한 층이 작업 폴더 파일(project, local)이거나
 * 대화에 따로 준 값(launch)이면 한 줄을 보인다. 관리 정책은 잠금 문장이 맡고, 사용자와 기본값은 경고가 없다.
 */
export function overrideNoticeOf(
  field: FieldVM,
): { readonly text: string; readonly path: string | null } | null {
  const scope = field.scope.scope;
  switch (scope) {
    case "project":
    case "local":
      return {
        text: t("desktop.settings.override.folder"),
        path: field.filePath === null ? null : shortenHome(field.filePath),
      };
    case "launch":
      return { text: t("desktop.settings.override.thread"), path: null };
    case "user":
    case "managed":
    case "default":
      return null;
    default:
      return assertNever(scope, "BadgeScope");
  }
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

/** 찾는 글이 "MCP 서버" 구역(표 항목의 이름·키·설명)에 맞는가. 맞으면 찾기 결과의 도구와 MCP 자리에 구역을 그린다 */
export function mcpSectionMatchesOf(tabs: readonly TabVM[], query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return false;
  return tabs.some((tab) =>
    tab.fields.some(
      (field) =>
        field.key === MCP_SERVERS_KEY &&
        [field.label, field.key, field.help ?? ""].join("\n").toLocaleLowerCase().includes(needle),
    ),
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

/** 경로·명령을 받는 글 항목. 줄 전체 폭 칸을 쓰는 두 줄 행이다(폼 표준 2절 "경로·주소·명령") */
export const PATH_TEXT_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>(["l0.exec.shell"]);

/** 행 모양. 한 줄 행은 컨트롤이 제목 오른쪽에, 두 줄 행은 제목 아래 열 폭으로 놓인다 */
export type RowLayout = "inline" | "stacked";

/**
 * 컨트롤 종류에서 행 모양을 고른다(§4.2 [결정: 2026-11-11 사용자]). 스위치, 숫자, 짧은 글, 설명 없는 고르기는 한 줄이다.
 * 목록, 표, 전용 편집기, 읽기 요약, 선택지마다 설명이 붙은 고르기는 두 줄이다.
 */
export function rowLayoutOf(field: FieldVM, control: FieldControl): RowLayout {
  switch (control) {
    case "text":
      return PATH_TEXT_KEYS.has(field.key) ? "stacked" : "inline";
    case "switch":
    case "number":
      return "inline";
    case "select":
      return field.widget.kind === "select" &&
        field.widget.options.some((option) => optionHelpOf(field.key, option) !== null)
        ? "stacked"
        : "inline";
    case "tags":
    case "editor":
    case "summary":
      return "stacked";
    default:
      return assertNever(control, "FieldControl");
  }
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
  // 표시 언어 선택지는 각 언어가 자기 이름으로 쓴다(`한국어`, `English`). 잘못 바뀐 사람도 자기 언어를 찾는다
  if (key === UI_LOCALE_KEY && isLocale(text)) {
    return createTranslator(text).tKey(`settings.l4.ui.locale.option.${text}`, text);
  }
  return tKey(`${optionBaseOf(key)}.option.${camel(text)}`, text);
}

/** 선택지 문구 키의 앞부분. 확장마다 있는 격리 설정(`ext.<이름>.isolation`)은 선택지 문구를 한 벌로 둔다(rtE R-6c) */
function optionBaseOf(key: SettingKey): string {
  return /^ext\.[^.]+\.isolation$/.test(key) ? "settings.ext.isolation" : `settings.${camel(key)}`;
}

/**
 * 선택지 한 줄 설명. 카탈로그에 `settings.<설정 키>.optionHelp.<값>`이 있으면 그 문장이고, 없으면 `null`이다(설명 줄을 긋지 않는다).
 * `tKey`는 키가 없으면 대체 문구를 돌려주므로 빈 대체 문구로 없음을 가린다
 */
export function optionHelpOf(key: SettingKey, option: string | number): string | null {
  const help = tKey(`${optionBaseOf(key)}.optionHelp.${camel(optionTextOf(option))}`, "");
  return help === "" ? null : help;
}

/**
 * 경고 줄을 보이는 선택지. 모두 허용은 확인 없이 명령과 편집을 바로 실행하므로, 고르면 설명을 경고 줄로도 바닥에 보인다.
 * 여기 적힌 값만 경고 줄을 얻는다(확인 대화는 없다)
 */
const CHOICE_WARNINGS: ReadonlyMap<SettingKey, readonly string[]> = new Map<
  SettingKey,
  readonly string[]
>([["l1.tools.permissionMode", ["bypass"]]]);

/** 지금 고른 값의 경고 줄 글. 경고 선택지가 아니거나 설명이 없으면 `null`이다 */
export function choiceWarningOf(key: SettingKey, text: string): string | null {
  if (!(CHOICE_WARNINGS.get(key) ?? []).includes(text)) return null;
  return optionHelpOf(key, text);
}

/**
 * 쓸 수 없고 켜진 스위치의 칸 클래스(잠금이나 읽기 전용). caustic은 쓸 수 없는 스위치를 회색 바닥으로 그려 꺼진 것처럼 읽히므로,
 * 켜진 색을 그대로 두고 살짝만 흐린다. 꺼진 스위치와 쓸 수 있는 스위치는 caustic 기본 모양을 그대로 쓴다(`undefined`)
 */
export const DISABLED_ON_SWITCH_CLASS =
  "disabled:data-[state=checked]:bg-accent-solid disabled:opacity-75";

export function switchClassOf(checked: boolean, disabled: boolean): string | undefined {
  return checked && disabled ? DISABLED_ON_SWITCH_CLASS : undefined;
}

/**
 * 표 열 머리의 화면 글. 카탈로그에 `settings.<설정 키>.column.<열 이름>`이 있으면 그 문장이고, 없으면 열 이름 그대로다.
 * 열 이름은 속성 이름이라(`apiKeyRef`) 보통 그대로 쓰고, `-`·`_`만 camelCase로 바꾼다.
 */
export function columnLabelOf(key: SettingKey, column: string): string {
  return tKey(`settings.${camel(key)}.column.${camel(column)}`, column);
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

// ── 항목 행이 부르는 동작 ─────────────────────────────────────────────────

export interface FieldHandlers {
  /** 초안만 바꾼다(글 칸과 목록 칸은 저장 버튼이나 떠날 때 저장한다) */
  readonly edit: (key: SettingKey, raw: unknown) => void;
  /** 바꾸고 바로 저장한다(켜기, 고르기, 숫자 칸) */
  readonly change: (key: SettingKey, raw: unknown) => void;
  /** 초안을 저장한다 */
  readonly commit: (key: SettingKey) => void;
  readonly discard: (key: SettingKey) => void;
  /** 다른 곳에서 바뀐 값을 두고 내 초안을 유지한다("내 값 유지") */
  readonly keepDraft: (key: SettingKey) => void;
  /** 사용자 범위 값을 지워 기본값으로 되돌린다 */
  readonly reset: (key: SettingKey) => void;
}
