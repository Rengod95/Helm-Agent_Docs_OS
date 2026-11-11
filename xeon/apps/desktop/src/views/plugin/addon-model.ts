import { stripUnsafeText } from "@fresnel/client/views/app";
import { extMessageOf } from "@fresnel/client/views/native";
import { BRIDGE_CAPABILITIES, type BridgeCapability } from "@fresnel/contracts/extensions";
import type { ExtListEntry, ExtTrust, ExtUiEntry } from "@fresnel/contracts/wire";
import { appsAllowed } from "../../plugin-ui/policy-context.ts";
import { HELM_EXTENSION } from "./plugin-pick.ts";

// "플레이그라운드"(플러그인이 앱에 더한 화면과 기능, ADR-0021 §3.11) 목록과 상세의 모델. 순수 함수이고 그리지 않는다.
// 입력은 `ext.ui.list` 항목(화면 런타임 상태), `ext.list` 행(표시 이름, 켜짐), `ext.get` 매니페스트(설명, 만든 이)다.
// 셋 중 뒤의 둘은 늦게 오거나 없을 수 있어 없으면 항목만으로 그린다.

/** 플레이그라운드 화면 안의 자리. 목록, 플러그인 하나의 상세, 화면 하나의 실행 */
export type AddonRoute =
  | { readonly kind: "list" }
  | { readonly kind: "plugin"; readonly name: string }
  | { readonly kind: "screen"; readonly key: string };

export const ADDON_LIST: AddonRoute = { kind: "list" };

/** 확장 하나에 대해 `ext.list`·`ext.get`에서 읽은 것. 읽지 못했으면 칸이 비어 있다 */
export interface AddonMeta {
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly author?: string | undefined;
  readonly license?: string | undefined;
  /** `ext.list` 상태가 꺼짐·끄는 중이면 거짓 */
  readonly enabled?: boolean | undefined;
  /** 안전 모드로 실리지 않았으면 참 */
  readonly safeMode?: boolean | undefined;
  /** 오류 진단 수 */
  readonly errors?: number | undefined;
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
  readonly kind: AddonFeatureKind;
  readonly title: string;
  readonly off: boolean;
}

export interface AddonRow {
  readonly name: string;
  readonly title: string;
  readonly monogram: string;
  /** 매니페스트 설명의 첫 줄. 없으면 화면 이름을 잇는다(둘 다 없으면 undefined) */
  readonly summary: string | undefined;
  readonly screens: number;
  readonly features: number;
  readonly version: string;
  readonly trust: ExtTrust;
  /** 확장이 꺼졌거나 안전 모드로 빠졌다 */
  readonly off: boolean;
  /** 열 수 없는 화면이나 오류 진단이 있다 */
  readonly attention: boolean;
}

export type AddonProblem =
  | { readonly kind: "off" }
  | { readonly kind: "safeMode" }
  | { readonly kind: "invalid"; readonly count: number }
  | { readonly kind: "blocked"; readonly count: number }
  | { readonly kind: "errors"; readonly count: number };

export interface AddonDetail {
  readonly row: AddonRow;
  /** 매니페스트 설명 전체(안전 글자만). 없으면 undefined */
  readonly description: string | undefined;
  readonly author: string | undefined;
  readonly license: string | undefined;
  readonly screens: readonly AddonScreen[];
  readonly features: readonly AddonFeature[];
  /** 플러그인 앱 화면이 선언한 셸 기능 권한(고정 순서, 겹침 없음) */
  readonly capabilities: readonly BridgeCapability[];
  /** 플러그인 앱 화면이 하나라도 있다(동작마다 확인 줄이 뜬다) */
  readonly hasApp: boolean;
  readonly problems: readonly AddonProblem[];
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
function isScreen(entry: ExtUiEntry): boolean {
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
  return entries.filter(isScreen).map((entry) => {
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
  "panel",
  "card",
  "command",
  "status",
  "settings",
];

function featureKindOf(entry: ExtUiEntry): AddonFeatureKind | undefined {
  if (isScreen(entry)) return undefined;
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
  return {
    name,
    title,
    monogram: monogramOf(title),
    summary: firstLine(meta?.description) ?? (fromScreens === "" ? undefined : fromScreens),
    screens: screens.length,
    features: entries.length - screens.length,
    version: first?.version ?? "",
    trust: first?.trust ?? "user",
    off,
    attention:
      entries.some((entry) => entry.state === "invalid") ||
      screens.some((screen) => screen.state === "blocked") ||
      (meta?.errors ?? 0) > 0,
  };
}

/** 목록의 행. `ext.ui.list` 항목이 하나라도 있는 확장마다 하나, 표시 이름 순이다 */
export function addonRowsOf(
  source: AddonSource,
  meta: AddonMetaMap,
  locale: string,
): readonly AddonRow[] {
  return [...byExtension(source.entries)]
    .map(([name, entries]) => rowOf(name, entries, source, meta.get(name), locale))
    .toSorted(
      (left, right) => compareText(left.title, right.title) || compareText(left.name, right.name),
    );
}

function capabilitiesOf(entries: readonly ExtUiEntry[]): readonly BridgeCapability[] {
  const declared = new Set(entries.flatMap((entry) => entry.app?.capabilities ?? []));
  return BRIDGE_CAPABILITIES.filter((name) => declared.has(name));
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
  const errors = meta?.errors ?? 0;
  if (errors > 0) problems.push({ kind: "errors", count: errors });
  return problems;
}

/** 플러그인 하나의 상세. 항목이 하나도 없으면 undefined(목록으로 돌아간다) */
export function addonDetailOf(
  name: string,
  source: AddonSource,
  meta: AddonMetaMap,
  locale: string,
): AddonDetail | undefined {
  const entries = source.entries.filter((entry) => entry.extension === name);
  if (entries.length === 0) return undefined;
  const info = meta.get(name);
  const row = rowOf(name, entries, source, info, locale);
  const screens = screensOf(entries, source, row.off, locale);
  const description =
    info?.description === undefined ? undefined : stripUnsafeText(info.description, true).trim();
  return {
    row,
    description: description === "" ? undefined : description,
    author: info?.author,
    license: info?.license,
    screens,
    features: featuresOf(entries, row.off, locale),
    capabilities: capabilitiesOf(entries),
    hasApp: entries.some((entry) => entry.mode === "app"),
    problems: problemsOf(name, source, info, screens, entries),
    primary: screens.find((screen) => screen.state === "ready"),
  };
}

/**
 * 자리를 지금 항목에 맞춘다. 없는 플러그인은 목록으로, 없는 화면은 그 플러그인 상세로(그것도 없으면 목록으로) 간다.
 * 화면 자리는 열 수 있는 화면만 남긴다(꺼졌거나 고장 난 화면은 상세가 이유를 보인다)
 */
export function addonRouteOf(route: AddonRoute, entries: readonly ExtUiEntry[]): AddonRoute {
  if (route.kind === "list") return route;
  if (route.kind === "plugin") {
    return entries.some((entry) => entry.extension === route.name) ? route : ADDON_LIST;
  }
  const entry = entries.find((item) => screenKeyOfEntry(item) === route.key);
  if (entry !== undefined && isScreen(entry)) return route;
  const name = route.key.split("/")[0] ?? "";
  return entries.some((item) => item.extension === name) ? { kind: "plugin", name } : ADDON_LIST;
}

/** 비지 않은 글이면 그 값, 아니면 undefined */
function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** `ext.list` 행과 `ext.get` 매니페스트에서 상세 칸을 읽는다. 매니페스트 값은 모양을 확인한 것만 쓴다 */
export function addonMetaOf(
  entry: ExtListEntry | undefined,
  manifest: Readonly<Record<string, unknown>> | undefined,
): AddonMeta {
  const author = manifest?.["author"];
  const authorName =
    typeof author === "string"
      ? textOf(author)
      : typeof author === "object" && author !== null && "name" in author
        ? textOf(author.name)
        : undefined;
  return {
    displayName: entry?.displayName,
    description: textOf(manifest?.["description"]),
    author: authorName,
    license: textOf(manifest?.["license"]),
    enabled:
      entry === undefined ? undefined : entry.status === "enabled" || entry.status === "enabling",
    safeMode: entry === undefined ? undefined : entry.safeModeExcluded !== null,
    errors: entry?.diagnostics.filter((item) => item.severity === "error").length,
  };
}
