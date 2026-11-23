import { stripUnsafeText } from "@fresnel/client/views/app";
import { extMessageOf } from "@fresnel/client/views/native";
import { BRIDGE_CAPABILITIES, type BridgeCapability } from "@fresnel/contracts/extensions";
import type {
  ExtDiagnostic,
  ExtHookInfo,
  ExtKeepOffQuestion,
  ExtListEntry,
  ExtTrust,
  ExtUiEntry,
} from "@fresnel/contracts/wire";
import { appsAllowed } from "../../plugin-ui/policy-context.ts";
import { HELM_EXTENSION } from "./plugin-pick.ts";

// "플레이그라운드"(플러그인이 앱에 더한 화면과 기능, ADR-0021 §3.11, DP-91·92) 목록과 상세의 모델. 순수 함수이고 그리지 않는다.
// 입력은 `ext.ui.list` 항목(화면 런타임 상태), `ext.list` 행(표시 이름, 켜짐, 출처, 진단, 끌까요 질문), `ext.get`(매니페스트, 훅)이다.
// 목록은 화면이 없는 플러그인(훅·에이전트만)도 `ext.list`에서 읽어 보인다. 뒤의 둘은 늦게 오거나 없을 수 있어 없으면 항목만으로 그린다.

/** 플레이그라운드 화면 안의 자리. 목록, 플러그인 하나의 상세, 화면 하나의 실행 */
export type AddonRoute =
  | { readonly kind: "list" }
  | { readonly kind: "plugin"; readonly name: string }
  | { readonly kind: "screen"; readonly key: string };

export const ADDON_LIST: AddonRoute = { kind: "list" };

/** 매니페스트가 선언한 확장 메서드 하나(`ext.<이름>.<verb>`) */
export interface AddonMethod {
  readonly verb: string;
  /** 사용자 조작 없이 부를 수 있다(읽기) */
  readonly readOnly: boolean;
  /** 부르기 전에 승인 카드를 거친다 */
  readonly approval: boolean;
}

/** 확장 하나에 대해 `ext.list`·`ext.get`에서 읽은 것. 읽지 못했으면 칸이 비어 있다 */
export interface AddonMeta {
  /** `ext.list`에 행이 있다(화면이 없어도 목록에 든다) */
  readonly listed?: boolean | undefined;
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly author?: string | undefined;
  readonly license?: string | undefined;
  readonly homepage?: string | undefined;
  readonly repository?: string | undefined;
  readonly version?: string | undefined;
  readonly origin?: ExtTrust | undefined;
  readonly location?: string | undefined;
  readonly requestedGrade?: string | undefined;
  readonly effectiveGrade?: string | undefined;
  readonly isOrchestration?: boolean | undefined;
  /** `ext.list` 상태가 꺼짐·끄는 중이면 거짓 */
  readonly enabled?: boolean | undefined;
  /** 안전 모드로 실리지 않았으면 참 */
  readonly safeMode?: boolean | undefined;
  /** 오류 진단 수 */
  readonly errors?: number | undefined;
  /** 진단 전부(오류와 경고) */
  readonly diagnostics?: readonly ExtDiagnostic[] | undefined;
  /** 자동 끄기 기준을 넘어 "끌까요"를 묻는 중 */
  readonly keepOff?: ExtKeepOffQuestion | undefined;
  /** 훅 이름(겹침 없음, 매니페스트 순서). `ext.get`을 읽지 못했으면 없다 */
  readonly hooks?: readonly string[] | undefined;
  readonly hookCount?: number | undefined;
  readonly methods?: readonly AddonMethod[] | undefined;
}

export type AddonMetaMap = ReadonlyMap<string, AddonMeta>;

/** 화면 런타임 상태 중 모델이 읽는 것(`PluginUiState`의 부분) */
export interface AddonSource {
  readonly entries: readonly ExtUiEntry[];
  readonly inactive: ReadonlySet<string>;
  readonly settings: Readonly<Record<string, unknown>>;
}

/** 화면 하나의 상태. `ready`만 열 수 있다 */
type AddonScreenState = "ready" | "off" | "invalid" | "blocked";

export interface AddonScreen {
  /** `<확장>/<화면 id>` */
  readonly key: string;
  readonly entry: ExtUiEntry;
  readonly title: string;
  readonly where: "page" | "panel";
  /** 플러그인 앱(격리 프레임) 화면인가 */
  readonly app: boolean;
  /** 플러그인 앱이 선언한, 기본 UI로 그릴 수 없는 이유 */
  readonly reason: string | undefined;
  readonly state: AddonScreenState;
  /** `invalid`일 때 첫 진단 문장 */
  readonly issue: string | undefined;
}

/** 대화 쪽에 더한 것: 대화 옆 패널(Helm), 대화 카드, 상태 칸, 명령, 설정 구역 */
export type AddonFeatureKind = "panel" | "card" | "status" | "command" | "settings";

export interface AddonFeature {
  readonly key: string;
  /** 기여 id(명령이면 명령 이름) */
  readonly id: string;
  readonly kind: AddonFeatureKind;
  readonly title: string;
  readonly off: boolean;
}

/** 주의 표시의 무게. 오류는 danger, 확인을 기다리거나 막힌 것은 warning */
export type AddonAttention = "warning" | "danger";

export interface AddonRow {
  readonly name: string;
  readonly title: string;
  readonly monogram: string;
  /** 기여 선언의 아이콘 이름(첫 화면, 없으면 첫 항목의 것). 없으면 머리글자다 */
  readonly icon: string | undefined;
  /** 매니페스트 설명의 첫 줄. 없으면 화면 이름을 잇는다(둘 다 없으면 undefined) */
  readonly summary: string | undefined;
  readonly screens: number;
  readonly features: number;
  readonly version: string;
  readonly trust: ExtTrust;
  /** 엔진과 함께 실린 내장 플러그인. 목록에서 "내장" 묶음에 접힌다 */
  readonly builtin: boolean;
  /** 확장이 꺼졌거나 안전 모드로 빠졌다 */
  readonly off: boolean;
  /** 오류, 끌까요 질문, 열 수 없는 화면 */
  readonly attention: AddonAttention | undefined;
  /** 오류 진단과 고장 난 항목 수 */
  readonly errorCount: number;
}

export type AddonProblem =
  | { readonly kind: "off" }
  | { readonly kind: "safeMode" }
  | { readonly kind: "invalid"; readonly count: number }
  | { readonly kind: "blocked"; readonly count: number };

/** "권한과 위험" 줄 하나. 위험한 것부터 */
export type AddonRisk =
  /** 도구 호출을 막거나 인자·결과를 바꿀 수 있는 훅 */
  | { readonly kind: "toolHooks"; readonly hooks: readonly string[] }
  /** 모델에 가는 요청(시스템 글, 문맥, 헤더)이나 모델 출력을 바꿀 수 있는 훅 */
  | { readonly kind: "requestHooks"; readonly hooks: readonly string[] }
  /** 그 밖의 훅(관찰과 기록) */
  | { readonly kind: "otherHooks"; readonly count: number }
  /** 확장 메서드. 쓰기 메서드가 있으면 `writes`가 그 수다 */
  | { readonly kind: "methods"; readonly methods: readonly AddonMethod[]; readonly writes: number }
  | { readonly kind: "capability"; readonly capability: BridgeCapability };

export interface AddonDetail {
  readonly row: AddonRow;
  /** 매니페스트 설명 전체(안전 글자만). 없으면 undefined */
  readonly description: string | undefined;
  readonly author: string | undefined;
  readonly license: string | undefined;
  readonly homepage: string | undefined;
  readonly repository: string | undefined;
  readonly location: string | undefined;
  readonly requestedGrade: string | undefined;
  readonly effectiveGrade: string | undefined;
  readonly isOrchestration: boolean;
  readonly screens: readonly AddonScreen[];
  readonly features: readonly AddonFeature[];
  /** 플러그인 앱 화면이 선언한 셸 기능 권한(고정 순서, 겹침 없음) */
  readonly capabilities: readonly BridgeCapability[];
  /** 위험한 것부터. 훅을 읽지 못했으면 훅 줄이 없다 */
  readonly risks: readonly AddonRisk[];
  /** 훅·메서드를 읽었는가(`ext.get`). 읽지 못했으면 "권한 없음"이라고 말하지 않는다 */
  readonly risksKnown: boolean;
  /** 플러그인 앱 화면이 하나라도 있다(동작마다 확인 줄이 뜬다) */
  readonly hasApp: boolean;
  readonly problems: readonly AddonProblem[];
  /** 진단(오류 먼저, 같은 무게는 받은 순서). 화면 항목의 진단도 든다 */
  readonly diagnostics: readonly ExtDiagnostic[];
  readonly keepOff: ExtKeepOffQuestion | undefined;
  /** "열기"가 여는 첫 화면. 열 수 있는 화면이 없으면 undefined */
  readonly primary: AddonScreen | undefined;
}

const screenKeyOfEntry = (entry: ExtUiEntry): string => `${entry.extension}/${entry.id}`;

/** 이름의 첫 글자(표지). 라틴 글자는 대문자로. 빈 이름은 "?"다 */
export function monogramOf(title: string): string {
  const first = Array.from(title.trim())[0];
  return first === undefined ? "?" : first.toLocaleUpperCase();
}

/** 확장이 낸 글 하나를 현재 로케일로 풀고 위험한 글자를 뺀다. 비면 대신 글을 쓴다 */
function shownTitle(entry: ExtUiEntry, locale: string): string {
  const title = stripUnsafeText(extMessageOf(entry.messages, locale, entry.title), false).trim();
  return title === "" ? entry.id : title;
}

/** 화면으로 세는 항목: 모든 `page`와 Helm이 아닌 확장의 `panel`(`pluginScreenItemsOf`와 같은 기준) */
export function isScreenEntry(entry: ExtUiEntry): boolean {
  return (
    entry.placement === "page" ||
    (entry.placement === "panel" && entry.extension !== HELM_EXTENSION)
  );
}

function screenStateOf(entry: ExtUiEntry, source: AddonSource, off: boolean): AddonScreenState {
  if (entry.state === "invalid") return "invalid";
  if (off || entry.state === "disabled") return "off";
  if (entry.mode === "app" && !appsAllowed(entry.trust, source.settings)) {
    // 프레임이 막혀도 대신 그릴 트리가 있으면 연다
    return entry.tree === undefined ? "blocked" : "ready";
  }
  return "ready";
}

function firstLine(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const line = stripUnsafeText(text.split(/\r?\n/)[0] ?? "", false).trim();
  return line === "" ? undefined : line;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function offOf(name: string, source: AddonSource, meta: AddonMeta | undefined): boolean {
  return source.inactive.has(name) || meta?.enabled === false || meta?.safeMode === true;
}

function screensOf(
  entries: readonly ExtUiEntry[],
  source: AddonSource,
  off: boolean,
  locale: string,
): readonly AddonScreen[] {
  return entries.filter(isScreenEntry).map((entry) => {
    const state = screenStateOf(entry, source, off);
    const reason = entry.app?.reason;
    return {
      key: screenKeyOfEntry(entry),
      entry,
      title: shownTitle(entry, locale),
      where: entry.placement === "panel" ? "panel" : "page",
      app: entry.mode === "app",
      reason: reason === undefined ? undefined : stripUnsafeText(reason, false),
      state,
      issue:
        state === "invalid"
          ? stripUnsafeText(entry.issues[0]?.message ?? "", false) || undefined
          : undefined,
    };
  });
}

const FEATURE_ORDER: readonly AddonFeatureKind[] = [
  "command",
  "panel",
  "card",
  "status",
  "settings",
];

function featureKindOf(entry: ExtUiEntry): AddonFeatureKind | undefined {
  if (isScreenEntry(entry)) return undefined;
  return entry.placement === "page" ? undefined : entry.placement;
}

function featuresOf(
  entries: readonly ExtUiEntry[],
  off: boolean,
  locale: string,
): readonly AddonFeature[] {
  const features: AddonFeature[] = [];
  for (const entry of entries) {
    const kind = featureKindOf(entry);
    if (kind === undefined) continue;
    features.push({
      key: screenKeyOfEntry(entry),
      id: entry.id,
      kind,
      title: shownTitle(entry, locale),
      off: off || entry.state !== "ok",
    });
  }
  return features.toSorted(
    (left, right) =>
      FEATURE_ORDER.indexOf(left.kind) - FEATURE_ORDER.indexOf(right.kind) ||
      compareText(left.title, right.title),
  );
}

/** 확장 이름별로 항목을 묶는다(입력 순서를 지킨다) */
function byExtension(entries: readonly ExtUiEntry[]): ReadonlyMap<string, readonly ExtUiEntry[]> {
  const groups = new Map<string, ExtUiEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.extension);
    if (list === undefined) groups.set(entry.extension, [entry]);
    else list.push(entry);
  }
  return groups;
}

/** 아이콘 이름: 첫 화면의 것, 없으면 아이콘이 있는 첫 항목의 것 */
function iconOf(entries: readonly ExtUiEntry[]): string | undefined {
  return (
    entries.find((entry) => isScreenEntry(entry) && entry.icon !== undefined)?.icon ??
    entries.find((entry) => entry.icon !== undefined)?.icon
  );
}

function attentionOf(
  entries: readonly ExtUiEntry[],
  screens: readonly AddonScreen[],
  meta: AddonMeta | undefined,
): AddonAttention | undefined {
  if ((meta?.errors ?? 0) > 0 || entries.some((entry) => entry.state === "invalid")) {
    return "danger";
  }
  if (meta?.keepOff !== undefined || screens.some((screen) => screen.state === "blocked")) {
    return "warning";
  }
  return undefined;
}

function rowOf(
  name: string,
  entries: readonly ExtUiEntry[],
  source: AddonSource,
  meta: AddonMeta | undefined,
  locale: string,
): AddonRow {
  const first = entries[0];
  const off = offOf(name, source, meta);
  const screens = screensOf(entries, source, off, locale);
  const title = stripUnsafeText(meta?.displayName ?? "", false).trim() || name;
  const fromScreens = screens.map((screen) => screen.title).join(", ");
  const trust = first?.trust ?? meta?.origin ?? "user";
  return {
    name,
    title,
    monogram: monogramOf(title),
    icon: iconOf(entries),
    summary: firstLine(meta?.description) ?? (fromScreens === "" ? undefined : fromScreens),
    screens: screens.length,
    features: entries.length - screens.length,
    version: first?.version ?? meta?.version ?? "",
    trust,
    builtin: trust === "builtin",
    off,
    attention: attentionOf(entries, screens, meta),
    errorCount: (meta?.errors ?? 0) + entries.filter((entry) => entry.state === "invalid").length,
  };
}

/** 목록에 드는 이름: 화면 항목이 있는 확장과 `ext.list`에 행이 있는 확장 */
function namesOf(source: AddonSource, meta: AddonMetaMap): readonly string[] {
  const names = new Set(source.entries.map((entry) => entry.extension));
  for (const [name, info] of meta) if (info.listed === true) names.add(name);
  return [...names];
}

/** 목록의 행. 표시 이름 순이다. 화면이 없는 플러그인도 `ext.list`에 있으면 든다 */
export function addonRowsOf(
  source: AddonSource,
  meta: AddonMetaMap,
  locale: string,
): readonly AddonRow[] {
  const groups = byExtension(source.entries);
  return namesOf(source, meta)
    .map((name) => rowOf(name, groups.get(name) ?? [], source, meta.get(name), locale))
    .toSorted(
      (left, right) => compareText(left.title, right.title) || compareText(left.name, right.name),
    );
}

/** 머리 줄 탭이 될 수 있는 플러그인(화면이 하나라도 있다), 목록과 같은 순서 */
export function tabbableRowsOf(
  source: AddonSource,
  meta: AddonMetaMap,
  locale: string,
): readonly AddonRow[] {
  return addonRowsOf(source, meta, locale).filter((row) => row.screens > 0);
}

/** 목록을 둘로 나눈다: 사용자가 더한 플러그인과 내장 플러그인 */
export function splitBuiltin(rows: readonly AddonRow[]): {
  readonly added: readonly AddonRow[];
  readonly builtin: readonly AddonRow[];
} {
  return {
    added: rows.filter((row) => !row.builtin),
    builtin: rows.filter((row) => row.builtin),
  };
}

function capabilitiesOf(entries: readonly ExtUiEntry[]): readonly BridgeCapability[] {
  const declared = new Set(entries.flatMap((entry) => entry.app?.capabilities ?? []));
  return BRIDGE_CAPABILITIES.filter((name) => declared.has(name));
}

/** 도구 호출을 막거나 인자·결과를 바꿀 수 있는 훅 */
const TOOL_HOOKS: ReadonlySet<string> = new Set([
  "tool.call.before",
  "guard.tool.before",
  "tool.execution.before",
  "tool.result",
]);

/** 모델 요청이나 출력을 바꿀 수 있는 훅 */
function isRequestHook(hook: string): boolean {
  return (
    (hook.startsWith("request.") && hook.endsWith(".before")) ||
    hook === "guard.model.before" ||
    hook === "guard.output.before"
  );
}

/** 위험한 것부터: 도구 훅, 요청 훅, 쓰기 메서드, 브리지 권한, 그 밖의 훅, 읽기 메서드 */
export function risksOf(
  hooks: readonly string[] | undefined,
  methods: readonly AddonMethod[] | undefined,
  capabilities: readonly BridgeCapability[],
): readonly AddonRisk[] {
  const risks: AddonRisk[] = [];
  const all = hooks ?? [];
  const tool = all.filter((hook) => TOOL_HOOKS.has(hook));
  const request = all.filter((hook) => !TOOL_HOOKS.has(hook) && isRequestHook(hook));
  const other = all.length - tool.length - request.length;
  if (tool.length > 0) risks.push({ kind: "toolHooks", hooks: tool });
  if (request.length > 0) risks.push({ kind: "requestHooks", hooks: request });
  const list = methods ?? [];
  const writes = list.filter((method) => !method.readOnly).length;
  if (writes > 0) risks.push({ kind: "methods", methods: list, writes });
  for (const capability of capabilities) risks.push({ kind: "capability", capability });
  if (other > 0) risks.push({ kind: "otherHooks", count: other });
  if (list.length > 0 && writes === 0) risks.push({ kind: "methods", methods: list, writes: 0 });
  return risks;
}

function problemsOf(
  name: string,
  source: AddonSource,
  meta: AddonMeta | undefined,
  screens: readonly AddonScreen[],
  entries: readonly ExtUiEntry[],
): readonly AddonProblem[] {
  const problems: AddonProblem[] = [];
  if (meta?.safeMode === true) problems.push({ kind: "safeMode" });
  else if (offOf(name, source, meta)) problems.push({ kind: "off" });
  const invalid = entries.filter((entry) => entry.state === "invalid").length;
  if (invalid > 0) problems.push({ kind: "invalid", count: invalid });
  const blocked = screens.filter((screen) => screen.state === "blocked").length;
  if (blocked > 0) problems.push({ kind: "blocked", count: blocked });
  return problems;
}

/** 진단을 모은다: `ext.list` 진단과 화면 항목의 진단. 같은 것(무게·코드·글·파일·줄)은 한 번, 오류 먼저 */
function diagnosticsOf(
  meta: AddonMeta | undefined,
  entries: readonly ExtUiEntry[],
): readonly ExtDiagnostic[] {
  const seen = new Set<string>();
  const out: ExtDiagnostic[] = [];
  for (const item of [...(meta?.diagnostics ?? []), ...entries.flatMap((entry) => entry.issues)]) {
    const id = [item.severity, item.code, item.message, item.file ?? "", item.line ?? 0].join("\0");
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...item, message: stripUnsafeText(item.message, false) });
  }
  return out.toSorted(
    (left, right) => Number(left.severity !== "error") - Number(right.severity !== "error"),
  );
}

/** 플러그인 하나의 상세. 화면 항목도 `ext.list` 행도 없으면 undefined(목록으로 돌아간다) */
export function addonDetailOf(
  name: string,
  source: AddonSource,
  meta: AddonMetaMap,
  locale: string,
): AddonDetail | undefined {
  const entries = source.entries.filter((entry) => entry.extension === name);
  const info = meta.get(name);
  if (entries.length === 0 && info?.listed !== true) return undefined;
  const row = rowOf(name, entries, source, info, locale);
  const screens = screensOf(entries, source, row.off, locale);
  const description =
    info?.description === undefined ? undefined : stripUnsafeText(info.description, true).trim();
  const capabilities = capabilitiesOf(entries);
  return {
    row,
    description: description === "" ? undefined : description,
    author: info?.author,
    license: info?.license,
    homepage: info?.homepage,
    repository: info?.repository,
    location: info?.location,
    requestedGrade: info?.requestedGrade,
    effectiveGrade: info?.effectiveGrade,
    isOrchestration: info?.isOrchestration === true,
    screens,
    features: featuresOf(entries, row.off, locale),
    capabilities,
    risks: risksOf(info?.hooks, info?.methods, capabilities),
    risksKnown: info?.hooks !== undefined,
    hasApp: entries.some((entry) => entry.mode === "app"),
    problems: problemsOf(name, source, info, screens, entries),
    diagnostics: diagnosticsOf(info, entries),
    keepOff: info?.keepOff,
    primary: screens.find((screen) => screen.state === "ready"),
  };
}

/**
 * 자리를 지금 항목에 맞춘다. 없는 플러그인은 목록으로, 없는 화면은 그 플러그인 상세로(그것도 없으면 목록으로) 간다.
 * 화면 자리는 열 수 있는 화면만 남긴다(꺼졌거나 고장 난 화면은 상세가 이유를 보인다). `listed`는 `ext.list`에 있는 이름이다
 */
export function addonRouteOf(
  route: AddonRoute,
  entries: readonly ExtUiEntry[],
  listed: ReadonlySet<string> = new Set(),
): AddonRoute {
  if (route.kind === "list") return route;
  const known = (name: string): boolean =>
    listed.has(name) || entries.some((entry) => entry.extension === name);
  if (route.kind === "plugin") return known(route.name) ? route : ADDON_LIST;
  const entry = entries.find((item) => screenKeyOfEntry(item) === route.key);
  if (entry !== undefined && isScreenEntry(entry)) return route;
  const name = route.key.split("/")[0] ?? "";
  return known(name) ? { kind: "plugin", name } : ADDON_LIST;
}

/** 비지 않은 글이면 그 값, 아니면 undefined */
function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** 링크로 보일 주소: http(s)만 */
function linkOf(value: unknown): string | undefined {
  const text = textOf(value);
  return text !== undefined && /^https?:\/\//i.test(text) ? text : undefined;
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
}

/** 매니페스트 `methods`에서 모양이 맞는 것만 읽는다 */
function methodsOf(value: unknown): readonly AddonMethod[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: AddonMethod[] = [];
  for (const item of value) {
    const verb = textOf(fieldOf(item, "verb"));
    if (verb === undefined) continue;
    out.push({
      verb,
      readOnly: fieldOf(item, "readOnly") === true,
      approval: fieldOf(item, "approval") === true,
    });
  }
  return out;
}

/** 훅 이름(겹침 없음, 받은 순서) */
function hookNamesOf(hooks: readonly ExtHookInfo[]): readonly string[] {
  return [...new Set(hooks.map((hook) => hook.hook))];
}

/** `ext.list` 행과 `ext.get` 매니페스트·훅에서 상세 칸을 읽는다. 매니페스트 값은 모양을 확인한 것만 쓴다 */
export function addonMetaOf(
  entry: ExtListEntry | undefined,
  manifest: Readonly<Record<string, unknown>> | undefined,
  hooks?: readonly ExtHookInfo[],
): AddonMeta {
  const author = manifest?.["author"];
  const authorName = typeof author === "string" ? textOf(author) : textOf(fieldOf(author, "name"));
  const repository = manifest?.["repository"];
  return {
    listed: entry !== undefined,
    displayName: entry?.displayName,
    description: textOf(manifest?.["description"]),
    author: authorName,
    license: textOf(manifest?.["license"]),
    homepage: linkOf(manifest?.["homepage"]),
    repository: linkOf(repository) ?? linkOf(fieldOf(repository, "url")),
    version: entry?.version,
    origin: entry?.origin,
    location: entry === undefined || entry.location === "" ? undefined : entry.location,
    requestedGrade: entry?.requestedGrade,
    effectiveGrade: entry?.effectiveGrade,
    isOrchestration: entry?.isOrchestration,
    enabled:
      entry === undefined ? undefined : entry.status === "enabled" || entry.status === "enabling",
    safeMode: entry === undefined ? undefined : entry.safeModeExcluded !== null,
    errors: entry?.diagnostics.filter((item) => item.severity === "error").length,
    diagnostics: entry?.diagnostics,
    keepOff: entry?.keepOffQuestion,
    hooks: hooks === undefined ? undefined : hookNamesOf(hooks),
    hookCount: entry?.hookCount,
    methods: manifest === undefined ? undefined : methodsOf(manifest["methods"]),
  };
}
