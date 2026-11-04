import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { attemptAsync, err, ok, parseJson, type Result } from "@fresnel/contracts";
import {
  isGroupExtension,
  validateManifest,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@fresnel/contracts/extensions";
import type { DevkitError } from "@fresnel/contracts/services";
import { registerSdkModules, X_SDK_MODULES } from "@fresnel/ext-host";
import * as groupSdk from "@fresnel/group-sdk";
import {
  createRuntimeReplayHarness,
  replayDrive,
  type ReplayDriveReport,
} from "@fresnel/group-sdk/testing";
import { invalid } from "./errors.ts";
import { MANIFEST_PATH } from "./validate.ts";

// 설치된 플러그인 그룹의 재생(W-29 `ext.test.run` replay). 호스트 운영 코드는 `@fresnel/group-sdk/testing`을 import하지 않으므로(DR-08)
// 재생기는 이 패키지에 둔다. 설치 폴더의 매니페스트와 엔트리를 읽어 `GroupModule`을 만들고 `replayDrive`를 돌린다.
// 재생에는 `manifest`와 `entry`만 쓰인다. `stateVersion`은 설치본에서 알 수 없어 0으로 둔다(재생 하니스는 읽지 않는다).

/** 재생 상한의 최대값. 호스트의 `maxCommits` 범위와 같다 */
const MAX_COMMITS_LIMIT = 1000;

export interface InstalledReplayInput {
  /** 설치된 확장 폴더. 매니페스트와 엔트리가 그 안에 있어야 한다(심볼릭 링크는 실제 경로로 푼다) */
  readonly dir: string;
  /** 기준 실행의 커밋 수 상한(1~1000) */
  readonly maxCommits: number;
}

/** `replayDrive` 보고 가운데 와이어 변환에 필요한 칸만 싣는다. 절단의 digest와 thread id는 싣지 않는다 */
export interface InstalledReplayReport {
  readonly ok: boolean;
  readonly commits: number;
  readonly cuts: readonly {
    readonly commitIndex: number;
    readonly equal: boolean;
    readonly firstDiff: number | null;
  }[];
  readonly effects?: {
    readonly turn: number;
    readonly spawn: number;
    readonly delegate: number;
    readonly post: number;
  };
  readonly failure?:
    | "max-commits-exceeded"
    | "no-commits"
    | "thread-mismatch"
    | "effects-doubled"
    | "effects-mismatch";
}

type UnknownCallable = (...args: readonly unknown[]) => unknown;

function isCallable(value: unknown): value is UnknownCallable {
  return typeof value === "function";
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** 그룹 매니페스트인가: `group` 선언과 루트 L3 플러그인이 있어야 한다. 규칙은 group-sdk `validateGroupDef`가 정한 것을 쓴다 */
function isGroupManifest(manifest: ExtensionManifest): manifest is groupSdk.GroupManifest {
  return (
    isGroupExtension(manifest) &&
    !groupSdk
      .validateGroupDef({ manifest })
      .some((found) => found.code === "group_missing_orchestration")
  );
}

/** 모듈의 `default` 또는 `extension` 중 함수인 쪽. `default`가 먼저다(X.loading-trust §4.4.2와 같다) */
function callableEntryOf(loaded: unknown): UnknownCallable | undefined {
  if (typeof loaded !== "object" || loaded === null) return undefined;
  const fromDefault = "default" in loaded ? loaded.default : undefined;
  if (isCallable(fromDefault)) return fromDefault;
  const fromNamed = "extension" in loaded ? loaded.extension : undefined;
  return isCallable(fromNamed) ? fromNamed : undefined;
}

async function readManifest(root: string): Promise<Result<ExtensionManifest, DevkitError>> {
  const text = await attemptAsync(() => readFile(join(root, MANIFEST_PATH), "utf8"));
  if (!text.ok) return err(invalid(`${MANIFEST_PATH} cannot be read`));
  const json = parseJson(text.value);
  if (!json.ok) return err(invalid(`${MANIFEST_PATH} is not JSON`));
  const checked = validateManifest(json.value);
  const errors = checked.issues.filter((found) => found.severity === "error");
  if (checked.manifest === undefined || errors.length > 0) {
    return err(
      invalid(`${MANIFEST_PATH} is not valid (${errors.map((found) => found.code).join(", ")})`),
    );
  }
  return ok(checked.manifest);
}

function reportOf(run: ReplayDriveReport): InstalledReplayReport {
  return {
    ok: run.ok,
    commits: run.commits,
    cuts: run.cuts.map((cut) => ({
      commitIndex: cut.commitIndex,
      equal: cut.equal,
      firstDiff: cut.firstDiff,
    })),
    ...(run.effects === undefined ? {} : { effects: run.effects }),
    ...(run.failure === undefined ? {} : { failure: run.failure }),
  };
}

/**
 * 설치된 플러그인 그룹을 실제 `ExtHost`에 올려 drive를 커밋 지점마다 끊어 재생하고 보고를 돌려준다. 통과든 실패든 보고는 `ok`다.
 * 그룹이 아니거나, 매니페스트·엔트리가 없거나, 엔트리가 폴더 밖이거나, 함수 export가 없거나, 가져오기·재생이 던지면 `err`다.
 * 던지지 않는다. SDK 모듈은 이 함수가 가상 모듈로 등록한다(같은 객체면 멱등). 엔트리 가져오기는 프로세스마다 경로별로 캐시되므로,
 * 같은 경로의 설치본을 새 내용으로 바꾼 뒤에도 같은 프로세스에서는 옛 모듈로 재생된다.
 */
export async function runInstalledReplay(
  input: InstalledReplayInput,
): Promise<Result<InstalledReplayReport, DevkitError>> {
  if (
    !Number.isInteger(input.maxCommits) ||
    input.maxCommits < 1 ||
    input.maxCommits > MAX_COMMITS_LIMIT
  ) {
    return err(invalid(`maxCommits must be an integer from 1 to ${String(MAX_COMMITS_LIMIT)}`));
  }
  // 실제 경로로 푼다: macOS의 임시 폴더처럼 링크가 낀 경로에서 엔트리가 폴더 안인지 비교하려면 두 쪽이 같은 형식이어야 한다
  const root = await attemptAsync(() => realpath(input.dir));
  if (!root.ok) return err({ kind: "io", message: "the extension folder cannot be read" });
  const manifest = await readManifest(root.value);
  if (!manifest.ok) return manifest;
  if (!isGroupManifest(manifest.value)) {
    return err(
      invalid(
        `${manifest.value.name} is not a plugin group (its manifest needs a group declaration and a root L3 plugin)`,
      ),
    );
  }

  const declared = manifest.value.entry;
  const real = await attemptAsync(() => realpath(join(root.value, declared)));
  if (!real.ok) return err({ kind: "not_found", message: `entry ${declared} does not exist` });
  if (!real.value.startsWith(`${root.value}${sep}`)) {
    return err(invalid(`entry ${declared} resolves outside the extension root`));
  }

  // SDK 가상 모듈을 등록해야 번들의 외부 import(`@fresnel/group-sdk` 등)가 풀린다. 로더가 같은 객체를 이미 등록했으면 아무 일도 하지 않는다
  const registered = registerSdkModules({ ...X_SDK_MODULES, "@fresnel/group-sdk": groupSdk });
  if (!registered.ok) {
    return err({
      kind: "io",
      message: `the SDK modules cannot be shared with the installed plugin (${registered.error.kind})`,
    });
  }
  const imported = await attemptAsync(async () => {
    const loaded: unknown = await import(pathToFileURL(real.value).href);
    return loaded;
  });
  if (!imported.ok) {
    return err({
      kind: "io",
      message: `entry ${declared} failed to import: ${messageOf(imported.error.cause)}`,
    });
  }
  const callable = callableEntryOf(imported.value);
  if (callable === undefined) {
    return err(invalid(`entry ${declared} exports neither a default nor an "extension" function`));
  }
  const entry: ExtensionEntry = async (host) => {
    await callable(host);
  };

  const group: groupSdk.GroupModule = {
    manifest: manifest.value,
    entry,
    stateUpcasters: [],
    stateVersion: 0,
  };
  const run = await attemptAsync(() =>
    replayDrive({ group, harness: createRuntimeReplayHarness(), maxCommits: input.maxCommits }),
  );
  if (!run.ok) {
    return err({
      kind: "io",
      message: `the replay of ${manifest.value.name} threw: ${messageOf(run.error.cause)}`,
    });
  }
  return ok(reportOf(run.value));
}
