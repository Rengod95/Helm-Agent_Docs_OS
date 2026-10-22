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
import { ExtensionManifestSchema, type ExtensionManifest } from "./manifest.ts";
import type { PointName } from "./points.ts";

export interface ManifestIssue {
  readonly severity: "error" | "warning";
  readonly code: ManifestIssueCode;
  /** JSON Pointer. 집합 검사면 확장 이름 접두. 예: "acme-notes/points/2" */
  readonly path: string;
  readonly message: string;
}

export type ManifestIssueCode =
  // validateManifest
  | "schema"
  | "unknown_key"
  | "name_invalid"
  | "name_reserved"
  | "version_invalid"
  | "layer_kind_mismatch"
  | "drive_requires_group"
  | "entry_invalid"
  | "point_unknown"
  | "point_duplicate"
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
  | "point_undeclared"
  | "point_unused"
  | "post_undeclared"
  | "drive_undeclared"
  | "capability_undeclared"
  | "record_kind_undeclared"
  | "read_kind_undeclared"
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
 * 외부 확장이 쓸 수 없는 이름. core, ext, grp, x, xeon과 내장 L2 도메인 이름이다.
 * 정확한 목록은 F.capabilities.spec §10 미결(능력·확장 이름 네임스페이스)이 풀린 뒤 확정한다 [가정]
 */
export const RESERVED_EXTENSION_NAMES: readonly string[] = [
  "core",
  "ext",
  "grp",
  "x",
  "xeon",
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

/** 스키마 위반 경로를 이슈 코드로 바꾼다(F.extensions.spec §4.7). 표에 없는 경로는 schema다 */
function codeForSchemaPath(path: string): ManifestIssueCode {
  const segments = path.split("/");
  const top = segments[1] ?? "";
  const last = segments[segments.length - 1] ?? "";
  switch (top) {
    case "name":
      return "name_invalid";
    case "version":
      return "version_invalid";
    case "points":
      return segments.length > 2 ? "point_unknown" : "schema";
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
      return segments.length > 2 ? "read_kind_invalid" : "schema";
    case "userConfig":
      return "user_config_invalid";
    case "isolation":
      return "isolation_invalid";
    case "trust":
      return "trust_invalid";
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

function ownPrefix(manifest: Pick<ExtensionManifest, "kind" | "name">): string {
  return `${manifest.kind === "group" ? "grp" : "x"}.${manifest.name}.`;
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

  if ((manifest.kind === "group") !== (manifest.layer === "L3")) {
    issues.push(
      issue(
        "error",
        "layer_kind_mismatch",
        "/layer",
        `kind "${manifest.kind}" does not match layer "${manifest.layer}" (group <-> L3)`,
      ),
    );
  }

  if (manifest.usesDrive && manifest.kind !== "group") {
    issues.push(
      issue("error", "drive_requires_group", "/usesDrive", "only a group may set usesDrive: true"),
    );
  }

  if (!isEntryInsideRoot(manifest.entry)) {
    issues.push(
      issue("error", "entry_invalid", "/entry", "entry must be a relative path inside the root"),
    );
  }

  for (const { index, id } of duplicatesIn(manifest.points)) {
    issues.push(
      issue("error", "point_duplicate", `/points/${index}`, `point "${id}" is listed twice`),
    );
  }

  const requires = manifest.requires ?? [];
  const optional = manifest.optional ?? [];
  const provides = manifest.provides ?? [];
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
            `/${list}/${index}/range`,
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
          `/${list}/${index}`,
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
          `/optional/${index}`,
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
          `/provides/${index}/id`,
          `capability "${entry.id}" uses the reserved prefix "${first}"`,
        ),
      );
    }
  });

  const kinds = manifest.recordKinds ?? [];
  kinds.forEach((decl, index) => {
    if (!isRecordKindOf(decl.kind, manifest)) {
      issues.push(
        issue(
          "error",
          "record_kind_prefix",
          `/recordKinds/${index}/kind`,
          `record kind "${decl.kind}" must start with "${ownPrefix(manifest)}"`,
        ),
      );
    }
  });
  for (const { index, id } of duplicatesIn(kinds.map((decl) => decl.kind))) {
    issues.push(
      issue(
        "error",
        "record_kind_duplicate",
        `/recordKinds/${index}/kind`,
        `record kind "${id}" is declared twice`,
      ),
    );
  }

  const prefix = ownPrefix(manifest);
  (manifest.readsRecordKinds ?? []).forEach((pattern, index) => {
    if (pattern.startsWith(prefix)) {
      issues.push(
        issue(
          "error",
          "read_kind_invalid",
          `/readsRecordKinds/${index}`,
          `"${pattern}" points at the extension's own records, which are read without a declaration`,
        ),
      );
    }
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

/** 매니페스트 하나. 입력은 JSON 파싱 결과 그대로. 순수 함수 */
export function validateManifest(input: unknown): ManifestResult {
  if (!isPlainObject(input)) {
    return { issues: [issue("error", "schema", "", "manifest must be an object")] };
  }
  const known = new Set(Object.keys(ExtensionManifestSchema.properties));
  const issues: ManifestIssue[] = [];
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
  readonly on: readonly PointName[];
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

/** 선언과 실제 등록을 대조한다. X가 setup 직후와 등록 호출마다 쓴다. 순수 함수 */
export function validateUsage(
  manifest: ExtensionManifest,
  usage: ExtensionUsage,
): readonly ManifestIssue[] {
  const issues: ManifestIssue[] = [];

  const declaredPoints = new Set<string>(manifest.points);
  for (const point of new Set(usage.on)) {
    if (!declaredPoints.has(point)) {
      issues.push(
        issue(
          "error",
          "point_undeclared",
          "/points",
          `on("${point}") is not listed in the manifest points`,
        ),
      );
    }
  }
  const usedPoints = new Set<string>(usage.on);
  manifest.points.forEach((point, index) => {
    if (!usedPoints.has(point)) {
      issues.push(
        issue(
          "warning",
          "point_unused",
          `/points/${index}`,
          `point "${point}" is declared but never used`,
        ),
      );
    }
  });

  if (usage.post && manifest.usesPost !== true) {
    issues.push(
      issue("error", "post_undeclared", "/usesPost", "post was used but usesPost is not true"),
    );
  }
  if (usage.drive && !manifest.usesDrive) {
    issues.push(
      issue("error", "drive_undeclared", "/usesDrive", "drive was used but usesDrive is not true"),
    );
  }

  const declaredCapabilities = new Set<string>([
    ...(manifest.requires ?? []).map((e) => e.id),
    ...(manifest.optional ?? []).map((e) => e.id),
  ]);
  for (const id of new Set(usage.capabilities)) {
    if (!declaredCapabilities.has(id)) {
      issues.push(
        issue(
          "error",
          "capability_undeclared",
          "/requires",
          `capability("${id}") is not in requires or optional`,
        ),
      );
    }
  }

  const declaredKinds = new Set<string>((manifest.recordKinds ?? []).map((decl) => decl.kind));
  for (const kind of new Set(usage.recordKinds)) {
    if (!declaredKinds.has(kind)) {
      issues.push(
        issue(
          "error",
          "record_kind_undeclared",
          "/recordKinds",
          `record kind "${kind}" is not declared`,
        ),
      );
    }
  }

  const prefix = ownPrefix(manifest);
  const declaredReads = manifest.readsRecordKinds ?? [];
  for (const used of new Set(usage.readsRecordKinds)) {
    if (used.startsWith(prefix)) continue;
    if (!declaredReads.some((declared) => coversRead(declared, used))) {
      issues.push(
        issue(
          "error",
          "read_kind_undeclared",
          "/readsRecordKinds",
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

  const drivers = manifests.filter(
    (m) => m.kind === "group" && m.usesDrive && m.defaultEnabled !== false,
  );
  const [firstDriver] = drivers;
  if (drivers.length >= 2 && firstDriver !== undefined) {
    issues.push(
      issue(
        "warning",
        "drive_conflict",
        `${firstDriver.name}/usesDrive`,
        `groups ${drivers.map((m) => m.name).join(", ")} all use drive and are enabled by default; only one gets the lease`,
      ),
    );
  }

  const provided = new Set<string>(manifests.flatMap((m) => (m.provides ?? []).map((p) => p.id)));
  for (const manifest of manifests) {
    (manifest.requires ?? []).forEach((entry, index) => {
      if (!provided.has(entry.id)) {
        issues.push(
          issue(
            "warning",
            "capability_unprovided",
            `${manifest.name}/requires/${index}`,
            `no installed extension provides "${entry.id}"`,
          ),
        );
      }
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
