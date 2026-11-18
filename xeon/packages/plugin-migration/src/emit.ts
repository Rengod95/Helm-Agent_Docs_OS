// 플러그인 폴더 내보내기(migration.md §7.2, §6.5). 제안이 만든 트리에 매니페스트와 이식 기록을 더한다.
// 순수하고 결정적이다. 시각, 난수, 환경 변수를 쓰지 않는다. 같은 입력이면 같은 바이트를 낸다.
import { Type } from "typebox";
import { parse, type SchemaProof } from "@fresnel/contracts";
import type { PlannedPlugin, ReportLine } from "./types.ts";

export const MANIFEST_PATH = ".fresnel-plugin/plugin.json";
export const MIGRATION_RECORD_PATH = ".fresnel-plugin/migration.json";

/** 이식 기록에 싣는 원본 항목 하나. 경로는 홈을 `~`로 줄인 것이고 시크릿 값은 없다 */
export interface PluginMigrationSource {
  readonly path: string;
  readonly sha256: string;
}

/**
 * 플러그인 계획에 붙는 이식 기록 재료. `PlannedPlugin`에는 보고 줄과 해시가 없어서 제안 엔진이 이것을 함께 싣는다(§6.5).
 * 이 값이 없으면 기록에 출처와 보고 줄이 빈 채로 나간다.
 */
export interface PluginMigrationMeta {
  readonly rulesVersions: Readonly<Record<string, string>>;
  readonly sources: readonly PluginMigrationSource[];
  readonly report: readonly ReportLine[];
}

export interface PlannedPluginWithMigration extends PlannedPlugin {
  readonly migration: PluginMigrationMeta;
}

const HarnessSchema = Type.Union([
  Type.Literal("claude-code"),
  Type.Literal("agents-md"),
  Type.Literal("agent-skills"),
]);

const IrKindSchema = Type.Union([
  Type.Literal("instruction"),
  Type.Literal("skill"),
  Type.Literal("command"),
  Type.Literal("agent"),
  Type.Literal("mcp"),
  Type.Literal("field"),
  Type.Literal("blocked"),
  Type.Literal("hook"),
]);

const ScopeSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("project"),
  Type.Literal("local"),
  Type.Literal("managed"),
  Type.Literal("plugin"),
]);

const StatusSchema = Type.Union([
  Type.Literal("exact"),
  Type.Literal("differs"),
  Type.Literal("not_ported"),
  Type.Literal("not_needed"),
]);

const DifferenceKindSchema = Type.Union([
  Type.Literal("semantic_loss"),
  Type.Literal("scope_change"),
  Type.Literal("time_limit"),
  Type.Literal("cost"),
  Type.Literal("enforcement_change"),
  Type.Literal("approval_flow"),
  Type.Literal("renamed"),
  Type.Literal("user_choice"),
]);

const ReportLineSchema = Type.Object(
  {
    itemId: Type.String({ minLength: 1 }),
    harness: HarnessSchema,
    kind: IrKindSchema,
    label: Type.String({ minLength: 1 }),
    source: Type.Object(
      {
        scope: ScopeSchema,
        path: Type.String({ minLength: 1 }),
        key: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: false },
    ),
    status: StatusSchema,
    differences: Type.Array(
      Type.Object(
        { kind: DifferenceKindSchema, text: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    ),
    reason: Type.Optional(
      Type.Object(
        { code: Type.String({ minLength: 1 }), text: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    ),
    alternative: Type.Optional(Type.String({ minLength: 1 })),
    output: Type.Optional(
      Type.Object(
        { plugin: Type.String({ minLength: 1 }), path: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const metaShape = Type.Object(
  {
    rulesVersions: Type.Record(Type.String(), Type.String()),
    sources: Type.Array(
      Type.Object(
        { path: Type.String({ minLength: 1 }), sha256: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
    ),
    report: Type.Array(ReportLineSchema),
  },
  { additionalProperties: false },
);

const MigrationMetaSchema = Type.Unsafe<PluginMigrationMeta>(
  metaShape satisfies SchemaProof<PluginMigrationMeta, typeof metaShape>,
);

const EMPTY_META: PluginMigrationMeta = { rulesVersions: {}, sources: [], report: [] };

/**
 * 계획에 실린 이식 기록 재료를 읽는다. 스키마에 맞지 않으면 빈 재료로 쓰고 `rejected`를 참으로 둔다.
 * 기록에 `metaRejected: true`로 남으므로 조용히 빠지지 않는다.
 */
function metaOf(plan: PlannedPlugin): {
  readonly meta: PluginMigrationMeta;
  readonly rejected: boolean;
} {
  if (!("migration" in plan)) return { meta: EMPTY_META, rejected: false };
  const checked = parse(MigrationMetaSchema, plan.migration);
  if (!checked.ok) return { meta: EMPTY_META, rejected: true };
  return { meta: checked.value, rejected: false };
}

interface ManifestUserConfigEntry {
  readonly setting: string;
  readonly title: string;
  readonly sensitive: boolean;
  readonly required: boolean;
}

/** 실행 선언(Hook 플러그인). 스크립트 선언, 진입 파일, 지점과 결정 상한을 매니페스트 필드로 옮긴다(설계 B [제안]) */
function runtimeOf(runtime: NonNullable<PlannedPlugin["runtime"]>): Record<string, unknown> {
  const hookDecides = runtime.hookDecides.map((decl) => ({
    hook: decl.hook,
    decides: [...decl.decides],
  }));
  return {
    entry: runtime.entry,
    scripts: runtime.scripts.map((script) => ({
      name: script.name,
      runner: script.runner,
      file: script.file,
      ...(script.args === undefined || script.args.length === 0 ? {} : { args: [...script.args] }),
      timeoutMs: script.timeoutMs,
    })),
    plugins: [
      {
        layer: "plugin",
        hooks: [...runtime.hooks],
        ...(hookDecides.length === 0 ? {} : { hookDecides }),
      },
    ],
  };
}

/** `.fresnel-plugin/plugin.json`. 키 순서는 고정이다(§4.5.4, 형식은 enC1이 정하기 전의 [제안]) */
function manifestOf(plan: PlannedPlugin): Record<string, unknown> {
  const base = {
    schemaVersion: 2,
    name: plan.name,
    version: "0.0.0",
    purpose: plan.purpose,
  };
  const withConfig =
    plan.userConfig.length === 0
      ? base
      : {
          ...base,
          userConfig: Object.fromEntries(
            plan.userConfig.map((config): [string, ManifestUserConfigEntry] => [
              config.key,
              {
                setting: `ext.${plan.name}.${config.key}`,
                title: config.title,
                sensitive: config.sensitive,
                required: config.required,
              },
            ]),
          ),
        };
  return plan.runtime === undefined ? withConfig : { ...withConfig, ...runtimeOf(plan.runtime) };
}

function sortedRecord(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => compareText(a, b)));
}

function reportLineRecord(line: ReportLine): Record<string, unknown> {
  return {
    itemId: line.itemId,
    harness: line.harness,
    kind: line.kind,
    label: line.label,
    source: {
      scope: line.source.scope,
      path: line.source.path,
      ...(line.source.key !== undefined ? { key: line.source.key } : {}),
    },
    status: line.status,
    differences: line.differences.map((difference) => ({
      kind: difference.kind,
      text: difference.text,
    })),
    ...(line.reason !== undefined
      ? { reason: { code: line.reason.code, text: line.reason.text } }
      : {}),
    ...(line.alternative !== undefined ? { alternative: line.alternative } : {}),
    ...(line.output !== undefined
      ? { output: { plugin: line.output.plugin, path: line.output.path } }
      : {}),
  };
}

/** `.fresnel-plugin/migration.json`. 시각과 시크릿 값을 싣지 않는다. 필드는 위 스키마가 정한 것만 나간다 */
function migrationRecordOf(
  name: string,
  meta: PluginMigrationMeta,
  rejected: boolean,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    plugin: name,
    metaRejected: rejected,
    rulesVersions: sortedRecord(meta.rulesVersions),
    sources: meta.sources.map((source) => ({ path: source.path, sha256: source.sha256 })),
    report: meta.report.map(reportLineRecord),
  };
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 계획의 트리에 매니페스트와 이식 기록을 더해 최종 폴더 트리를 돌려준다. 키는 경로 오름차순이다.
 * 입력 트리를 바꾸지 않는다.
 */
export function emit(plan: PlannedPlugin): ReadonlyMap<string, Uint8Array> {
  const { meta, rejected } = metaOf(plan);
  const files = new Map<string, Uint8Array>(plan.tree);
  files.set(MANIFEST_PATH, encodeJson(manifestOf(plan)));
  files.set(MIGRATION_RECORD_PATH, encodeJson(migrationRecordOf(plan.name, meta, rejected)));
  return new Map([...files].toSorted(([a], [b]) => compareText(a, b)));
}
