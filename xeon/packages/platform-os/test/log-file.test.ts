import { afterEach, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import {
  createRotatingFileSink,
  DEFAULT_LOG_MAX_BYTES,
  DEFAULT_LOG_MAX_FILES,
} from "../src/log-file.ts";
import { tempDir, type TempDir } from "../src/testing/index.ts";

let temp: TempDir | undefined;
afterEach(async () => {
  await temp?.remove();
  temp = undefined;
});

test("rotation defaults are 10 MiB per file and 5 files", () => {
  expect(DEFAULT_LOG_MAX_BYTES).toBe(10 * 1024 * 1024);
  expect(DEFAULT_LOG_MAX_FILES).toBe(5);
});

test("a full file rotates to .1 and only maxFiles files are kept", async () => {
  temp = await tempDir();
  const dir = temp.join("logs");
  const sink = createRotatingFileSink({ dir, fileName: "t.log", maxBytes: 10, maxFiles: 3 });
  // 줄마다 5바이트("aaaa\n"): 한 파일에 두 줄
  for (const line of ["aaaa", "bbbb", "cccc", "dddd", "eeee", "ffff", "gggg"]) sink(line);
  expect((await readdir(dir)).toSorted()).toEqual(["t.log", "t.log.1", "t.log.2"]);
  expect(await readFile(`${dir}/t.log`, "utf8")).toBe("gggg\n");
  expect(await readFile(`${dir}/t.log.1`, "utf8")).toBe("eeee\nffff\n");
  expect(await readFile(`${dir}/t.log.2`, "utf8")).toBe("cccc\ndddd\n");
  expect((await stat(`${dir}/t.log`)).mode & 0o777).toBe(0o600);
});

test("a write failure is reported with the errno code and does not throw", async () => {
  const codes: string[] = [];
  // /proc 아래에는 디렉터리를 만들 수 없어 mkdir과 append가 실패한다
  const sink = createRotatingFileSink({
    dir: "/proc/xeon-no-such/logs",
    onError: (code) => codes.push(code),
  });
  sink("x");
  expect(codes.length).toBeGreaterThan(0);
});
