import { cp, mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { ok } from "@xeon/contracts";
import {
  createExtensionLoader,
  type ExtensionLoader,
  type LoaderFs,
  type LoaderPaths,
  type SdkModules,
} from "@xeon/ext-host";
import type { TestHost } from "@xeon/ext-host/testing";
import * as kit from "@xeon/group-kit";

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
const SDK_MODULES: SdkModules = { "@xeon/group-kit": kit };

export interface LoaderRig {
  readonly loader: ExtensionLoader;
  readonly paths: LoaderPaths;
}

/** 플러그인 산출물 디렉터리를 `<userDir>/extensions/helm`에 복사하고 그 위치를 보는 로더를 만든다 */
export async function loaderFor(
  t: TestHost,
  root: string,
  plugin: string | null,
): Promise<LoaderRig> {
  const paths: LoaderPaths = {
    userDir: join(root, "user"),
    managedDir: null,
    homeDir: join(root, "home"),
  };
  await mkdir(join(paths.userDir, "extensions"), { recursive: true });
  if (plugin !== null) {
    await cp(plugin, join(paths.userDir, "extensions", "helm"), { recursive: true });
  }
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
    sdkModules: SDK_MODULES,
  });
  return { loader, paths };
}
