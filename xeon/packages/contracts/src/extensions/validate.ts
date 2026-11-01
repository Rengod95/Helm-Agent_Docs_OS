import { parse } from "../base/index.ts";
import {
  RESERVED_CAPABILITY_PREFIXES,
  isSemVerRange,
  type CapabilityId,
} from "../capabilities/index.ts";
import { RESERVED_SOURCE_KEYS } from "../records/commit.ts";
import {
  isRecordKindOf,
  type GroupRecord,
  type RecordKind,
  type RecordKindDecl,
} from "./group-record.ts";
import {
  ExtensionManifestSchema,
  MANIFEST_SCHEMA_VERSION,
  extensionPrefix,
  pluginDefaultEnabled,
  pluginsOf,
  type ExtensionManifest,
  type PluginEntry,
} from "./manifest.ts";
import type { HookName } from "./hooks.ts";

export interface ManifestIssue {
  readonly severity: "error" | "warning";
  readonly code: ManifestIssueCode;
  /** JSON Pointer. 집합 검사면 확장 이름 접두. 예: "acme-notes/plugins/0/hooks/2" */
  readonly path: string;
  readonly message: string;
}

export type ManifestIssueCode =
  // validateManifest
  | "schema"
  | "unknown_key"
  | "schema_version_unsupported"
  | "legacy_field"
  | "name_invalid"
  | "name_reserved"
  | "version_invalid"
  | "entry_invalid"
  | "plugin_id_invalid"
  | "plugin_id_duplicate"
  | "plugin_root_ambiguous"
  | "layer_mixed_external"
  | "group_member_unknown"
  | "group_member_duplicate"
  | "hook_unknown"
  | "hook_duplicate"
  | "capability_invalid"
  | "range_invalid"
  | "capability_duplicate"
  | "capability_both"
  | "provides_reserved"
  | "record_kind_prefix"
  | "record_kind_duplicate"
  | "read_kind_invalid"
  | "user_config_invalid"
  | "isolation_invalid"
  | "trust_invalid"
  // validateUsage
  | "hook_undeclared"
  | "hook_unused"
  | "post_undeclared"
  | "drive_undeclared"
  | "capability_undeclared"
  | "record_kind_undeclared"
  | "read_kind_undeclared"
  // X 설치 시점(PrimitiveError)과 로더 진단. 정책 설정과 엔트리 실행 결과가 정하므로 정적 검사로 보지 못한다
  | "drive_requires_group"
  | "plugin_not_registered"
  | "registration_unknown_plugin"
  // validateManifestSet
  | "name_conflict"
  | "drive_conflict"
  | "capability_unprovided"
  // validateGroupRecord
  | "record_kind_unregistered"
  | "record_payload_invalid"
  | "record_version_unknown";

export interface ManifestResult {
  /** 오류가 없으면 정규화된 매니페스트(알 수 없는 최상위 키 제거) */
  readonly manifest?: ExtensionManifest;
  readonly issues: readonly ManifestIssue[];
}

/**
 * 외부 확장이 쓸 수 없는 이름. core, ext, grp, x, fresnel과 내장 L2 도메인 이름이다.
 * 정확한 목록은 F.capabilities.spec §10 미결(기능·확장 이름 네임스페이스)이 풀린 뒤 확정한다 [가정]
 */
export const RESERVED_EXTENSION_NAMES: readonly string[] = [
  "core",
  "ext",
  "grp",
  "x",
  "fresnel",
  "workspace",
  "mcp",
  "web",
  "knowledge",
  "work",
  "dialog",
  "artifact",
  "artifacts",
  "schedule",
];

/** 스키마 1의 최상위 이름. 스키마 2에서는 `plugins[]` 안으로 옮겼거나 없어졌다 */
const LEGACY_FIELDS: readonly string[] = [
  "kind",
  "points",
  "usesDrive",
  "views",
  // `plugins[]` 항목으로 옮긴 필드. 최상위에 두면 조용히 지워져 선언이 사라지므로 거부한다
  "layer",
  "hooks",
  "usesPost",
  "requires",
  "optional",
  "provides",
  "recordKinds",
  "readsRecordKinds",
];

function isReservedSourceKey(name: string): boolean {
  return RESERVED_SOURCE_KEYS.some((key) => key === name);
}

function issue(
  severity: ManifestIssue["severity"],
  code: ManifestIssueCode,
  path: string,
  message: string,
): ManifestIssue {
  return { severity, code, path, message };
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `/plugins/<i>/<field>/...`의 field 이하 마디로 플러그인 항목 필드의 코드를 고른다 */
function codeForPluginPath(segments: readonly string[]): ManifestIssueCode {
  const field = segments[3] ?? "";
  const last = segments[segments.length - 1] ?? "";
  switch (field) {
    case "id":
      return "plugin_id_invalid";
    case "hooks":
      return segments.length > 4 ? "hook_unknown" : "schema";
    case "requires":
    case "optional":
      return last === "id" ? "capability_invalid" : last === "range" ? "range_invalid" : "schema";
    case "provides":
      return last === "id"
        ? "capability_invalid"
        : last === "version"
          ? "version_invalid"
          : "schema";
    case "recordKinds":
      return last === "kind" ? "record_kind_prefix" : "schema";
    case "readsRecordKinds":
      return segments.length > 4 ? "read_kind_invalid" : "schema";
    // fresnel-disable-next-line fresnel/switch-default-never -- 검증 경로의 마디는 스키마가 정하는 열린 문자열이다. 모르는 마디는 일반 schema 코드로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return "schema";
  }
}

/** 스키마 위반 경로를 이슈 코드로 바꾼다(F.extensions.spec §4.7). 표에 없는 경로는 schema다 */
function codeForSchemaPath(path: string): ManifestIssueCode {
  const segments = path.split("/");
  const top = segments[1] ?? "";
  switch (top) {
    case "schemaVersion":
      return "schema_version_unsupported";
    case "name":
      return "name_invalid";
    case "version":
      return "version_invalid";
    case "plugins":
      return codeForPluginPath(segments);
    case "group":
      return segments[2] === "members" && segments.length > 3 ? "plugin_id_invalid" : "schema";
    case "userConfig":
      return "user_config_invalid";
    case "isolation":
      return "isolation_invalid";
    case "trust":
      return "trust_invalid";
    // fresnel-disable-next-line fresnel/switch-default-never -- 검증 경로의 첫 마디는 스키마가 정하는 열린 문자열이다. 모르는 마디는 일반 schema 코드로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return "schema";
  }
}

/** entry가 확장 루트 밖을 가리키는가: 절대 경로, 드라이브 문자, 루트 위로 올라가는 `..` */
export function isEntryInsideRoot(entry: string): boolean {
  if (entry.length === 0 || entry.includes("\0")) return false;
  if (entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:/.test(entry)) return false;
  let depth = 0;
  for (const segment of entry.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      depth -= 1;
      if (depth < 0) return false;
    } else {
      depth += 1;
    }
  }
  return true;
}

function ownPrefix(manifest: Pick<ExtensionManifest, "group" | "name">): string {
  return `${extensionPrefix(manifest)}.${manifest.name}.`;
}

function duplicatesIn(
  ids: readonly string[],
): readonly { readonly index: number; readonly id: string }[] {
  const seen = new Set<string>();
  const duplicated: { index: number; id: string }[] = [];
  ids.forEach((id, index) => {
    if (seen.has(id)) duplicated.push({ index, id });
    seen.add(id);
  });
  return duplicated;
}

/** 정규화된(스키마를 통과한) 매니페스트의 의미 검사 */
function checkSemantics(manifest: ExtensionManifest): readonly ManifestIssue[] {
  const issues: ManifestIssue[] = [];

  if (manifest.trust?.level !== "builtin" && RESERVED_EXTENSION_NAMES.includes(manifest.name)) {
    issues.push(
      issue("error", "name_reserved", "/name", `extension name "${manifest.name}" is reserved`),
    );
  } else if (isReservedSourceKey(manifest.name)) {
    // 입력 출처 키는 신뢰 등급과 무관하게 모든 확장에 금지한다(U-13). 외부 확장의 이름 예약과 겹치면 한 번만 알린다
    issues.push(
      issue(
        "error",
        "name_reserved",
        "/name",
        `extension name "${manifest.name}" is an input source key and cannot be used`,
      ),
    );
  }

  if (!isEntryInsideRoot(manifest.entry)) {
    issues.push(
      issue("error", "entry_invalid", "/entry", "entry must be a relative path inside the root"),
    );
  }

  issues.push(...checkPluginList(manifest));

  const prefix = ownPrefix(manifest);
  manifest.plugins.forEach((plugin, pluginIndex) => {
    const base = `/plugins/${pluginIndex}`;
    for (const { index, id } of duplicatesIn(plugin.hooks)) {
      issues.push(
        issue("error", "hook_duplicate", `${base}/hooks/${index}`, `hook "${id}" is listed twice`),
      );
    }

    const requires = plugin.requires ?? [];
    const optional = plugin.optional ?? [];
    const provides = plugin.provides ?? [];
    for (const [list, entries] of [
      ["requires", requires],
      ["optional", optional],
    ] as const) {
      entries.forEach((entry, index) => {
        if (!isSemVerRange(entry.range)) {
          issues.push(
            issue(
              "error",
              "range_invalid",
              `${base}/${list}/${index}/range`,
              `"${entry.range}" is not an accepted version range`,
            ),
          );
        }
      });
    }
    for (const [list, ids] of [
      ["requires", requires.map((e) => e.id)],
      ["optional", optional.map((e) => e.id)],
      ["provides", provides.map((e) => e.id)],
    ] as const) {
      for (const { index, id } of duplicatesIn(ids)) {
        issues.push(
          issue(
            "error",
            "capability_duplicate",
            `${base}/${list}/${index}`,
            `capability "${id}" is listed twice`,
          ),
        );
      }
    }
    const required = new Set(requires.map((e) => e.id));
    optional.forEach((entry, index) => {
      if (required.has(entry.id)) {
        issues.push(
          issue(
            "error",
            "capability_both",
            `${base}/optional/${index}`,
            `capability "${entry.id}" is in both requires and optional`,
          ),
        );
      }
    });
    provides.forEach((entry, index) => {
      const first = entry.id.split(".")[0] ?? "";
      if (RESERVED_CAPABILITY_PREFIXES.includes(first)) {
        issues.push(
          issue(
            "error",
            "provides_reserved",
            `${base}/provides/${index}/id`,
            `capability "${entry.id}" uses the reserved prefix "${first}"`,
          ),
        );
      }
    });

    const kinds = plugin.recordKinds ?? [];
    kinds.forEach((decl, index) => {
      if (!isRecordKindOf(decl.kind, manifest)) {
        issues.push(
          issue(
            "error",
            "record_kind_prefix",
            `${base}/recordKinds/${index}/kind`,
            `record kind "${decl.kind}" must start with "${prefix}"`,
          ),
        );
      }
    });
    for (const { index, id } of duplicatesIn(kinds.map((decl) => decl.kind))) {
      issues.push(
        issue(
          "error",
          "record_kind_duplicate",
          `${base}/recordKinds/${index}/kind`,
          `record kind "${id}" is declared twice`,
        ),
      );
    }

    (plugin.readsRecordKinds ?? []).forEach((pattern, index) => {
      if (pattern.startsWith(prefix)) {
        issues.push(
          issue(
            "error",
            "read_kind_invalid",
            `${base}/readsRecordKinds/${index}`,
            `"${pattern}" points at the extension's own records, which are read without a declaration`,
          ),
        );
      }
    });
  });

  for (const [key, entry] of Object.entries(manifest.userConfig ?? {})) {
    if (entry.setting.trim().length === 0) {
      issues.push(
        issue(
          "error",
          "user_config_invalid",
          `/userConfig/${key}/setting`,
          "setting must not be empty",
        ),
      );
    }
  }

  return issues;
}

/** 플러그인 id, 루트, 층 섞임, 그룹 구성원 검사 */
function checkPluginList(manifest: ExtensionManifest): readonly ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const named: string[] = [];
  const namedAt: number[] = [];
  const roots: number[] = [];
  manifest.plugins.forEach((plugin, index) => {
    if (plugin.id === undefined) {
      roots.push(index);
    } else {
      named.push(plugin.id);
      namedAt.push(index);
    }
  });
  for (const { index, id } of duplicatesIn(named)) {
    const at = namedAt[index] ?? index;
    issues.push(
      issue("error", "plugin_id_duplicate", `/plugins/${at}/id`, `plugin id "${id}" is used twice`),
    );
  }
  for (const index of roots.slice(1)) {
    issues.push(
      issue(
        "error",
        "plugin_root_ambiguous",
        `/plugins/${index}`,
        "only one plugin may omit id (the root plugin)",
      ),
    );
  }

  const [firstPlugin] = manifest.plugins;
  if (firstPlugin !== undefined) {
    const external = firstPlugin.layer === "plugin";
    const mixedAt = manifest.plugins.findIndex(
      (plugin) => (plugin.layer === "plugin") !== external,
    );
    if (mixedAt >= 0) {
      issues.push(
        issue(
          "error",
          "layer_mixed_external",
          `/plugins/${mixedAt}/layer`,
          'layer "plugin" cannot be mixed with L1~L3 in one extension',
        ),
      );
    }
  }

  const ids = new Set(named);
  const members = manifest.group?.members ?? [];
  members.forEach((id, index) => {
    if (!ids.has(id)) {
      issues.push(
        issue(
          "error",
          "group_member_unknown",
          `/group/members/${index}`,
          `group member "${id}" is not a declared plugin id`,
        ),
      );
    }
  });
  for (const { index, id } of duplicatesIn(members)) {
    issues.push(
      issue(
        "error",
        "group_member_duplicate",
        `/group/members/${index}`,
        `group member "${id}" is listed twice`,
      ),
    );
  }

  return issues;
}

/** 매니페스트 하나. 입력은 JSON 파싱 결과 그대로. 순수 함수 */
export function validateManifest(input: unknown): ManifestResult {
  if (!isPlainObject(input)) {
    return { issues: [issue("error", "schema", "", "manifest must be an object")] };
  }
  const issues: ManifestIssue[] = [];
  // 옛 형식은 읽지 않는다. 스키마 2에서 뜻이 바뀐 이름은 조용히 지우지 않고 거부한다
  for (const key of LEGACY_FIELDS) {
    if (key in input) {
      issues.push(
        issue(
          "error",
          "legacy_field",
          `/${key}`,
          `top-level "${key}" is not part of the plugin format (schemaVersion ${MANIFEST_SCHEMA_VERSION}); move the manifest to plugins[]`,
        ),
      );
    }
  }
  if (input.schemaVersion !== undefined && input.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    issues.push(
      issue(
        "error",
        "schema_version_unsupported",
        "/schemaVersion",
        `schemaVersion must be ${MANIFEST_SCHEMA_VERSION}; move the manifest to the plugin format (plugins[])`,
      ),
    );
  }
  if (issues.length > 0) return { issues };

  const known = new Set(Object.keys(ExtensionManifestSchema.properties));
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (known.has(key)) {
      stripped[key] = value;
    } else {
      issues.push(
        issue("warning", "unknown_key", `/${key}`, `unknown top-level key "${key}" was removed`),
      );
    }
  }

  const parsed = parse(ExtensionManifestSchema, stripped);
  if (!parsed.ok) {
    const seen = new Set<string>();
    for (const found of parsed.error.issues) {
      const code = codeForSchemaPath(found.path);
      const key = `${code} ${found.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(issue("error", code, found.path, found.message));
    }
    return { issues };
  }

  issues.push(...checkSemantics(parsed.value));
  const hasError = issues.some((found) => found.severity === "error");
  return hasError ? { issues } : { manifest: parsed.value, issues };
}

/** setup 동안 실제로 한 등록 */
export interface ExtensionUsage {
  readonly on: readonly HookName[];
  readonly post: boolean;
  readonly drive: boolean;
  readonly capabilities: readonly CapabilityId[];
  readonly recordKinds: readonly RecordKind[];
  readonly readsRecordKinds: readonly string[];
}

/** declared("grp.a.*")가 used("grp.a.skill.*" 또는 완전한 kind)를 덮는가 */
function coversRead(declared: string, used: string): boolean {
  if (declared.endsWith("*")) return used.startsWith(declared.slice(0, -1));
  return declared === used;
}

/** 선언과 실제 등록을 대조한다. X가 setup 직후와 등록 호출마다 쓴다. `plugin`은 이 Registration의 플러그인 항목이다. 순수 함수 */
export function validateUsage(
  manifest: ExtensionManifest,
  plugin: PluginEntry,
  usage: ExtensionUsage,
): readonly ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const base = `/plugins/${plugin.index}`;
  const decl = plugin.decl;

  const declaredHooks = new Set<string>(decl.hooks);
  for (const hook of new Set(usage.on)) {
    if (!declaredHooks.has(hook)) {
      issues.push(
        issue(
          "error",
          "hook_undeclared",
          `${base}/hooks`,
          `on("${hook}") is not listed in the plugin hooks`,
        ),
      );
    }
  }
  const usedHooks = new Set<string>(usage.on);
  decl.hooks.forEach((hook, index) => {
    if (!usedHooks.has(hook)) {
      issues.push(
        issue(
          "warning",
          "hook_unused",
          `${base}/hooks/${index}`,
          `hook "${hook}" is declared but never used`,
        ),
      );
    }
  });

  if (usage.post && decl.usesPost !== true) {
    issues.push(
      issue(
        "error",
        "post_undeclared",
        `${base}/usesPost`,
        "post was used but usesPost is not true",
      ),
    );
  }
  if (usage.drive && decl.drives !== true) {
    issues.push(
      issue("error", "drive_undeclared", `${base}/drives`, "drive was used but drives is not true"),
    );
  }

  const declaredCapabilities = new Set<string>([
    ...(decl.requires ?? []).map((e) => e.id),
    ...(decl.optional ?? []).map((e) => e.id),
  ]);
  for (const id of new Set(usage.capabilities)) {
    if (!declaredCapabilities.has(id)) {
      issues.push(
        issue(
          "error",
          "capability_undeclared",
          `${base}/requires`,
          `capability("${id}") is not in requires or optional`,
        ),
      );
    }
  }

  const declaredKinds = new Set<string>((decl.recordKinds ?? []).map((kind) => kind.kind));
  for (const kind of new Set(usage.recordKinds)) {
    if (!declaredKinds.has(kind)) {
      issues.push(
        issue(
          "error",
          "record_kind_undeclared",
          `${base}/recordKinds`,
          `record kind "${kind}" is not declared`,
        ),
      );
    }
  }

  const prefix = ownPrefix(manifest);
  const declaredReads = decl.readsRecordKinds ?? [];
  for (const used of new Set(usage.readsRecordKinds)) {
    if (used.startsWith(prefix)) continue;
    if (!declaredReads.some((declared) => coversRead(declared, used))) {
      issues.push(
        issue(
          "error",
          "read_kind_undeclared",
          `${base}/readsRecordKinds`,
          `read of "${used}" is not declared`,
        ),
      );
    }
  }

  return issues;
}

/** 설치된 매니페스트 집합. 순수 함수 */
export function validateManifestSet(
  manifests: readonly ExtensionManifest[],
): readonly ManifestIssue[] {
  const issues: ManifestIssue[] = [];

  const names = new Set<string>();
  for (const manifest of manifests) {
    if (names.has(manifest.name)) {
      issues.push(
        issue(
          "error",
          "name_conflict",
          `${manifest.name}/name`,
          `extension name "${manifest.name}" is installed twice`,
        ),
      );
    }
    names.add(manifest.name);
  }

  const drivers = manifests.flatMap((manifest) =>
    pluginsOf(manifest)
      .filter((entry) => entry.decl.drives === true && pluginDefaultEnabled(manifest, entry))
      .map((entry) => ({ manifest, entry })),
  );
  const [firstDriver] = drivers;
  if (drivers.length >= 2 && firstDriver !== undefined) {
    issues.push(
      issue(
        "warning",
        "drive_conflict",
        `${firstDriver.manifest.name}/plugins/${firstDriver.entry.index}/drives`,
        `registrations ${drivers.map((d) => d.entry.registrationId).join(", ")} all drive and are enabled by default; only one gets the drive lock`,
      ),
    );
  }

  const provided = new Set<string>(
    manifests.flatMap((m) =>
      m.plugins.flatMap((plugin) => (plugin.provides ?? []).map((p) => p.id)),
    ),
  );
  for (const manifest of manifests) {
    manifest.plugins.forEach((plugin, pluginIndex) => {
      (plugin.requires ?? []).forEach((entry, index) => {
        if (!provided.has(entry.id)) {
          issues.push(
            issue(
              "warning",
              "capability_unprovided",
              `${manifest.name}/plugins/${pluginIndex}/requires/${index}`,
              `no installed extension provides "${entry.id}"`,
            ),
          );
        }
      });
    });
  }

  return issues;
}

/** 그룹 레코드 하나. decl이 없으면 record_kind_unregistered. 순수 함수 */
export function validateGroupRecord(
  record: GroupRecord,
  decl: RecordKindDecl | undefined,
): readonly ManifestIssue[] {
  if (decl === undefined || decl.kind !== record.kind) {
    return [
      issue(
        "error",
        "record_kind_unregistered",
        "/kind",
        `record kind "${record.kind}" is not registered`,
      ),
    ];
  }
  const issues: ManifestIssue[] = [];
  const checked = parse(decl.payload, record.payload);
  if (!checked.ok) {
    for (const found of checked.error.issues) {
      issues.push(issue("error", "record_payload_invalid", `/payload${found.path}`, found.message));
    }
  }
  if (record.version > decl.version) {
    issues.push(
      issue(
        "warning",
        "record_version_unknown",
        "/version",
        `record version ${record.version} is newer than the declared version ${decl.version}`,
      ),
    );
  }
  return issues;
}
