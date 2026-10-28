import { cp, mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { ok } from "@xeon/contracts";
import * as contracts from "@xeon/contracts";
import * as capabilities from "@xeon/contracts/capabilities";
import * as conversation from "@xeon/contracts/conversation";
import * as extensions from "@xeon/contracts/extensions";
import * as settings from "@xeon/contracts/settings";
import {
  createExtensionLoader,
  type ExtensionLoader,
  type LoaderFs,
  type LoaderPaths,
  type SdkModules,
} from "@xeon/ext-host";
import type { TestHost } from "@xeon/ext-host/testing";
import * as kit from "@xeon/group-kit";
import * as typebox from "typebox";

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 실제 파일 시스템을 읽는 LoaderFs. 없는 경로는 null이다 */
export const realLoaderFs: LoaderFs = {
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

/**
 * 번들이 외부 import로 남기는 지정자에 호스트의 모듈 객체를 대응시킨다. X는 세 지정자만 정하지만(SDK_MODULE_SPECIFIERS)
 * Helm 번들은 `@xeon/contracts` 하위 경로도 import하므로 호스트가 그 경로도 같은 인스턴스로 등록해야 한다
 */
export const SDK_MODULES: SdkModules = {
  "@xeon/contracts": contracts,
  "@xeon/contracts/capabilities": capabilities,
  "@xeon/contracts/conversation": conversation,
  "@xeon/contracts/extensions": extensions,
  "@xeon/contracts/settings": settings,
  "@xeon/group-kit": kit,
  typebox,
};

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
