import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { LoaderFs } from "@xeon/contracts/extensions";
import type { PluginInstallFs } from "../../../src/loading-trust/index.ts";

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 실제 파일 시스템을 쓰는 LoaderFs. 없는 경로는 null이다 */
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

/** 실제 파일 시스템을 쓰는 PluginInstallFs */
export const realInstallFs: PluginInstallFs = {
  readText: (path) => realLoaderFs.readText(path),
  listDir: (path) => realLoaderFs.listDir(path),
  readBytes: async (path) => new Uint8Array(await readFile(path)),
  writeBytes: async (path, bytes) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  },
  makeDir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  removeDir: (path) => rm(path, { recursive: true, force: true }),
  rename: (from, to) => rename(from, to),
};

/** 시험마다 새 임시 디렉터리(`realpath`로 푼 경로)를 만든다. 호출자가 `cleanup`을 부른다 */
export async function makeTempDir(): Promise<{
  readonly dir: string;
  cleanup(): Promise<void>;
}> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "xeon-x1-")));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** 파일 하나를 쓴다. 부모 디렉터리는 만든다 */
export async function putFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
