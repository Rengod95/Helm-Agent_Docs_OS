import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { assertNever, err, ok, parseJson, type Result } from "@fresnel/contracts";
import type { ExtensionLayer } from "@fresnel/contracts/extensions";
import type {
  DevkitError,
  KindEntry,
  MemberOp,
  PluginMode,
  ScaffoldMode,
  ScaffoldInput,
  ScaffoldResult,
} from "@fresnel/contracts/services";
import { checkOrchestrationName } from "@fresnel/contracts/services";
import { appSkeletonFiles, type AppSkeletonValues } from "./app-skeleton.ts";
import { KIND_CATALOG } from "./catalog.ts";
import { nativeSkeletonFiles } from "./native-skeleton.ts";
import { arrayOf, invalid, io, mapAll } from "./errors.ts";
import {
  ENTRY_PATH,
  MEMBERS_GENERATED_PATH,
  membersGeneratedText,
  planMembers,
} from "./members-plan.ts";
import { isRecord, isSafeRelative } from "./shared.ts";
import type { TemplateDirs } from "./templates-dir.ts";

// L3.authoring.spec §3.3 `scaffold`. 템플릿을 복사하고 자리(`__ID__`, `__TITLE__`, `__VERSION__`)를 채운 뒤
// 구성 초안(composition), Plugin UI 초안, 층, 구성원을 매니페스트에 패치한다. 대상 폴더 밖에는 쓰지 않는다.
// 구성원은 `editMembers`와 같은 계획 함수(members-plan.ts)로 더하므로 새 폴더가 곧바로 로드된다.

export const DEFAULT_VERSION = "0.1.0";

export interface ScaffoldOptions {
  readonly templates: TemplateDirs;
  /** 종류 카탈로그. 생략하면 내장 `KIND_CATALOG`(시험이 `blocked` 항목을 넣는 자리) */
  readonly catalog?: readonly KindEntry[];
  /** 표시 이름. 생략하면 이름 */
  readonly displayName?: string;
  /** 설치된 확장 이름(AU-001 충돌 검사) */
  readonly installedNames?: readonly string[];
}

function fill(text: string, values: { id: string; title: string; version: string }): string {
  return text
    .replaceAll("__ID__", values.id)
    .replaceAll("__TITLE__", values.title)
    .replaceAll("__VERSION__", values.version);
}

interface PlannedFile {
  /** 대상 폴더 기준 상대 경로 */
  readonly path: string;
  readonly bytes: Uint8Array;
}

async function targetState(dir: string): Promise<Result<"absent" | "empty", DevkitError>> {
  const found = await io(dir, () => stat(dir));
  if (!found.ok) return found.error.kind === "not_found" ? ok("absent") : found;
  if (!found.value.isDirectory()) return err({ kind: "exists", message: `${dir} is not a folder` });
  const children = await io(dir, () => readdir(dir));
  if (!children.ok) return children;
  return children.value.length === 0
    ? ok("empty")
    : err({ kind: "exists", message: `${dir} is not empty` });
}

async function readTemplateTree(
  root: string,
  relatives: readonly string[],
  strip: (path: string) => string | null,
): Promise<Result<PlannedFile[], DevkitError>> {
  const unsafe = relatives.find((relative) => !isSafeRelative(relative));
  if (unsafe !== undefined) return err(invalid(`template path is unsafe: ${unsafe}`));
  const read = await mapAll(relatives, async (relative) => {
    const target = strip(relative);
    if (target === null) return ok(null);
    const bytes = await io(relative, () => readFile(join(root, relative)));
    if (!bytes.ok) return bytes;
    return ok<PlannedFile | null>({ path: target, bytes: bytes.value });
  });
  if (!read.ok) return read;
  return ok(read.value.filter((file): file is PlannedFile => file !== null));
}

async function listFiles(root: string, prefix = ""): Promise<Result<string[], DevkitError>> {
  const entries = await io(root, () => readdir(join(root, prefix), { withFileTypes: true }));
  if (!entries.ok) return entries;
  const nested = await mapAll(entries.value, async (entry) => {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? listFiles(root, relative) : ok([relative]);
  });
  if (!nested.ok) return nested;
  return ok(nested.value.flat().toSorted());
}

/** 방식의 템플릿 폴더. 생략하면 훅 방식(기존 골격)이다. `app`과 `native`는 폴더가 없고 뼈대 모듈이 글을 준다 */
function templateOf(dirs: TemplateDirs, mode: PluginMode): string {
  switch (mode) {
    case "hook":
      return dirs.single;
    case "inject":
      return dirs.inject;
    case "drive":
      return dirs.drive;
    default:
      return assertNever(mode, "PluginMode");
  }
}

/**
 * 화면 뼈대(`app`, `native`)는 템플릿 폴더가 없고 뼈대 모듈(순수 함수)이 글을 만든다. 구성원을 받지 않고 엔진 코드가 생성 파일을 가져오지 않는다
 */
function isScreenSkeleton(mode: ScaffoldMode | undefined): mode is "app" | "native" {
  return mode === "app" || mode === "native";
}

/**
 * 뼈대 파일 목록과 내용을 읽는다. 종류는 플러그인 하나이고 방식마다 템플릿 폴더 전체를 쓴다.
 * 화면 뼈대(`app`, `native`)는 템플릿 폴더 없이 뼈대 모듈이 글을 만든다
 */
async function plannedTemplate(
  dirs: TemplateDirs,
  mode: ScaffoldMode,
  values: AppSkeletonValues,
): Promise<Result<PlannedFile[], DevkitError>> {
  if (isScreenSkeleton(mode)) {
    const files = mode === "app" ? appSkeletonFiles(values) : nativeSkeletonFiles(values);
    return ok(
      files.map((file) => ({
        path: file.path,
        bytes: new TextEncoder().encode(file.text),
      })),
    );
  }
  const root = templateOf(dirs, mode);
  const names = await listFiles(root);
  if (!names.ok) return names;
  return readTemplateTree(root, names.value, (path) => path);
}

/** 패치한 매니페스트 글, 구성원 코드 파일 목록(plugins[] 순서), 새 구성원의 기본 코드 파일 */
interface Patched {
  readonly text: string;
  readonly coded: readonly string[];
  readonly stubs: readonly PlannedFile[];
}

/**
 * 목적과 설명을 넣는다. `displayName` 바로 뒤에 놓고(없으면 끝에), 입력이 없으면 빈 문자열이라 AU-013이 채우라고 말한다 [결정: 2026-11-23 사용자, AGE-31]
 */
function withTextFields(
  manifest: Record<string, unknown>,
  input: ScaffoldInput,
): Record<string, unknown> {
  const entries = Object.entries(manifest).filter(
    ([key]) => key !== "purpose" && key !== "description",
  );
  const shown = entries.findIndex(([key]) => key === "displayName");
  const at = shown === -1 ? entries.length : shown + 1;
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries.slice(0, at)) out[key] = value;
  out["purpose"] = input.purpose ?? "";
  out["description"] = input.description ?? "";
  for (const [key, value] of entries.slice(at)) out[key] = value;
  return out;
}

function patchManifest(text: string, input: ScaffoldInput): Result<Patched, DevkitError> {
  const members = input.orchestration?.members ?? [];
  const json = parseJson(text);
  if (!json.ok || !isRecord(json.value)) return err(invalid("template manifest is not an object"));
  // 목적과 설명은 항상 쓰므로 매니페스트는 늘 다시 적는다(템플릿 글자 그대로는 두지 않는다)
  const manifest = withTextFields(json.value, input);
  const plugins = arrayOf(manifest["plugins"]);
  const root = plugins[0];
  if (!isRecord(root)) return err(invalid("template manifest has no root plugin"));
  const patchedRoot: Record<string, unknown> = { ...root };
  if (input.layer !== undefined) patchedRoot["layer"] = input.layer;

  const composition = input.orchestration?.composition;
  if (composition !== undefined) {
    const hooks = new Set<unknown>(arrayOf(root["hooks"]));
    for (const block of composition.blocks) {
      if (block.plugin === undefined) for (const hook of block.hooks ?? []) hooks.add(hook);
    }
    patchedRoot["hooks"] = [...hooks];
    patchedRoot["drives"] = composition.blocks.some(
      (block) => block.op === "drive" && block.plugin === undefined,
    );
    if (patchedRoot["drives"] !== true) delete patchedRoot["drives"];
    manifest["orchestration"] = { composition };
  }
  plugins[0] = patchedRoot;
  manifest["plugins"] = plugins;
  if (input.ui !== undefined) manifest["ui"] = input.ui;

  // 구성원은 편집 명령(add)으로 더한다. 목록이 있어야 하므로 `members: []`로 시작해 차례로 밀어 넣는다
  const existing = manifest["orchestration"];
  const seeded: Record<string, unknown> =
    members.length === 0
      ? manifest
      : { ...manifest, orchestration: { ...(isRecord(existing) ? existing : {}), members: [] } };
  const planned = planMembers(
    seeded,
    new Set(),
    members.map((id): MemberOp => ({ kind: "add", id })),
  );
  if (!planned.ok) return planned;
  const stubs = planned.value.actions.flatMap((action): PlannedFile[] =>
    action.kind === "write"
      ? [{ path: action.path, bytes: new TextEncoder().encode(action.text) }]
      : [],
  );
  return ok({
    text: `${JSON.stringify(planned.value.manifest, null, 2)}\n`,
    coded: planned.value.coded,
    stubs,
  });
}

const LAYERS_OF_SINGLE: ReadonlySet<ExtensionLayer> = new Set<ExtensionLayer>([
  "L1",
  "L2",
  "L3",
  "plugin",
]);

/** 종류 항목을 찾는다. 종류 값이 하나라 입력 종류와 항목 종류를 리터럴끼리 비교하면 린트가 막으므로 문자열로 받는다 */
function entryIn(catalog: readonly KindEntry[], id: string): KindEntry | undefined {
  return catalog.find((entry) => entry.id === id);
}

/** 뼈대를 만든다. 실패하면 파일을 하나도 쓰지 않는다(쓰기 전에 모두 계획한다) */
export async function scaffoldExtension(
  input: ScaffoldInput,
  options: ScaffoldOptions,
): Promise<Result<ScaffoldResult, DevkitError>> {
  const kind = entryIn(options.catalog ?? KIND_CATALOG, input.kind);
  if (kind === undefined) return err(invalid(`unknown kind: ${input.kind}`));
  if (kind.status === "blocked")
    return err({ kind: "blocked_kind", message: kind.blockedReason ?? "kind is blocked" });
  const named = checkOrchestrationName(input.name);
  if (!named.ok)
    return err(
      invalid(
        `AU-001: name "${input.name}" is ${named.error.reason === "pattern" ? "not valid" : "reserved"}`,
      ),
    );
  if (options.installedNames?.includes(input.name) === true)
    return err({ kind: "exists", message: `AU-001: "${input.name}" is already installed` });
  if (!isAbsolute(input.dir)) return err(invalid("dir must be an absolute path"));
  if (input.layer !== undefined && !LAYERS_OF_SINGLE.has(input.layer))
    return err(invalid(`layer ${input.layer} is not allowed`));

  // 화면 뼈대(앱, 선언형)는 구성원을 받지 않는다. 구성원은 뼈대를 만든 뒤 편집 명령으로 더한다
  if (isScreenSkeleton(input.mode) && (input.orchestration?.members ?? []).length > 0)
    return err(
      invalid(
        "the app and native modes take no members: scaffold it first, then add members with editMembers",
      ),
    );

  const state = await targetState(input.dir);
  if (!state.ok) return state;
  const values: AppSkeletonValues = {
    id: input.name,
    title: options.displayName ?? input.name,
    version: DEFAULT_VERSION,
  };
  const planned = await plannedTemplate(options.templates, input.mode ?? "hook", values);
  if (!planned.ok) return planned;

  const out: PlannedFile[] = [];
  let coded: readonly string[] = [];
  let stubs: readonly PlannedFile[] = [];
  for (const file of planned.value) {
    const path = fill(file.path, values);
    if (path === ".fresnel-plugin/plugin.json") {
      const patched = patchManifest(fill(new TextDecoder().decode(file.bytes), values), input);
      if (!patched.ok) return patched;
      out.push({ path, bytes: new TextEncoder().encode(patched.value.text) });
      coded = patched.value.coded;
      stubs = patched.value.stubs;
    } else if (/\.(json|ts|md)$/.test(path)) {
      out.push({
        path,
        bytes: new TextEncoder().encode(fill(new TextDecoder().decode(file.bytes), values)),
      });
    } else out.push({ path, bytes: file.bytes });
  }
  // 엔트리가 있는 뼈대나 코드 구성원이 있으면 생성 파일을 낸다. 엔트리 `src/index.ts`가 이 파일을 가져온다.
  // 화면 뼈대의 엔진 코드는 이 파일을 가져오지 않으므로 구성원 코드가 없으면 만들지 않는다
  if (
    coded.length > 0 ||
    (!isScreenSkeleton(input.mode) && out.some((file) => file.path === ENTRY_PATH))
  )
    out.push({
      path: MEMBERS_GENERATED_PATH,
      bytes: new TextEncoder().encode(membersGeneratedText(coded)),
    });
  out.push(...stubs);
  const written = await mapAll(out, (file) => {
    const target = join(input.dir, file.path);
    return io(target, async () => {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.bytes);
    });
  });
  if (!written.ok) return written;
  return ok({ dir: input.dir, files: out.map((file) => file.path).toSorted() });
}
