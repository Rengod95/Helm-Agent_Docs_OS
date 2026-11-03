import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { err, ok, parse, parseJson, type Result } from "@fresnel/contracts";
import type { CompositionDecl, ExtensionLayer } from "@fresnel/contracts/extensions";
import type {
  DevkitError,
  KindEntry,
  ScaffoldInput,
  ScaffoldResult,
} from "@fresnel/contracts/services";
import { checkGroupName, TemplateIndexSchema, type TemplateKind } from "@fresnel/group-sdk";
import { KIND_CATALOG } from "./catalog.ts";
import { arrayOf, invalid, io, mapAll } from "./errors.ts";
import type { TemplateDirs } from "./templates-dir.ts";

// L3.authoring.spec §3.3 `scaffold`. 템플릿을 복사하고 자리(`__ID__`, `__TITLE__`, `__VERSION__`)를 채운 뒤
// 구성 초안(composition), Plugin UI 초안, 층을 매니페스트에 패치한다. 대상 폴더 밖에는 쓰지 않는다.

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

/** 구성 초안에서 그룹 템플릿 종류를 고른다. drive 블록이 있거나 초안이 없으면 drive, 도구 호출 앞 훅만 있으면 policy, 아니면 observe */
export function templateKindOf(composition: CompositionDecl | undefined): TemplateKind {
  if (composition === undefined) return "drive";
  if (composition.blocks.some((block) => block.op === "drive")) return "drive";
  const onBlocks = composition.blocks.filter((block) => block.op === "on");
  if (
    onBlocks.length > 0 &&
    onBlocks.every((block) => block.hooks?.includes("tool.call.before") === true)
  )
    return "policy";
  return "observe";
}

function fill(text: string, values: { id: string; title: string; version: string }): string {
  return text
    .replaceAll("__ID__", values.id)
    .replaceAll("__TITLE__", values.title)
    .replaceAll("__VERSION__", values.version);
}

function isSafeRelative(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
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

/** 템플릿 파일 목록과 내용을 읽는다. 그룹은 index.json의 목록, 단일 플러그인은 폴더 전체다 */
async function plannedTemplate(
  input: ScaffoldInput,
  dirs: TemplateDirs,
): Promise<Result<PlannedFile[], DevkitError>> {
  if (input.kind === "single-plugin") {
    const names = await listFiles(dirs.single);
    if (!names.ok) return names;
    return readTemplateTree(dirs.single, names.value, (path) => path);
  }
  const indexText = await io("templates/index.json", () =>
    readFile(join(dirs.group, "index.json"), "utf8"),
  );
  if (!indexText.ok) return indexText;
  const json = parseJson(indexText.value);
  if (!json.ok) return err(invalid("templates/index.json is not JSON"));
  const index = parse(TemplateIndexSchema, json.value);
  if (!index.ok) return err(invalid("templates/index.json has an unexpected shape"));
  const kind = templateKindOf(input.group?.composition);
  const entry = index.value.templates[kind];
  return readTemplateTree(dirs.group, entry.files, (path) => {
    const rest = path.split("/").slice(1).join("/");
    return rest === "" ? null : rest;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function patchManifest(text: string, input: ScaffoldInput): Result<string, DevkitError> {
  const wantsPatch =
    input.group?.composition !== undefined ||
    (input.group?.members?.length ?? 0) > 0 ||
    input.ui !== undefined ||
    (input.layer !== undefined && input.kind === "single-plugin");
  // 패치할 것이 없으면 템플릿 글자 그대로 둔다(`fresnel group new`와 같은 파일, spec §9 A-2)
  if (!wantsPatch) return ok(text);
  const json = parseJson(text);
  if (!json.ok || !isRecord(json.value)) return err(invalid("template manifest is not an object"));
  const manifest: Record<string, unknown> = { ...json.value };
  const plugins = arrayOf(manifest["plugins"]);
  const root = plugins[0];
  if (!isRecord(root)) return err(invalid("template manifest has no root plugin"));
  const patchedRoot: Record<string, unknown> = { ...root };
  if (input.layer !== undefined && input.kind === "single-plugin")
    patchedRoot["layer"] = input.layer;

  const composition = input.group?.composition;
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
    manifest["group"] = { composition };
  }
  plugins[0] = patchedRoot;
  for (const member of input.group?.members ?? []) {
    plugins.push({
      id: member,
      layer: "L3",
      hooks: ["boundary.settle.after"],
      defaultEnabled: false,
    });
  }
  manifest["plugins"] = plugins;
  if (input.ui !== undefined) manifest["ui"] = input.ui;
  return ok(`${JSON.stringify(manifest, null, 2)}\n`);
}

const LAYERS_OF_SINGLE: ReadonlySet<ExtensionLayer> = new Set<ExtensionLayer>([
  "L1",
  "L2",
  "L3",
  "plugin",
]);

/** 뼈대를 만든다. 실패하면 파일을 하나도 쓰지 않는다(쓰기 전에 모두 계획한다) */
export async function scaffoldExtension(
  input: ScaffoldInput,
  options: ScaffoldOptions,
): Promise<Result<ScaffoldResult, DevkitError>> {
  const kind = (options.catalog ?? KIND_CATALOG).find((entry) => entry.id === input.kind);
  if (kind === undefined) return err(invalid(`unknown kind: ${input.kind}`));
  if (kind.status === "blocked")
    return err({ kind: "blocked_kind", message: kind.blockedReason ?? "kind is blocked" });
  const named = checkGroupName(input.name);
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
  if (input.kind === "plugin-group" && input.layer !== undefined && input.layer !== "L3")
    return err(invalid("a plugin group has layer L3"));

  const state = await targetState(input.dir);
  if (!state.ok) return state;
  const planned = await plannedTemplate(input, options.templates);
  if (!planned.ok) return planned;

  const values = {
    id: input.name,
    title: options.displayName ?? input.name,
    version: DEFAULT_VERSION,
  };
  const out: PlannedFile[] = [];
  for (const file of planned.value) {
    const path = fill(file.path, values);
    if (path === ".fresnel-plugin/plugin.json") {
      const patched = patchManifest(fill(new TextDecoder().decode(file.bytes), values), input);
      if (!patched.ok) return patched;
      out.push({ path, bytes: new TextEncoder().encode(patched.value) });
    } else if (/\.(json|ts|md)$/.test(path)) {
      out.push({
        path,
        bytes: new TextEncoder().encode(fill(new TextDecoder().decode(file.bytes), values)),
      });
    } else out.push({ path, bytes: file.bytes });
  }
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
