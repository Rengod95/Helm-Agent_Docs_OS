import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { assertNever, err, ok, parseJson, type Result } from "@fresnel/contracts";
import {
  dependenciesOf,
  validateManifest,
  type ManifestIssue,
} from "@fresnel/contracts/extensions";
import type {
  DependenciesEditInput,
  DependenciesEditResult,
  DependencyInfo,
  DependencyOp,
  DevkitError,
  DevkitIssue,
} from "@fresnel/contracts/services";
import { arrayOf, invalid, io } from "./errors.ts";
import { isRecord } from "./shared.ts";
import { MANIFEST_PATH } from "./validate.ts";

// 의존 편집(AGE-33). `editMembers`와 같은 방식으로 원본 폴더 매니페스트의 `plugins[].dependsOn` 줄을 더하고 뺀다.
// 모든 건을 메모리에서 적용하고 새 매니페스트를 검사한 뒤에만 매니페스트를 쓴다. 코드 파일은 건드리지 않는다.
// 설치하지 않고 승인하지 않는다. 고친 폴더는 호출자가 `plugin.draft.create`로 다시 초안을 만든다.
// 설치본과 저장소 안의 폴더 거절은 포트(assembly/m4/devkit-port.ts)가 한다.

type RawDecl = Record<string, unknown>;
type RawManifest = Record<string, unknown>;
type AddDependency = Extract<DependencyOp, { readonly kind: "add" }>["dependency"];

/** `plugins`가 없을 때 추론하는 뿌리 플러그인 선언(`pluginDeclsOf`와 같은 모양) */
const ROOT_DECL: RawDecl = { layer: "plugin", hooks: [] };

/** 의존 줄을 읽는다(쓰지 않는다). `editDependencies`에 빈 `ops`를 준 것과 같다 */
export async function readDependencies(
  dir: string,
): Promise<Result<readonly DependencyInfo[], DevkitError>> {
  const read = await editDependencies({ dir, ops: [] });
  return read.ok ? ok(read.value.dependencies) : read;
}

/**
 * 의존 편집을 적용한다. 하나라도 실패하면 아무 파일도 쓰지 않는다. `ops`가 비어 있으면 쓰지 않는 읽기다.
 * 새 매니페스트가 검사에서 막히면 `invalid_input`과 사유 목록을 돌려준다(`members.ts`의 `refusedOf`와 같은 모양)
 */
export async function editDependencies(
  input: DependenciesEditInput,
): Promise<Result<DependenciesEditResult, DevkitError>> {
  if (!isAbsolute(input.dir)) return err(invalid("dir must be an absolute path"));
  const text = await io(MANIFEST_PATH, () => readFile(join(input.dir, MANIFEST_PATH), "utf8"));
  if (!text.ok) return text;
  const parsed = parseJson(text.value);
  const raw = parsed.ok ? parsed.value : undefined;
  if (!isRecord(raw)) return err(invalid(`${MANIFEST_PATH} is not a JSON object`));

  const applied = applyOps(raw, input.ops);
  if (!applied.ok) return applied;
  const checked = validateManifest(applied.value);
  const manifest = checked.manifest;
  if (manifest === undefined) return err(refusedOf(checked.issues));

  const writing = input.ops.length > 0;
  if (writing) {
    const written = await io(MANIFEST_PATH, () =>
      writeFile(join(input.dir, MANIFEST_PATH), `${JSON.stringify(applied.value, null, 2)}\n`),
    );
    if (!written.ok) return written;
  }
  return ok({
    dependencies: dependenciesOf(manifest).map(({ from, target, kind, range }) => ({
      from,
      target,
      kind,
      range,
    })),
    issues: checked.issues.map(toDevkitIssue),
    changedFiles: writing ? [MANIFEST_PATH] : [],
  });
}

/** 건을 위에서 아래로 적용한다. 한 건이 실패하면 그 오류를 그대로 돌려준다 */
function applyOps(
  manifest: RawManifest,
  ops: readonly DependencyOp[],
): Result<RawManifest, DevkitError> {
  let current = manifest;
  for (const op of ops) {
    const step = applyOp(current, op);
    if (!step.ok) return step;
    current = step.value;
  }
  return ok(current);
}

function applyOp(manifest: RawManifest, op: DependencyOp): Result<RawManifest, DevkitError> {
  switch (op.kind) {
    case "add": {
      const entry = entryOf(op.dependency);
      return changeLines(manifest, op.from, (lines) =>
        ok(replaceLine(lines, op.dependency.plugin, entry)),
      );
    }
    case "remove":
      return changeLines(manifest, op.from, (lines, where) => {
        const kept = lines.filter((line) => !targets(line, op.plugin));
        return kept.length === lines.length ? err(lineNotFound(op.plugin, where)) : ok(kept);
      });
    default:
      return assertNever(op, "DependencyOp");
  }
}

/**
 * 의존을 거는 플러그인(`from`, 생략하면 뿌리)의 `dependsOn` 줄을 바꾼다. `plugins`가 매니페스트에 없으면 추론한 뿌리 플러그인 하나를
 * 대상으로 하고, 바꾼 뒤에는 그 선언을 `plugins`에 넣는다. 구성원 id로 적은 `from`은 `plugins`에 선언이 있어야 찾는다
 */
function changeLines(
  manifest: RawManifest,
  from: string | undefined,
  change: (lines: readonly unknown[], where: string) => Result<readonly unknown[], DevkitError>,
): Result<RawManifest, DevkitError> {
  const decls = declsOf(manifest);
  if (!decls.ok) return decls;
  const hit = decls.value
    .map((decl, index) => ({ decl, index }))
    .find((entry) => idOf(entry.decl) === from);
  if (hit === undefined) return err(memberNotFound(from));
  const lines = linesOf(hit.decl);
  if (!lines.ok) return lines;
  const changed = change(lines.value, `plugins/${hit.index}/dependsOn`);
  if (!changed.ok) return changed;
  const next = decls.value.map((decl, index) =>
    index === hit.index
      ? withKey(decl, "dependsOn", changed.value.length === 0 ? undefined : changed.value)
      : decl,
  );
  return ok({ ...manifest, plugins: next });
}

/** 플러그인 선언 목록. `plugins`가 없으면 뿌리 플러그인 하나다 */
function declsOf(manifest: RawManifest): Result<RawDecl[], DevkitError> {
  const raw: unknown = manifest["plugins"] ?? [ROOT_DECL];
  if (!Array.isArray(raw)) return err(invalid("plugins must be an array"));
  const decls = arrayOf(raw);
  if (!decls.every(isRecord)) return err(invalid("every plugins entry must be an object"));
  return ok(decls);
}

function linesOf(decl: RawDecl): Result<unknown[], DevkitError> {
  const raw = decl["dependsOn"];
  if (raw === undefined) return ok([]);
  if (!Array.isArray(raw)) return err(invalid("dependsOn must be an array"));
  return ok(arrayOf(raw));
}

/** 같은 대상의 줄이 있으면 그 자리의 줄을 새 값으로 바꾸고 같은 대상의 나머지 줄은 지운다. 없으면 끝에 더한다 */
function replaceLine(lines: readonly unknown[], plugin: string, entry: RawDecl): unknown[] {
  const at = lines.findIndex((line) => targets(line, plugin));
  if (at < 0) return [...lines, entry];
  return lines.flatMap((line, index) => {
    if (index === at) return [entry];
    return targets(line, plugin) ? [] : [line];
  });
}

function targets(line: unknown, plugin: string): boolean {
  return isRecord(line) && line["plugin"] === plugin;
}

function entryOf(dependency: AddDependency): RawDecl {
  return {
    plugin: dependency.plugin,
    ...(dependency.range === undefined ? {} : { range: dependency.range }),
    ...(dependency.kind === undefined ? {} : { kind: dependency.kind }),
  };
}

function idOf(decl: RawDecl): string | undefined {
  const id = decl["id"];
  return typeof id === "string" ? id : undefined;
}

function memberNotFound(from: string | undefined): DevkitError {
  const message =
    from === undefined
      ? "the root plugin is not declared in plugins"
      : `plugin "${from}" is not a member of this extension`;
  return {
    kind: "invalid_input",
    message,
    reasons: [{ code: "member_not_found", field: "plugins", message }],
  };
}

function lineNotFound(plugin: string, where: string): DevkitError {
  const message = `${where} has no dependency on "${plugin}"`;
  return {
    kind: "invalid_input",
    message,
    reasons: [{ code: "dependency_not_found", field: where, message }],
  };
}

/** 키의 자리를 지킨 채 값을 바꾼다. 값이 undefined면 키를 지운다 */
function withKey(object: RawDecl, key: string, value: unknown): RawDecl {
  if (value === undefined)
    return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
  return { ...object, [key]: value };
}

/** 매니페스트 검사 오류로 거절한다. 사유마다 코드와 매니페스트 안 경로를 싣는다(`members.ts`와 같은 모양) */
function refusedOf(issues: readonly ManifestIssue[]): DevkitError {
  const errors = issues.filter((found) => found.severity === "error");
  return {
    kind: "invalid_input",
    message: `${MANIFEST_PATH} would not validate: ${errors.map((found) => found.code).join(", ")}`,
    reasons: errors.map((found) => ({
      code: found.code,
      field: found.path.replace(/^\//, ""),
      message: found.message,
    })),
  };
}

function toDevkitIssue(found: ManifestIssue): DevkitIssue {
  return { severity: found.severity, code: found.code, path: found.path, message: found.message };
}
