import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, copyFile, chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { Bug, ok } from "@xeon/contracts";
import type { OsInfo } from "@xeon/contracts/services";
import { generateBinariesLock } from "../src/binaries/lock.ts";
import { createRipgrepSource } from "../src/binaries/rg.ts";
import { createBinaryResolver, createNodeBinaryFs } from "../src/binaries/resolve.ts";
import { createRunCommand } from "../src/proc.ts";
import { detectPlatform, readPlatformProbe } from "../src/select.ts";
import { tempDir, type TempDir } from "../src/testing/index.ts";
import { memoryLogger } from "./support/clock.ts";

// OS-11, M-04: 설치된 @vscode/ripgrep의 실제 rg로 소스 실행 경로와 목록 파일 경로를 확인한다. 네트워크는 쓰지 않는다.

const signal = new AbortController().signal;
let temp: TempDir | undefined;
afterEach(async () => {
  await temp?.remove();
  temp = undefined;
});

/** 이 호스트의 OsInfo. 플랫폼 이름은 select.ts의 탐지로만 읽는다 */
function hostInfo(): OsInfo {
  const detected = detectPlatform(readPlatformProbe());
  if (!detected.ok) throw new Bug("unsupported test host");
  return detected.value;
}

describe("@vscode/ripgrep", () => {
  test("the source run uses the package's rg and reads its version", async () => {
    const source = createRipgrepSource({ run: createRunCommand(), logger: memoryLogger().logger });
    const bundled = await source("rg", signal);
    expect(bundled.ok && bundled.value?.path).toBe(rgPath);
    expect(bundled.ok && bundled.value?.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("resolveBinary prefers the bundled rg over a system one", async () => {
    temp = await tempDir();
    const resolve = createBinaryResolver({
      info: hostInfo(),
      resourceDir: temp.path,
      pathEnv: "",
      fs: createNodeBinaryFs(),
      run: createRunCommand(),
      logger: memoryLogger().logger,
      lifetime: signal,
      bundledSource: createRipgrepSource({
        run: createRunCommand(),
        logger: memoryLogger().logger,
      }),
    });
    const resolved = await resolve("rg", {}, signal);
    expect(resolved.ok && resolved.value.source).toBe("bundled");
    expect(resolved.ok && resolved.value.path).toBe(rgPath);
  });

  test("a generated binaries.lock.json makes the copied rg resolve with a verified hash", async () => {
    temp = await tempDir();
    const info = hostInfo();
    await mkdir(join(temp.path, "bin"), { recursive: true });
    await copyFile(rgPath, join(temp.path, "bin", "rg"));
    await chmod(join(temp.path, "bin", "rg"), 0o755);
    const source = await createRipgrepSource({
      run: createRunCommand(),
      logger: memoryLogger().logger,
    })("rg", signal);
    if (!source.ok || source.value === undefined) throw new Error("no bundled rg");
    const lock = await generateBinariesLock(
      temp.path,
      [
        {
          name: "rg",
          platform: info.platform,
          arch: info.arch,
          path: "bin/rg",
          version: source.value.version,
        },
      ],
      createNodeBinaryFs(),
    );
    if (!lock.ok) throw new Error("lock failed");
    await writeFile(join(temp.path, "binaries.lock.json"), lock.value);
    const resolve = createBinaryResolver({
      info,
      resourceDir: temp.path,
      pathEnv: "",
      fs: createNodeBinaryFs(),
      run: createRunCommand(),
      logger: memoryLogger().logger,
      lifetime: signal,
    });
    expect(await resolve("rg", {}, signal)).toEqual(
      ok({
        name: "rg",
        path: join(temp.path, "bin", "rg"),
        version: source.value.version,
        source: "bundled",
      }),
    );
  });
});
