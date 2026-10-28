import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { attemptAsync, parse, parseJson, type Logger } from "@xeon/contracts";
import type { AgentDefinition } from "@xeon/contracts/services";
import { parseDefinitionFile } from "@xeon/core-agents";
import { installDefaultPlugin, type PluginInstallFs } from "@xeon/ext-host";
import { Type } from "typebox";

// X.loading-trust.spec §4.4.7. 릴리즈에 든 기본 플러그인(Helm)을 첫 실행에 사용자 확장 위치로 복사한다. 조립 루트 코드(DR-14 예외 2).
// 사용자가 설치본을 지웠으면 다시 설치하지 않는다: 호스트 상태 파일(`<state>/default-plugins.json`)에 설치한 적이 있다는 표지를 남긴다.

/** 기본 플러그인 이름. 번들 디렉터리 `<defaultPluginsDir>/<name>/`이 설치 원본이다 */
export const DEFAULT_PLUGIN_NAMES: readonly string[] = ["helm"];

/** 표지 파일 이름. 호스트 상태 디렉터리(`OsDirs.state`) 아래에 둔다 */
export const DEFAULT_PLUGINS_MARKER_FILE = "default-plugins.json";

const MarkerSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  /** 이름 → 마지막으로 설치하거나 갱신한 번들 버전 */
  installed: Type.Record(Type.String(), Type.String()),
});

interface Marker {
  readonly schemaVersion: 1;
  readonly installed: Readonly<Record<string, string>>;
}

export type DefaultPluginOutcome =
  | {
      readonly name: string;
      readonly action: "installed" | "replaced" | "kept";
      readonly version: string;
    }
  /** 설치한 적이 있는데 디렉터리가 없다: 사용자가 지운 것이라 그대로 둔다 */
  | { readonly name: string; readonly action: "removed_by_user" }
  /** 번들 디렉터리가 없다(개발 실행) */
  | { readonly name: string; readonly action: "no_bundle" }
  | { readonly name: string; readonly action: "failed"; readonly message: string };

export interface DefaultPluginDeps {
  /** 번들 뿌리. 아래 `<name>/.xeon-plugin/plugin.json`이 있어야 한다 */
  readonly bundleDir: string;
  /** `<userDir>/extensions` 뿌리. 설치 대상은 그 아래 `<name>/`이다 */
  readonly extensionsDir: string;
  /** 표지 파일이 있는 호스트 상태 디렉터리 */
  readonly stateDir: string;
  /** 임시 복사 디렉터리 뿌리(탐색 밖). 생략하면 extensionsDir의 부모 아래 `.staging` */
  readonly stagingRoot?: string;
  readonly logger: Logger;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/** 실제 파일 시스템 위의 PluginInstallFs. 없는 경로는 null이다 */
const nodeInstallFs: PluginInstallFs = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (caught) {
      if (isMissing(caught)) return null;
      throw caught;
    }
  },
  async listDir(path) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "dir" : "file",
      }));
    } catch (caught) {
      if (isMissing(caught)) return null;
      throw caught;
    }
  },
  readBytes: async (path) => new Uint8Array(await readFile(path)),
  async writeBytes(path, bytes) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  },
  async makeDir(path) {
    await mkdir(path, { recursive: true });
  },
  async removeDir(path) {
    await rm(path, { recursive: true, force: true });
  },
  rename: (from, to) => rename(from, to),
};

async function readMarker(path: string, logger: Logger): Promise<Marker> {
  const text = await nodeInstallFs.readText(path);
  if (text === null) return { schemaVersion: 1, installed: {} };
  const json = parseJson(text);
  const checked = json.ok ? parse(MarkerSchema, json.value) : undefined;
  if (checked?.ok === true) return checked.value;
  // 손상된 표지는 비운 것으로 본다. 지운 설치본이 다시 깔릴 수 있어 경고를 남긴다
  logger.warn("default_plugins.marker_corrupt", { path });
  return { schemaVersion: 1, installed: {} };
}

async function writeMarker(path: string, marker: Marker): Promise<void> {
  const temp = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temp, `${JSON.stringify(marker, null, 2)}\n`);
  await rename(temp, path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (caught) {
    if (isMissing(caught)) return false;
    throw caught;
  }
}

async function installOne(
  name: string,
  deps: DefaultPluginDeps,
  marker: Marker,
): Promise<{ readonly outcome: DefaultPluginOutcome; readonly installedVersion?: string }> {
  const source = join(deps.bundleDir, name);
  const destination = join(deps.extensionsDir, name);
  if (!(await exists(source))) return { outcome: { name, action: "no_bundle" } };
  const before = marker.installed[name];
  // 갱신 도중 끊기면 대상이 없고 `.old`(이전 설치본)나 `.new`가 남는다. 사용자가 지운 것이 아니라 복구 대상이다
  const staging = deps.stagingRoot ?? join(dirname(dirname(destination)), ".staging");
  const interrupted =
    (await exists(join(staging, `${name}.old`))) || (await exists(join(staging, `${name}.new`)));
  if (before !== undefined && !interrupted && !(await exists(destination))) {
    return { outcome: { name, action: "removed_by_user" } };
  }
  const installed = await installDefaultPlugin({
    fs: nodeInstallFs,
    source,
    destination,
    ...(deps.stagingRoot === undefined ? {} : { stagingRoot: deps.stagingRoot }),
  });
  if (!installed.ok) {
    return {
      outcome: {
        name,
        action: "failed",
        message: `${installed.error.kind}: ${installed.error.message}`,
      },
    };
  }
  const { action, version } = installed.value;
  const installedVersion = action === "kept" ? installed.value.installedVersion : version;
  return { outcome: { name, action, version }, installedVersion };
}

/**
 * 기본 플러그인을 설치하거나 갱신한다. 실패해도 시작을 막지 않는다(결과로 알린다). 표지는 설치에 성공한 이름만 쓴다
 */
export async function installDefaultPlugins(
  deps: DefaultPluginDeps,
  names: readonly string[] = DEFAULT_PLUGIN_NAMES,
): Promise<readonly DefaultPluginOutcome[]> {
  const markerPath = join(deps.stateDir, DEFAULT_PLUGINS_MARKER_FILE);
  const marker = await readMarker(markerPath, deps.logger);
  const outcomes: DefaultPluginOutcome[] = [];
  let installed: Record<string, string> = { ...marker.installed };
  const run = async (index: number): Promise<void> => {
    const name = names[index];
    if (name === undefined) return;
    const result = await attemptAsync(() => installOne(name, deps, marker));
    if (!result.ok) {
      outcomes.push({
        name,
        action: "failed",
        message: result.error.cause instanceof Error ? result.error.cause.message : "install threw",
      });
    } else {
      outcomes.push(result.value.outcome);
      if (result.value.installedVersion !== undefined) {
        installed = { ...installed, [name]: result.value.installedVersion };
      }
    }
    await run(index + 1);
  };
  await run(0);
  if (JSON.stringify(installed) !== JSON.stringify(marker.installed)) {
    const saved = await attemptAsync(() =>
      writeMarker(markerPath, { schemaVersion: 1, installed }),
    );
    if (!saved.ok) deps.logger.warn("default_plugins.marker_write_failed", { path: markerPath });
  }
  for (const outcome of outcomes) {
    if (outcome.action === "failed") {
      deps.logger.warn("default_plugins.install_failed", {
        name: outcome.name,
        message: outcome.message,
      });
    }
  }
  return outcomes;
}

/**
 * 설치된 기본 플러그인이 낸 서브에이전트 정의(`<확장>/agents/*.md`, 매니페스트 `components.agents`). L1.agents는 확장 정의 적재를 아직
 * 받지 않아(L1.agents.spec §4.9 2차) 조립 루트가 읽어 `builtinDefinitions`에 더한다. 잘못된 파일은 그 정의만 빼고 경고한다
 */
export async function installedAgentDefinitions(
  extensionsDir: string,
  names: readonly string[],
  logger: Logger,
): Promise<readonly AgentDefinition[]> {
  const perPlugin = await Promise.all(
    names.map(async (name) => {
      const dir = join(extensionsDir, name, "agents");
      const entries = (await nodeInstallFs.listDir(dir)) ?? [];
      const files = entries.filter((entry) => entry.kind === "file" && entry.name.endsWith(".md"));
      return Promise.all(
        files.map(async (file): Promise<AgentDefinition | undefined> => {
          const path = join(dir, file.name);
          const text = await nodeInstallFs.readText(path);
          if (text === null) return undefined;
          const parsed = parseDefinitionFile(path, text, {
            kind: "extension",
            extension: name,
            path,
          });
          if ("diagnostic" in parsed) {
            logger.warn("default_plugins.agent_definition_invalid", {
              path,
              message: parsed.diagnostic.message,
            });
            return undefined;
          }
          return parsed.definition;
        }),
      );
    }),
  );
  return perPlugin.flat().flatMap((definition) => (definition === undefined ? [] : [definition]));
}
