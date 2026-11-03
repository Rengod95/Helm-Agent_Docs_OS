// `ext.list`·`ext.get`·`ext.health` 캐시를 캔버스 스냅샷(지도·순서·링크가 읽는 모양)으로 옮긴다.
// 값이 없는 칸은 비운다. 엔진이 준 데이터만 쓰고 지어내지 않는다.
import {
  validateManifest,
  type ExtensionManifest,
  type PluginDecl,
} from "@fresnel/contracts/extensions";
import { assertNever } from "@fresnel/contracts";
import type {
  ExtBindingEdge,
  ExtGetResult,
  ExtHealthEntry,
  ExtListEntry,
  ExtListPlugin,
} from "@fresnel/contracts/wire";
import type {
  CanvasGroup,
  CanvasHealth,
  CanvasPiece,
  CanvasPlugin,
  CanvasSnapshot,
  LayerKey,
  Origin,
} from "./canvas/types.ts";
import type { WorkbenchState } from "./model.ts";

type Relation = ExtBindingEdge["relation"];

/** 확장이 실린 곳을 지도의 출처로. 관리형 설치와 사용자 설치는 "user"로 묶는다 */
function originOf(origin: ExtListEntry["origin"]): Origin {
  switch (origin) {
    case "builtin":
      return "builtin";
    case "project":
      return "project";
    case "user":
    case "managed":
    case undefined:
      return "user";
    default:
      return assertNever(origin, "ExtListEntry.origin");
  }
}

/** 매니페스트 층 값 그대로. L1·L2·L3 밖의 값(외부 plugin 포함)은 "plugin"이다 */
function layerOf(layer: string): LayerKey {
  return layer === "L1" || layer === "L2" || layer === "L3" ? layer : "plugin";
}

/** 검사를 통과한 매니페스트만 쓴다. 검사에 실패했거나 읽은 값이 없으면 undefined */
function manifestOf(detail: ExtGetResult | undefined): ExtensionManifest | undefined {
  if (detail === undefined) return undefined;
  return validateManifest(detail.manifest).manifest;
}

/** 경로의 마지막 조각에서 확장자를 뺀 이름. 끝의 "/"는 무시한다 */
function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** 루트 플러그인이 넣어 주는 것: 구성 요소 경로, MCP 서버, 화면 */
function piecesOf(manifest: ExtensionManifest | undefined): CanvasPiece[] {
  if (manifest === undefined) return [];
  const components = manifest.components;
  const pieces: CanvasPiece[] = [];
  for (const path of components?.skills ?? []) pieces.push({ kind: "skill", name: baseName(path) });
  for (const path of components?.commands ?? []) {
    pieces.push({ kind: "command", name: baseName(path) });
  }
  for (const path of components?.agents ?? []) pieces.push({ kind: "agent", name: baseName(path) });
  if (components?.mcpServers !== undefined) {
    pieces.push({ kind: "mcp", name: baseName(components.mcpServers) });
  }
  for (const screen of manifest.ui?.items ?? []) pieces.push({ kind: "view", name: screen.id });
  return pieces;
}

/** 매니페스트 선언 중 이 관계의 기능 이름. 선언이 없으면 빈 목록 */
function declaredNames(decl: PluginDecl | undefined, relation: Relation): readonly string[] {
  if (decl === undefined) return [];
  switch (relation) {
    case "provides":
      return (decl.provides ?? []).map((p) => p.id);
    case "requires":
      return (decl.requires ?? []).map((r) => r.id);
    case "optional":
      return (decl.optional ?? []).map((r) => r.id);
    default:
      return assertNever(relation, "ExtBindingEdge.relation");
  }
}

/** 엔진의 기능 엣지를 먼저, 선언에만 있는 이름을 뒤에 더한다. 같은 이름은 한 번만 */
function capabilityNames(
  detail: ExtGetResult | undefined,
  registrationId: string,
  decl: PluginDecl | undefined,
  relation: Relation,
): string[] {
  const fromEdges = (detail?.bindings ?? [])
    .filter((b) => b.registrationId === registrationId && b.relation === relation)
    .map((b) => b.capability);
  return [...new Set([...fromEdges, ...declaredNames(decl, relation)])];
}

function hooksOf(detail: ExtGetResult | undefined, registrationId: string): string[] {
  return (detail?.hooks ?? [])
    .filter((h) => h.registrationId === registrationId)
    .map((h) => h.hook);
}

/** 실패 장부는 실패가 있거나 자동으로 꺼졌을 때만 보인다. ext.health에 없는 훅·기준은 비운다 */
function healthOf(entry: ExtHealthEntry | undefined): CanvasHealth | undefined {
  if (entry === undefined) return undefined;
  if (entry.consecutiveFailures <= 0 && !entry.autoDisabled) return undefined;
  return {
    fails: entry.consecutiveFailures,
    text: entry.lastError ?? "",
    at: entry.lastFailureAt ?? "",
    ...(entry.autoDisabled ? { autoOff: true } : {}),
  };
}

function pluginOf(
  entry: ExtListEntry,
  plugin: ExtListPlugin,
  detail: ExtGetResult | undefined,
  manifest: ExtensionManifest | undefined,
  health: WorkbenchState["health"],
): CanvasPlugin {
  // 루트 플러그인은 id가 없고, 그 선언도 id가 없다
  const decl = manifest?.plugins.find((d) => d.id === plugin.id);
  const root = plugin.id === undefined;
  const role = root ? manifest?.description : undefined;
  const requires = capabilityNames(detail, plugin.registrationId, decl, "requires");
  const optional = capabilityNames(detail, plugin.registrationId, decl, "optional");
  const records = (decl?.recordKinds ?? []).map((r) => r.kind);
  const reads = decl?.readsRecordKinds ?? [];
  const drives = decl?.drives;
  const failure = healthOf(health[plugin.registrationId]);
  const on = plugin.status === "enabled" || plugin.status === "enabling";
  return {
    id: plugin.registrationId,
    name: plugin.id === undefined ? entry.displayName : (decl?.title ?? plugin.id),
    layer: layerOf(plugin.layer),
    origin: originOf(entry.origin),
    version: entry.version,
    hooks: hooksOf(detail, plugin.registrationId),
    provides: capabilityNames(detail, plugin.registrationId, decl, "provides"),
    pieces: root ? piecesOf(manifest) : [],
    on,
    ...(role === undefined ? {} : { role }),
    ...(plugin.inGroup ? { group: entry.name } : {}),
    ...(requires.length === 0 ? {} : { requires }),
    ...(optional.length === 0 ? {} : { optional }),
    ...(drives === undefined ? {} : { drives }),
    ...(records.length === 0 ? {} : { records }),
    ...(reads.length === 0 ? {} : { reads }),
    ...(failure === undefined ? {} : { health: failure }),
  };
}

function groupOf(entry: ExtListEntry, manifest: ExtensionManifest | undefined): CanvasGroup {
  const description = manifest?.description;
  return {
    id: entry.name,
    name: entry.displayName,
    ...(description === undefined ? {} : { role: description }),
    version: entry.version,
    origin: originOf(entry.origin),
    members: entry.plugins.filter((p) => p.inGroup).map((p) => p.registrationId),
  };
}

/** 목록·상세·실패 장부 캐시로 캔버스 스냅샷을 만든다. 순서는 목록이 준 순서를 따른다 */
export function snapshotOf(
  s: Pick<WorkbenchState, "entries" | "details" | "health">,
): CanvasSnapshot {
  const plugins: CanvasPlugin[] = [];
  const groups: CanvasGroup[] = [];
  for (const entry of s.entries) {
    const detail = s.details[entry.name];
    const manifest = manifestOf(detail);
    for (const plugin of entry.plugins) {
      plugins.push(pluginOf(entry, plugin, detail, manifest, s.health));
    }
    if (entry.isGroup) groups.push(groupOf(entry, manifest));
  }
  return { plugins, groups };
}
