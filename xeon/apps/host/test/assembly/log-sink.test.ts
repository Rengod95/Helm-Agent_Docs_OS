import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { createLateLogSink, LOG_FILE_MAX_BYTES } from "../../src/assembly/log-sink.ts";

// 늦은 연결 로그 싱크(assembly/log-sink.ts). attach 전의 줄은 모았다가 attach 때 쓰고, 파일은 상한을 넘으면 회전한다.
// 실제 임시 디렉터리의 파일로 본다.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "host-log-sink-"));
  dirs.push(dir);
  return dir;
}

/** 개행까지 64 KiB인 줄. 상한 5 MiB를 80줄로 채운다 */
const CHUNK_BYTES = 64 * 1024;
function chunkOf(digit: string): string {
  return digit.repeat(CHUNK_BYTES - 1);
}
const LINES_PER_FILE = LOG_FILE_MAX_BYTES / CHUNK_BYTES;

test("lines sent before attach are written when the file attaches, and later lines follow them", () => {
  const path = join(tempDir(), "logs", "service.log");
  const logs = createLateLogSink();
  logs.sink("first");
  logs.sink("second");
  expect(existsSync(path)).toEqual(false);

  logs.attach(path);
  expect(readFileSync(path, "utf8")).toEqual("first\nsecond\n");

  logs.sink("third");
  expect(readFileSync(path, "utf8")).toEqual("first\nsecond\nthird\n");
});

test("the log directory is made 0700 and the file is made 0600", () => {
  const root = tempDir();
  const path = join(root, "logs", "service.log");
  const logs = createLateLogSink();
  logs.attach(path);
  logs.sink("line");
  expect(statSync(join(root, "logs")).mode & 0o777).toEqual(0o700);
  expect(statSync(path).mode & 0o777).toEqual(0o600);
});

test("a line past the size cap moves the full file to <name>.1 and starts a new file", () => {
  const path = join(tempDir(), "logs", "service.log");
  const logs = createLateLogSink();
  logs.attach(path);
  for (let n = 0; n < LINES_PER_FILE; n += 1) logs.sink(chunkOf("a"));
  expect(statSync(path).size).toEqual(LOG_FILE_MAX_BYTES);

  logs.sink("after the rotation");
  expect(statSync(`${path}.1`).size).toEqual(LOG_FILE_MAX_BYTES);
  expect(readFileSync(path, "utf8")).toEqual("after the rotation\n");
});

test("rotation keeps the newest files only: the current file and two rotated copies", () => {
  const dir = join(tempDir(), "logs");
  const path = join(dir, "service.log");
  const logs = createLateLogSink();
  logs.attach(path);
  // 네 번 채우면 첫 번째 파일은 사라지고 현재 파일과 `.1`, `.2`만 남는다. 줄의 첫 글자로 어느 채움인지 표시한다
  for (const digit of ["1", "2", "3", "4"]) {
    for (let n = 0; n < LINES_PER_FILE; n += 1) logs.sink(chunkOf(digit));
  }
  expect(readdirSync(dir).toSorted()).toEqual(["service.log", "service.log.1", "service.log.2"]);
  expect(readFileSync(path, "utf8").charAt(0)).toEqual("4");
  expect(readFileSync(`${path}.1`, "utf8").charAt(0)).toEqual("3");
  expect(readFileSync(`${path}.2`, "utf8").charAt(0)).toEqual("2");
});

test("when the log directory cannot be made the sink is broken and later lines are dropped", () => {
  const root = tempDir();
  // logs 자리에 파일이 있어서 그 아래에 디렉터리를 만들 수 없다
  const blocker = join(root, "logs");
  writeFileSync(blocker, "not a directory");
  const path = join(blocker, "service.log");
  const logs = createLateLogSink();
  logs.sink("before");
  logs.attach(path);
  logs.sink("after");

  // 자리를 디렉터리로 바꿔도 깨진 싱크는 다시 쓰지 않는다
  rmSync(blocker);
  mkdirSync(blocker);
  logs.sink("later");
  expect(existsSync(path)).toEqual(false);
  expect(readdirSync(blocker)).toEqual([]);
});
