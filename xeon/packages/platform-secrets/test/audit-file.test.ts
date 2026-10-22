import { afterEach, describe, expect, test } from "bun:test";
import { chmod, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import type { SecretAuditRecord } from "@xeon/contracts/capabilities";
import { auditFilePath, createAuditLog, parseAuditLine } from "../src/audit-file.ts";
import { manualClock } from "./support/clock.ts";
import { handleOf } from "./support/names.ts";
import { recordingLogger, tempDir, type TempDir } from "./support/os.ts";

// plan SC-09(M2), spec §3.9. 추가 전용, 기록마다 fsync, 0600, 보관 기간 정리.

const HANDLE = handleOf("github-token");
const DAY = 86_400_000;

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

async function harness(retentionDays = 90) {
  const dir = await tempDir();
  dirs.push(dir);
  const clock = manualClock();
  const logger = recordingLogger();
  const log = createAuditLog({
    configDir: dir.path,
    clock,
    logger,
    retentionDays: () => retentionDays,
  });
  return { dir, clock, logger, log, path: auditFilePath(dir.path) };
}

function used(at: number): SecretAuditRecord {
  return {
    type: "secret.used",
    handle: HANDLE,
    mode: "runtime-http",
    toolCallId: "call_1",
    threadId: "thr_1",
    host: "api.example.test",
    commandHash: null,
    decision: "allow",
    leaseId: "sls_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    at,
  };
}

function created(at: number): SecretAuditRecord {
  return { type: "secret.created", handle: HANDLE, fields: ["meta", "value"], actor: "human", at };
}

describe("audit file (spec §3.9)", () => {
  test("appends one JSON line per record in order and reads them back", async () => {
    const { log, path, clock } = await harness();
    log.record(used(clock.now()));
    expect((await log.appendDurable(created(clock.now() + 1))).ok).toBe(true);
    log.record(used(clock.now() + 2));
    const read = await log.read();
    expect(read.ok && read.value.map((r) => r.type)).toEqual([
      "secret.used",
      "secret.created",
      "secret.used",
    ]);
    const lines = (await readFile(path, "utf8")).split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => parseAuditLine(line) !== null)).toBe(true);
  });

  test("creates the file with mode 0600 and narrows a wider existing file", async () => {
    const { log, path, dir, clock } = await harness();
    await mkdir(`${dir.path}/secrets`, { recursive: true });
    await writeFile(path, "");
    await chmod(path, 0o644);
    expect((await log.appendDurable(created(clock.now()))).ok).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("creates the secrets directory private when it does not exist", async () => {
    const { log, dir, clock } = await harness();
    await log.appendDurable(created(clock.now()));
    expect((await stat(`${dir.path}/secrets`)).mode & 0o077).toBe(0);
  });

  test("never rewrites earlier lines when appending", async () => {
    const { log, path, clock } = await harness();
    await log.appendDurable(used(clock.now()));
    const first = await readFile(path, "utf8");
    await log.appendDurable(created(clock.now() + 1));
    const second = await readFile(path, "utf8");
    expect(second.startsWith(first)).toBe(true);
    expect(second.length).toBeGreaterThan(first.length);
  });

  test("skips lines it cannot parse and reports how many", async () => {
    const { log, path, dir, logger, clock } = await harness();
    await mkdir(`${dir.path}/secrets`, { recursive: true });
    await writeFile(path, `not json\n{"type":"secret.unknown","at":1}\n`);
    await log.appendDurable(used(clock.now()));
    const read = await log.read();
    expect(read.ok && read.value).toHaveLength(1);
    expect(logger.lines.some((l) => l.event === "secrets.audit.lines_skipped")).toBe(true);
  });

  test("a missing file reads as empty", async () => {
    const { log } = await harness();
    expect(await log.read()).toEqual({ ok: true, value: [] });
  });

  test("prunes records older than the retention period once, before the first write", async () => {
    const { log, path, dir, clock } = await harness(90);
    await mkdir(`${dir.path}/secrets`, { recursive: true });
    const old = used(clock.now() - 91 * DAY);
    const recent = used(clock.now() - 89 * DAY);
    await writeFile(path, `${JSON.stringify(old)}\n${JSON.stringify(recent)}\nbroken line\n`);
    await chmod(path, 0o644);
    await log.appendDurable(created(clock.now()));
    const text = await readFile(path, "utf8");
    expect(text.includes(JSON.stringify(old))).toBe(false);
    expect(text.includes(JSON.stringify(recent))).toBe(true);
    // 해석할 수 없는 줄은 날짜를 알 수 없어 지우지 않는다
    expect(text.includes("broken line")).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readdirNames(`${dir.path}/secrets`)).filter((n) => n.includes("prune"))).toEqual(
      [],
    );
  });

  test("a write failure is logged for record() and returned by appendDurable()", async () => {
    const { dir, logger, clock } = await harness();
    // secrets 자리에 일반 파일을 둬서 디렉터리를 만들 수 없게 한다
    await writeFile(`${dir.path}/secrets`, "not a directory");
    const log = createAuditLog({
      configDir: dir.path,
      clock,
      logger,
      retentionDays: () => 90,
    });
    log.record(used(clock.now()));
    await log.flush();
    expect(
      logger.lines.some((l) => l.level === "error" && l.event === "secrets.audit.write_failed"),
    ).toBe(true);
    const durable = await log.appendDurable(created(clock.now()));
    expect(durable.ok).toBe(false);
    if (!durable.ok) expect(durable.error.kind).toBe("audit_io");
  });
});

async function readdirNames(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return readdir(dir);
}
