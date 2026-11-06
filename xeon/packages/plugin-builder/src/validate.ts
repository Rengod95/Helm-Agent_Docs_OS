import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import type { CapabilityId } from "@fresnel/contracts/capabilities";
import {
  validateComposition,
  validateManifest,
  type CompositionDecl,
  type ExtensionManifest,
  type ManifestIssue,
  type PluginDecl,
} from "@fresnel/contracts/extensions";
import type { DevkitError, DevkitIssue, ValidationReport } from "@fresnel/contracts/services";
import { checkGroupName } from "@fresnel/group-sdk";
import { au004, au008, au010, au011, type SourceText } from "./au-rules.ts";
import { arrayOf, invalid, io, mapAll } from "./errors.ts";

// L3.authoring.spec §3.3 `validate`, §3.5 제작 검사. F 검사 함수(validateManifest, validateComposition)와
// group-sdk 재생 규율 검사(검사기를 넘기면 scanDriveSource)를 차례로 돌리고 AU 규칙을 더한다. 규칙을 복사하지 않는다.
// 릴리즈 바이너리는 검사기를 싣지 않는다(파서 `@swc/core`가 바이너리에 들어가면 안 된다). 그래서 이 모듈은 testing 진입점을 import하지 않는다.

export const MANIFEST_PATH = ".fresnel-plugin/plugin.json";

const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", "dist", ".git"]);

function reportOf(issues: readonly DevkitIssue[]): ValidationReport {
  return { ok: !issues.some((entry) => entry.severity === "error"), issues };
}

function fromManifest(found: ManifestIssue): DevkitIssue {
  return { severity: found.severity, code: found.code, path: found.path, message: found.message };
}

/** 구성 초안 검사(W-47). `plugins`가 있으면 선언과 대조한다(AU-003) */
export function validateCompositionReport(
  composition: CompositionDecl,
  plugins?: readonly PluginDecl[],
): ValidationReport {
  const manifestContext =
    plugins === undefined ? {} : { manifest: compositionManifest(plugins, composition) };
  return reportOf(validateComposition(composition, manifestContext).map(fromManifest));
}

/** 선언만 있는 임시 매니페스트. 검사 함수가 필요한 필드만 채운다 */
function compositionManifest(
  plugins: readonly PluginDecl[],
  composition: CompositionDecl,
): ExtensionManifest {
  return {
    schemaVersion: 2,
    name: "draft",
    version: "0.0.0",
    entry: "./src/index.ts",
    plugins: [...plugins],
    group: { composition },
  };
}

const SECRET_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "api key literal", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "cloud access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: "secret assigned to a string literal",
    pattern: /\b(?:api[_-]?key|secret|token|password)\b["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i,
  },
];

async function sourceFiles(root: string, prefix = ""): Promise<Result<string[], DevkitError>> {
  const entries = await io(root, () => readdir(join(root, prefix), { withFileTypes: true }));
  if (!entries.ok) return entries;
  const nested = await mapAll(entries.value, async (entry) => {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIPPED_FOLDERS.has(entry.name) || (prefix === "" && entry.name === "test"))
        return ok<string[]>([]);
      return sourceFiles(root, relative);
    }
    return ok(/\.(ts|tsx)$/.test(entry.name) ? [relative] : []);
  });
  if (!nested.ok) return nested;
  return ok(nested.value.flat().toSorted());
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index; at += 1) if (text.charCodeAt(at) === 10) line += 1;
  return line;
}

/**
 * 원문에서 `"key":`가 처음 나오는 줄(1부터). 원문에 없으면 undefined다. JSON 파서는 위치를 주지 않아 글자 찾기로 본다.
 * 같은 이름의 키가 여러 곳에 있으면 처음 것이라 중첩된 같은 이름의 키는 다른 줄을 가리킬 수 있다
 */
export function lineOfKey(text: string, key: string): number | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`"${escaped}"\\s*:`).exec(text);
  return found === null ? undefined : lineOf(text, found.index);
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : undefined;
}

/** 원본 JSON에서 읽은 AU 검사용 값. 스키마 오류가 있어 정규화 매니페스트가 없어도 읽는다 */
function rawFacts(json: unknown): {
  readonly trustLevel: unknown;
  readonly apps: readonly { readonly index: number; readonly hasFallback: boolean }[];
} {
  const root = recordOf(json);
  const trust = recordOf(root?.["trust"]);
  const items = arrayOf(recordOf(root?.["ui"])?.["items"]);
  const apps = items.flatMap((item, index) => {
    const record = recordOf(item);
    return record?.["app"] === undefined
      ? []
      : [{ index, hasFallback: record["fallback"] !== undefined }];
  });
  return { trustLevel: trust?.["level"], apps };
}

function manifestOf(
  text: string,
): Result<
  { manifest: ExtensionManifest | undefined; issues: DevkitIssue[]; raw: unknown },
  DevkitError
> {
  const json = parseJson(text);
  if (!json.ok) return err(invalid(`${MANIFEST_PATH} is not JSON`));
  const checked = validateManifest(json.value);
  return ok({
    manifest: checked.manifest,
    issues: checked.issues.map(fromManifest),
    raw: json.value,
  });
}

/** 재생 규율 검사 발견 한 건. `scanDriveSource`의 발견 중 이 모듈이 쓰는 필드만 적는다 */
interface DriveFinding {
  readonly severity: DevkitIssue["severity"];
  readonly code: string;
  readonly target: string;
  readonly message: string;
  readonly line: number;
}

/** 소스 한 파일을 재생 규율로 검사하는 함수. `scanDriveSource`(`@fresnel/group-sdk/testing`)와 같은 모양이다 */
type DriveScanner = (
  source: string,
  options: { readonly fileName: string },
) => readonly DriveFinding[];

export interface ValidateOptions {
  /** 이 맥락에서 켜진 기능 제공자. 있으면 AU-004가 필수 기능의 제공자 없음을 경고한다 */
  readonly providers?: readonly CapabilityId[];
  /**
   * 재생 규율 검사기. 있으면 drive가 있는 확장의 위반마다 AU-012 오류를 낸다.
   * 없으면 drive가 있을 때 검사가 돌지 않았다는 AU-012 경고를 폴더마다 한 번 낸다
   */
  readonly scanDrive?: DriveScanner;
}

/** 확장 폴더를 검사한다. 매니페스트가 없으면 `not_found`다 */
export async function validateExtensionDir(
  dir: string,
  options: ValidateOptions = {},
): Promise<Result<ValidationReport, DevkitError>> {
  const folder = await io(dir, () => stat(dir));
  if (!folder.ok) return folder;
  const text = await io(MANIFEST_PATH, () => readFile(join(dir, MANIFEST_PATH), "utf8"));
  if (!text.ok) return text;
  const parsed = manifestOf(text.value);
  if (!parsed.ok) return parsed;
  const issues: DevkitIssue[] = [...parsed.value.issues];
  const manifest = parsed.value.manifest;
  // AU-002: 외부 제작물은 builtin 등급을 요청하지 못한다. AU-006: project 등급이 Plugin App(격리 프레임)을 요청하면 설치 환경 설정에 따라 막힐 수 있다.
  // AU-007: app 화면에 fallback이 없다. 스키마 오류가 있어도 원본 JSON으로 본다
  const facts = rawFacts(parsed.value.raw);
  if (facts.trustLevel === "builtin")
    issues.push({
      severity: "error",
      code: "AU-002",
      path: "/trust/level",
      message: "an authored extension cannot request the builtin trust level",
    });
  for (const app of facts.apps) {
    if (facts.trustLevel === "project")
      issues.push({
        severity: "warning",
        code: "AU-006",
        path: `/ui/items/${app.index}/app`,
        message: "a project-trust extension may not be allowed to run a Plugin App",
      });
    if (!app.hasFallback)
      issues.push({
        severity: "warning",
        code: "AU-007",
        path: `/ui/items/${app.index}/fallback`,
        message: "a Plugin App view has no fallback native view",
      });
  }

  if (manifest !== undefined) {
    // AU-001: 이름 규칙(validateManifest의 name_reserved와 겹치지 않을 때만)
    const named = checkGroupName(manifest.name);
    if (!named.ok && !issues.some((entry) => entry.path === "/name"))
      issues.push({
        severity: "error",
        code: "AU-001",
        path: "/name",
        message: `name "${manifest.name}" is ${named.error.reason === "pattern" ? "not valid" : "reserved"}`,
      });
    const entryPath = join(dir, manifest.entry);
    const entryFile = await io(manifest.entry, () => stat(entryPath));
    if (!entryFile.ok)
      issues.push({
        severity: "error",
        code: "entry_missing",
        path: "/entry",
        message: `entry ${manifest.entry} does not exist`,
      });
  }

  const files = await sourceFiles(dir);
  if (!files.ok) return files;
  const drives = manifest?.plugins.some((plugin) => plugin.drives === true) === true;
  const scanDrive = options.scanDrive;
  const texts: SourceText[] = [];
  const sources = await mapAll(files.value, async (file) => {
    const source = await io(file, () => readFile(join(dir, file), "utf8"));
    if (!source.ok) return source;
    texts.push({ file, text: source.value });
    const found: DevkitIssue[] = [];
    for (const { name, pattern } of SECRET_PATTERNS) {
      const match = pattern.exec(source.value);
      if (match !== null)
        found.push({
          severity: "error",
          code: "AU-009",
          path: "",
          message: `${name} in source`,
          file,
          line: lineOf(source.value, match.index),
        });
    }
    if (drives && scanDrive !== undefined) {
      for (const finding of scanDrive(source.value, { fileName: file }))
        found.push({
          severity: finding.severity,
          code: "AU-012",
          path: "",
          message: `${finding.code} ${finding.target}: ${finding.message}`,
          file,
          line: finding.line,
        });
    }
    return ok(found);
  });
  if (!sources.ok) return sources;
  issues.push(...sources.value.flat());
  if (drives && scanDrive === undefined)
    issues.push({
      severity: "warning",
      code: "AU-012",
      path: "",
      message:
        "the replay discipline scan did not run in this build; run scanDriveSource from @fresnel/group-sdk/testing to check the drive",
    });
  issues.push(...au004(issues, manifest, options.providers));
  if (manifest !== undefined) {
    if (drives) issues.push(...au010(manifest, texts), ...au011(texts));
  }
  issues.push(...au008(arrayOf(recordOf(recordOf(parsed.value.raw)?.["ui"])?.["items"])));
  return ok(reportOf(issues));
}
