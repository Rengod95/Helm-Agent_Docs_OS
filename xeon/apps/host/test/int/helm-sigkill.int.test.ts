import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Type } from "typebox";
import { parse } from "@xeon/contracts";
import { dedupeInquiryFinished } from "@xeon/group-helm";
import { buildHelmPlugin } from "@xeon/group-helm/build";
import { tapeBuildModels, tapeProvider } from "@xeon/core-models/testing";
import type { EventWire } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { createStdioTransport } from "../../src/transport/stdio.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { helmResumeTape } from "../fixtures/helm-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M3b B4-GRP 시험(carry-over "SIGKILL child process failure test"). 실제 엔진(SQLite)과 실제 Helm 묶음으로 조사를 시작하고,
// 자식 호스트를 탐색 단계 한가운데에서 SIGKILL로 죽인 뒤 같은 저장소에 새 호스트를 올려 이어 가게 한다.
// 확인: 재개 뒤 종료 기록은 inquiryId로 중복 제거하면 하나, 적용 turn은 하나, 렌즈 탐색 요청 id는 각각 한 번씩이다.
// 자식과 대본은 fixtures/helm-crash-host.ts와 fixtures/helm-tape.ts다. 이 시험은 realEngineGate로 막는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const CRASH_HOST: string = join(import.meta.dir, "..", "fixtures", "helm-crash-host.ts");
const LENS_SPAWNS: readonly string[] = [
  "spawn:1:analogy",
  "spawn:1:first-principles",
  "spawn:1:prior-art",
];

let bundleRoot: string;

beforeAll(async () => {
  bundleRoot = mkdtempSync(join(tmpdir(), "helm-sigkill-bundle-"));
  const built = await buildHelmPlugin(join(bundleRoot, "helm"));
  if (!built.ok) throw new Error(`plugin build failed: ${built.error.kind}`);
}, 60_000);

afterAll(() => {
  rmSync(bundleRoot, { recursive: true, force: true });
});

/** 이벤트 payload 같은 경계 값은 객체인지 검증한 뒤 읽는다(TY-10). 객체가 아니면 undefined다 */
const FIELDS = Type.Record(Type.String(), Type.Unknown());

/** 이벤트 payload의 경로 값. 중간에 객체가 아닌 값이 있거나 경로가 없으면 undefined다 */
function valueAt(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const fields = parse(FIELDS, current);
    if (!fields.ok) return undefined;
    current = fields.value[key];
  }
  return current;
}

function stringAt(event: EventWire, path: readonly string[]): string | undefined {
  const value = valueAt(event.payload, path);
  return typeof value === "string" ? value : undefined;
}

/** 렌즈 탐색 요청 id를 `spawn:<라운드>:<렌즈>` 꼴로 줄인다(service의 spawnRequestId와 같은 조합) */
function lensSpawnOf(event: EventWire): string | undefined {
  const requestId = stringAt(event, ["requestId"]);
  if (requestId === undefined || !requestId.includes(":spawn:")) return undefined;
  return requestId.split(":").slice(2).join(":");
}

function spawnedOf(events: readonly EventWire[]): EventWire[] {
  return events.filter((event) => event.kind === "agent.spawned");
}

realTest(
  "a Helm inquiry killed with SIGKILL during lens exploration resumes in a new host: one finished record, one apply turn, each lens spawn once",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = mkdtempSync(join(tmpdir(), "xh-helm-kill-"));
    const previousCwd = process.cwd();
    const child = Bun.spawn([process.execPath, CRASH_HOST], {
      cwd: workspace,
      env: { ...process.env, XEON_HOME: home.root, XEON_TEST_HELM_BUNDLE: bundleRoot },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    let errorText = "";
    const decoder = new TextDecoder();
    const reading = (async () => {
      for await (const chunk of child.stderr) errorText += decoder.decode(chunk, { stream: true });
    })();
    try {
      // ── 1. 자식 호스트: /helm start 뒤 렌즈 탐색 두 개가 올라올 때까지 ─────────
      const first = createHostConnection(
        createStdioTransport({
          readable: child.stdout,
          writable: new WritableStream<Uint8Array>({
            async write(chunk) {
              await child.stdin.write(chunk);
              await child.stdin.flush();
            },
          }),
        }),
      );
      await first.request("host.hello", HELLO_PARAMS);
      const seen = collectEvents(first);
      await first.request("events.subscribe", { from: "head" });
      const created = await first.request("thread.create", {});
      const started = await first.request("command.run", {
        threadId: created.threadId,
        text: "/helm start 캐시 무효화",
      });
      expect(started).toMatchObject({ status: "done", name: "helm" });
      await seen.waitFor(() => spawnedOf(seen.events).length >= 2, 60_000);
      // 네 번째 모델 호출이 붙잡혀 있어 조사는 끝나지 않았다
      expect(seen.events.filter((event) => event.kind === "grp.helm.inquiry.finished")).toEqual([]);

      // ── 2. SIGKILL ─────────────────────────────────────────────────────
      child.kill("SIGKILL");
      await child.exited;
      expect(child.signalCode).toBe("SIGKILL");
      await reading;
      expect(errorText).not.toContain("helm-crash-host:");

      // ── 3. 새 호스트: 같은 저장소, 같은 Helm 묶음 ─────────────────────────────
      process.chdir(workspace);
      const host = await startInProcessHost({
        devChecks: true,
        defaultPluginsDir: bundleRoot,
        buildModels: tapeBuildModels(tapeProvider(helmResumeTape("helm-sigkill-resume"))),
      });
      const connection = createHostConnection(host.client);
      const hello = await connection.request("host.hello", HELLO_PARAMS);
      const collected = collectEvents(connection);
      // 저장소의 처음부터 받는다: 죽기 전에 쓴 기록도 이 호스트의 구독으로 다시 읽힌다
      await connection.request("events.subscribe", {
        from: { storeId: hello.storeId, seq: 0 },
        filter: { threadIds: [created.threadId] },
      });
      // 세션 시작: 쓰기 소유를 얻으면 열린 임대가 있는 탐구의 drive가 다시 불린다(L3.helm.spec §4.9)
      await connection.request("thread.open", { threadId: created.threadId, mode: "write" });
      await collected.waitFor((event) => event.kind === "grp.helm.inquiry.finished", 90_000);

      // 종료 기록: 중복 제거(L3.helm.spec §4.8)하면 조사 하나에 하나다. 모든 기록에 inquiryId가 있어야 묶을 수 있다
      const finished = collected.events.filter(
        (event) => event.kind === "grp.helm.inquiry.finished",
      );
      const inquiryIds = finished.map((event) => stringAt(event, ["payload", "inquiryId"]));
      expect(inquiryIds.every((id) => id !== undefined)).toBe(true);
      const inquiries = dedupeInquiryFinished(inquiryIds.map((id) => ({ inquiryId: id ?? null })));
      expect(inquiries).toHaveLength(1);

      // 렌즈 탐색 요청은 세 렌즈마다 정확히 한 번씩 기록된다
      const lensSpawns = spawnedOf(collected.events).map(lensSpawnOf);
      expect(lensSpawns.every((id) => id !== undefined)).toBe(true);
      expect(lensSpawns.toSorted((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual([
        ...LENS_SPAWNS,
      ]);

      // 적용 turn은 한 번이다
      const applyTurns = collected.events.filter(
        (event) =>
          event.kind === "turn.started" &&
          event.threadId === created.threadId &&
          JSON.stringify(event.payload).includes(":turn:apply:"),
      );
      expect(applyTurns).toHaveLength(1);

      await connection.close();
      await host.close();
    } finally {
      child.kill("SIGKILL");
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  180_000,
);
