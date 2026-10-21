import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { LeaseToken } from "@xeon/contracts/records";
import { openStore } from "../../src/index.ts";
import { DEFAULT_STORE_SETTINGS } from "../../src/settings.ts";
import { toStorePlatform } from "../../src/select.ts";
import { fixedIdFactory } from "../support/clock.ts";

/** 자식이 명령마다 한 줄 JSON으로 답하는 값 */
export interface ChildReply {
  readonly ok?: boolean;
  readonly epoch?: number;
  readonly kind?: string;
  readonly reason?: string | null;
  readonly holds?: boolean;
  readonly committed?: boolean;
}

// 인자: <db 경로> <native|win32> <leaseTtlMs>
// 표준 입력 명령: acquire <resource> <holderId> | renew | holds | commit | exit
const [dbPath, mode, ttl] = process.argv.slice(2);
const native = toStorePlatform(process.platform);
if (dbPath === undefined || native === undefined || ttl === undefined) process.exit(2);

/** Linux /proc/<pid>/stat의 starttime. 프로세스가 없으면 null (OS 잠금이 없을 때의 생존 판정에 쓴다) */
function startFingerprint(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return Number(fields[19]);
  } catch {
    return null;
  }
}

const clock = { now: () => Date.now() };
const opened = await openStore({
  dbPath,
  env: {
    platform: mode === "win32" ? "win32" : native,
    wsl: false,
    dbDirFsKind: "local",
    bundledSqlitePath: null,
    machineId: "test-machine",
    processStartedAt: startFingerprint,
  },
  clock,
  scheduler: { setTimeout: () => 0, clearTimeout: () => {} },
  ids: fixedIdFactory(clock, `child-${process.pid}`),
  settings: { ...DEFAULT_STORE_SETTINGS, leaseTtlMs: Number(ttl) },
  engineVersion: "0.0.0-child",
});
if (!opened.ok) {
  process.stdout.write(`OPEN_FAILED ${opened.error.kind}\n`);
  process.exit(3);
}
const store = opened.value;
let token: LeaseToken | undefined;
const say = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};
process.stdout.write("READY\n");

for await (const line of createInterface({ input: process.stdin })) {
  const [command, resource, holderId] = line.trim().split(" ");
  if (command === "acquire" && resource !== undefined && holderId !== undefined) {
    const result = store.service.leases.acquire(resource, {
      holderId,
      kind: "cli",
      pid: process.pid,
      startedAt: startFingerprint(process.pid) ?? 0,
      host: "test-machine",
    });
    if (result.ok) {
      token = result.value;
      say({ ok: true, epoch: result.value.epoch });
    } else {
      say({
        ok: false,
        kind: result.error.kind,
        reason: "reason" in result.error ? result.error.reason : null,
      });
    }
  } else if (command === "renew" && token !== undefined) {
    const renewed = store.service.leases.renew(token);
    say(renewed.ok ? { ok: true } : { ok: false, kind: renewed.error.kind });
  } else if (command === "holds" && token !== undefined) {
    const current = token;
    const held = store.root.write((tx) => store.service.leases.holds(tx, current));
    say({ holds: held.ok && held.value });
  } else if (command === "commit" && token !== undefined) {
    const current = token;
    const written = store.root.write((tx) => {
      if (!store.service.leases.holds(tx, current)) return false;
      tx.run("INSERT INTO t_commit (writer) VALUES (?)", [current.holderId]);
      return true;
    });
    say({ committed: written.ok && written.value });
  } else if (command === "exit") {
    await store.close();
    process.exit(0);
  } else {
    say({ error: "unknown command", line });
  }
}
