import { cp, mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { ok } from "@fresnel/contracts";
import {
  createExtensionLoader,
  type ExtensionLoader,
  type LoaderFs,
  type LoaderPaths,
  type LoaderSettingsSource,
  type SdkModules,
} from "@fresnel/ext-host";
import type { TestHost } from "@fresnel/ext-host/testing";
import * as kit from "@fresnel/orchestration-sdk";

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 실제 파일 시스템을 읽는 LoaderFs. 없는 경로는 null이다 */
const realLoaderFs: LoaderFs = {
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
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch (caught) {
      if (isMissing(caught)) return false;
      throw caught;
    }
  },
  realpath: (path) => realpath(path),
};

/** X가 직접 등록하지 못하는 L3 모듈만 호스트가 넘긴다(X.loading-trust.spec §4.4.6) */
const SDK_MODULES: SdkModules = { "@fresnel/orchestration-sdk": kit };

export interface LoaderRig {
  readonly loader: ExtensionLoader;
  readonly paths: LoaderPaths;
}

/**
 * 플러그인 산출물 디렉터리를 `<userDir>/extensions/provider-anthropic-oauth`에 복사하고 그 위치를 보는 로더를 만든다.
 * `userEnabled`는 `ext.<이름>.enabled` 값이다. 거짓이면 관리 잠금처럼 로더가 플러그인을 싣지 않는다(켜짐은 대화별 E(T)가 정하고 로더는 잠금만 본다, M5c §4.1.11)
 */
export async function loaderFor(
  t: TestHost,
  root: string,
  plugin: string,
  options: { readonly userEnabled: boolean },
): Promise<LoaderRig> {
  const settings: LoaderSettingsSource = {
    enabled: (name) => (name === "provider-anthropic-oauth" ? options.userEnabled : undefined),
    hasValue: () => false,
  };
  const paths: LoaderPaths = {
    userDir: join(root, "user"),
    managedDir: null,
    homeDir: join(root, "home"),
  };
  await mkdir(join(paths.userDir, "extensions"), { recursive: true });
  await cp(plugin, join(paths.userDir, "extensions", "provider-anthropic-oauth"), {
    recursive: true,
  });
  const loader = createExtensionLoader({
    host: t.host,
    policy: { admit: () => ok("user"), forget: () => {} },
    fs: realLoaderFs,
    paths,
    trustBackend: {
      read: () => Promise.resolve({ ok: true, text: null }),
      update: () => Promise.resolve(),
    },
    clock: { now: t.timers.now },
    settings,
    sdkModules: SDK_MODULES,
  });
  return { loader, paths };
}
