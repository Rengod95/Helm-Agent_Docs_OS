// Hook 시험 도우미: 설정 파일 값에서 제안과 생성까지 돌리고, 생성된 `plugin.js`를 임시 폴더에서 실제로 불러 가짜 `g`로 부른다.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseJson } from "@fresnel/contracts";
import { validateManifest, type ExtensionManifest } from "@fresnel/contracts/extensions";
import {
  bundledRulesets,
  propose,
  scanRoots,
  type MigrationScan,
  type Ruleset,
  type ScanRoot,
} from "../src/index.ts";
import { memoryFs, type MemoryEntry } from "./support.ts";

export const HOME: string = "/home/sample";
const APP: string = `${HOME}/work/app`;
export const USER_ROOT: ScanRoot = { path: HOME, scope: "user", label: "user" };
export const PROJECT_ROOT: ScanRoot = { path: APP, scope: "project", label: "app" };
const CTX: { readonly homeDir: string } = { homeDir: HOME };

/** 시험에서 쓰는 가짜 시크릿 값. 소스에 한 덩어리로 두지 않는다 */
export const FAKE_TOKEN: string = ["sk", "live-ABCDEFGH12345678"].join("-");

export function rulesetsOf(): readonly Ruleset[] {
  const bundled = bundledRulesets();
  if (!bundled.ok) throw new Error("the bundled rules are invalid");
  return bundled.value;
}

/** 파일 트리를 훑고 제안한다. `files`의 키는 절대 경로다 */
export async function proposeFrom(
  files: Readonly<Record<string, MemoryEntry>>,
  roots: readonly ScanRoot[] = [USER_ROOT],
): Promise<{ readonly scan: MigrationScan; readonly proposal: ReturnType<typeof propose> }> {
  const scan = await scanRoots({ roots, fs: memoryFs(files), ctx: CTX });
  return { scan, proposal: propose(scan, rulesetsOf(), { answers: {} }) };
}

/** 설정 파일 하나(프로젝트 범위)와 그 아래 스크립트 파일들로 만든 입력 */
export function projectFiles(
  settings: unknown,
  scripts: Readonly<Record<string, string>> = {},
): Readonly<Record<string, MemoryEntry>> {
  const files: Record<string, MemoryEntry> = {
    [`${APP}/.claude/settings.json`]: JSON.stringify(settings),
  };
  for (const [path, text] of Object.entries(scripts)) files[`${APP}/${path}`] = text;
  return files;
}

export function decode(bytes: Uint8Array | undefined): string {
  return bytes === undefined ? "" : new TextDecoder().decode(bytes);
}

/** 플러그인 폴더를 임시 폴더에 쓴다. 상대 경로를 그대로 쓴다 */
async function writeTree(tree: ReadonlyMap<string, Uint8Array>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fresnel-hook-plugin-"));
  await Promise.all(
    [...tree].map(async ([path, bytes]) => {
      const abs = join(dir, path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, bytes);
    }),
  );
  return dir;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 표준 입력(JSON 객체 하나)을 읽는다. 아니면 던진다(시험의 전제가 깨진 것이다) */
export function stdinOf(text: string): Readonly<Record<string, unknown>> {
  const parsed = parseJson(text);
  if (!parsed.ok || !isRecord(parsed.value)) throw new Error("stdin is not a JSON object");
  return parsed.value;
}

/** 문자열 목록을 코드 단위 순서로 정렬한다. 없는 값은 빈 문자열로 본다 */
export function sortedText(values: readonly (string | undefined)[]): string[] {
  return values.map((value) => value ?? "").toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

type Handler = (...args: readonly unknown[]) => unknown;

/** 가짜 `runScript` 응답. 실제 `ScriptRunResult`와 같은 모양이다 */
export interface FakeRun {
  readonly exitCode: number | null;
  readonly signal?: string | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly timedOut?: boolean;
}

export type FakeOutcome =
  | {
      readonly ok: true;
      readonly value: Required<FakeRun> & {
        readonly stdoutTruncated: boolean;
        readonly stderrTruncated: boolean;
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly kind: string;
        readonly code?: string;
        readonly path?: string;
        readonly reason?: string;
      };
    };

interface FakeCall {
  readonly name: string;
  readonly stdin: string;
}

export interface LoadedHookPlugin {
  readonly handlers: ReadonlyMap<string, Handler>;
  readonly calls: readonly FakeCall[];
}

interface EntryModule {
  readonly extension: (host: {
    readonly register: (id: string, def: unknown, setup: (g: FakeGroupApi) => void) => unknown;
  }) => unknown;
}

interface FakeGroupApi {
  readonly on: (point: string, handler: Handler) => void;
  readonly runScript: (name: string, options?: { readonly stdin?: string }) => Promise<FakeOutcome>;
}

function isEntryModule(value: unknown): value is EntryModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "extension" in value &&
    typeof value.extension === "function"
  );
}

/** 값으로 된 응답을 `ok`로 감싼다. 시험에서 실행 결과를 쓰기 쉽게 한다 */
export function ran(run: FakeRun): FakeOutcome {
  return {
    ok: true,
    value: {
      exitCode: run.exitCode,
      signal: run.signal ?? null,
      stdout: run.stdout ?? "",
      stdoutTruncated: false,
      stderr: run.stderr ?? "",
      stderrTruncated: false,
      timedOut: run.timedOut ?? false,
    },
  };
}

/**
 * 생성된 플러그인을 임시 폴더에서 불러 가짜 `g`로 등록한다. `runner(name, stdin)`이 스크립트 호출의 결과를 정한다.
 * 호출 기록(`calls`)은 `g.runScript`가 받은 이름과 표준 입력이다.
 */
export async function loadHookPlugin(
  tree: ReadonlyMap<string, Uint8Array>,
  runner: (name: string, stdin: string) => Promise<FakeOutcome> | FakeOutcome,
): Promise<LoadedHookPlugin> {
  const dir = await writeTree(tree);
  const loaded: unknown = await import(pathToFileURL(join(dir, "plugin.js")).href);
  if (!isEntryModule(loaded)) throw new Error("plugin.js does not export extension");
  const handlers = new Map<string, Handler>();
  const calls: FakeCall[] = [];
  const g: FakeGroupApi = {
    on(point, handler) {
      handlers.set(point, handler);
    },
    async runScript(name, options) {
      const stdin = options?.stdin ?? "";
      calls.push({ name, stdin });
      return runner(name, stdin);
    },
  };
  loaded.extension({
    register: (_id, _def, setup) => {
      setup(g);
      return undefined;
    },
  });
  return { handlers, calls };
}

/** 매니페스트를 읽고 `validateManifest`로 검사한 값. 검사에 실패하면 던진다(시험의 전제가 깨진 것이다) */
export function manifestOf(tree: ReadonlyMap<string, Uint8Array>): ExtensionManifest {
  const bytes = tree.get(".fresnel-plugin/plugin.json");
  if (bytes === undefined) throw new Error("no manifest");
  const parsed = parseJson(decode(bytes));
  if (!parsed.ok) throw new Error("manifest is not JSON");
  const checked = validateManifest(parsed.value);
  const errors = checked.issues.filter((issue) => issue.severity === "error");
  if (checked.manifest === undefined || errors.length > 0) {
    throw new Error(`manifest is invalid: ${errors.map((issue) => issue.code).join(",")}`);
  }
  return checked.manifest;
}
