import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { testGroup } from "../fixtures/test-group.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M4 wire(`m4/wire`): 실제 엔진이 자기 확장으로 확장 읽기 wire(`ext.*`, `hooks.list`, `group.*`)에 답한다. 원천 대역이 아니라
// 조립(`assemble.ts`)이 만든 `ExtReadSources`를 쓴다: 내장 단위, 사용자 위치의 외부 확장, 그룹 서비스, 운영 정책, 계측 버퍼.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const PROBE = "ext-probe";

function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

/**
 * `<config>/extensions/ext-probe`: `boundary.settle.after` 핸들러를 걸고 기능 `probe.cap`을 내며 `fail`이 참이면 핸들러가 던진다.
 * 루트가 아닌 플러그인 `idle`(같은 훅 선언)은 기본이 꺼짐이라 Registration은 있어도 핸들러가 레지스트리에 없다
 */
function writeProbe(home: EngineHome, fail: boolean): void {
  const root = join(home.root, "config", "extensions", PROBE);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name: PROBE,
      version: "1.0.0",
      entry: "./src/index.ts",
      plugins: [
        {
          layer: "plugin",
          hooks: ["boundary.settle.after"],
          provides: [{ id: "probe.cap", version: "1.0.0" }],
        },
        { id: "idle", layer: "plugin", hooks: ["boundary.settle.after"] },
      ],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `export const extension = ({ register }) => {
  register(${JSON.stringify(PROBE)}, {}, (g) => {
    g.on("boundary.settle.after", () => {
      ${fail ? 'throw new Error("probe handler failed");' : ""}
    });
  });
  register(${JSON.stringify(`${PROBE}/idle`)}, {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
};
`,
  );
}

async function startReal(options: {
  readonly fail: boolean;
  readonly safeMode?: boolean;
  /** 구동 그룹은 thread를 만들면 turn을 연다. 모델 테이프 답이 하나뿐인 시험은 그룹을 싣지 않는다 */
  readonly withGroup?: boolean;
}) {
  const home = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  writeProbe(home, options.fail);
  const group = testGroup(fixedIdFactory(9));
  const host = await startInProcessHost({
    devChecks: true,
    // 빈 번들 폴더: 기본 플러그인은 없고 로더가 사용자 위치의 확장을 싣는다
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "ext-read-bundles-")),
    extraPlugins: options.withGroup === false ? [] : [group.module],
    buildModels: answeringModels("ext-read-real", "done."),
    ...(options.safeMode === undefined ? {} : { safeMode: options.safeMode }),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return { home, host, connection, group };
}

/** 값이 조건을 만족할 때까지 다시 읽는다(최대 5초). 시간 안에 못 맞추면 마지막 값을 돌려준다 */
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  deadline = Date.now() + 5000,
): Promise<T> {
  const value = await read();
  if (done(value) || Date.now() > deadline) return value;
  await new Promise((resolve) => setTimeout(resolve, 50));
  return until(read, done, deadline);
}

realTest(
  "a real host lists its builtin units, the user extension and the group, and gets, binds and hooks them",
  async () => {
    const { home, host, connection, group } = await startReal({ fail: false });
    try {
      const groupId = group.module.manifest.name;
      const list = await connection.request("ext.list", {});
      const names = new Set(list.extensions.map((entry) => entry.name));
      expect(
        ["core-loop", "cap-work", "learning", groupId, PROBE].filter((name) => !names.has(name)),
      ).toEqual([]);
      const rows = new Map(list.extensions.map((entry) => [entry.name, entry]));
      expect(rows.get("core-loop")).toMatchObject({
        layer: "L1",
        isGroup: false,
        location: "builtin",
        origin: "builtin",
        tier: "builtin",
        effectiveGrade: "builtin",
        status: "enabled",
      });
      expect(rows.get(groupId)).toMatchObject({ isGroup: true, layer: "L3", status: "enabled" });
      expect(rows.get(PROBE)).toMatchObject({
        layer: "plugin",
        isGroup: false,
        tier: "user",
        requestedGrade: "user",
        effectiveGrade: "user",
        status: "enabled",
        enabledSource: "default",
        hookCount: 2,
        origin: "user",
        autoDisabled: false,
        safeModeExcluded: null,
        location: realpathSync(join(home.root, "config", "extensions", PROBE)),
      });

      const got = await connection.request("ext.get", { name: PROBE });
      expect(got.manifest.name).toBe(PROBE);
      expect(got.hooks).toEqual([
        {
          registrationId: PROBE,
          hook: "boundary.settle.after",
          budgetClass: "tap",
          budgetMs: 5000,
        },
        {
          registrationId: `${PROBE}/idle`,
          hook: "boundary.settle.after",
          budgetClass: "tap",
          budgetMs: 5000,
        },
      ]);
      expect(got.bindings).toEqual([
        {
          registrationId: PROBE,
          capability: "probe.cap",
          relation: "provides",
          peer: null,
          // 선언만 있고 setup이 `provide`를 부르지 않아 ExtHost는 이 기능을 바인딩하지 않았다
          satisfied: false,
        },
      ]);
      expect(await failureOf(connection.request("ext.get", { name: "no-such" }))).toMatchObject({
        code: 3401,
        data: { kind: "extension.notFound", details: { name: "no-such" } },
      });

      const bound = await connection.request("ext.bindings", {});
      const byCapability = new Map(bound.capabilities.map((row) => [row.capability, row]));
      expect(byCapability.get("probe.cap")).toMatchObject({ provider: null, unmet: false });
      expect(byCapability.get("dialog.ask")?.provider?.registrationId).toBe("cap-dialog");

      const hooks = await connection.request("hooks.list", {});
      const settle = hooks.hooks.find((row) => row.hook === "boundary.settle.after");
      expect(settle?.fold).toBe("tap");
      // 실제 등록: 핸들러가 있는 Registration이 디스패치 순서로 먼저, 꺼져 있어 핸들러가 없는 `ext-probe/idle`이 tier 없이 뒤에 온다
      expect(settle?.order).toEqual([
        { registrationId: PROBE, extension: PROBE, tier: 1, status: "enabled", error: null },
        {
          registrationId: "learning",
          extension: "learning",
          tier: 5,
          status: "enabled",
          error: null,
        },
        {
          registrationId: `${PROBE}/idle`,
          extension: PROBE,
          tier: null,
          status: "disabled",
          error: null,
        },
      ]);
      expect(settle?.registrations).toEqual(["ext-probe", "learning"]);
      expect(settle?.handlers).toBe(2);

      const health = await connection.request("ext.health", { name: PROBE });
      expect(health.health).toEqual([
        {
          name: PROBE,
          registrationId: PROBE,
          consecutiveFailures: 0,
          windowFailures: 0,
          windowCalls: 0,
          windowMs: 0,
          autoDisabled: false,
          lastFailureAt: null,
          lastError: null,
        },
      ]);
      expect(await connection.request("ext.reenable", { name: PROBE })).toEqual({
        appliesAt: "nextStepBoundary",
        diagnostics: [],
      });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "a real host reads per-thread status and the drive lock of the group, its metrics, and refuses unknown names and threads",
  async () => {
    const { home, host, connection, group } = await startReal({ fail: false });
    try {
      const groupId = group.module.manifest.name;
      const created = await connection.request("thread.create", {});
      // 임대는 경계 커밋 뒤에 보유자가 된다
      const lock = await until(
        () => connection.request("group.driveLock", { threadId: created.threadId }),
        (value) => value.holder !== null,
      );

      const scoped = await connection.request("ext.list", { threadId: created.threadId });
      const groupRow = scoped.extensions.find((entry) => entry.name === groupId);
      expect(groupRow?.plugins[0]).toMatchObject({ status: "enabled", thread: "enabled" });

      const groups = await connection.request("group.list", {});
      // 정렬은 holder가 먼저다: 이름순으로 맞춰 본다
      expect(
        groups.groups
          .map((row) => [row.id, row.usesDrive, row.scope])
          .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual([
        // 제작 그룹(`authoring`)은 내장이고 기본 꺼짐이다
        ["authoring", true, "disabled"],
        ["learning", false, "enabled"],
        [groupId, true, "enabled"],
      ]);

      expect(lock.holder).toBe(groupId);
      expect(lock.leaseEpoch).toBe(1);
      expect(lock.activeDriver).toBeNull();
      expect(lock.limits.turns).toBeGreaterThan(0);
      expect(lock.used).toEqual({
        turns: expect.any(Number),
        spawns: 0,
        tokens: expect.any(Number),
      });
      expect(lock.candidates).toEqual([]);
      expect(lock.lastRejected).toBeNull();

      const metrics = await connection.request("group.metrics", {
        id: groupId,
        threadId: created.threadId,
      });
      expect(metrics.id).toBe(groupId);
      expect(metrics.metrics?.leases).toBe(1);
      expect(metrics.sinceIgnoredBy).toEqual([]);
      // since 이전의 임대는 세지 않는다. 메모리 카운터 값은 since를 지키지 못한다고 밝힌다
      const later = await connection.request("group.metrics", {
        id: groupId,
        threadId: created.threadId,
        since: "2999-01-01T00:00:00.000Z",
      });
      expect(later.metrics?.leases).toBe(0);
      expect(later.metrics?.leaseMs).toBe(0);
      expect(later.sinceIgnoredBy).toContain("inputTokens");
      expect(later.sinceIgnoredBy).not.toContain("leases");
      expect(
        await connection.request("group.promotion", { threadIds: [created.threadId] }),
      ).toEqual({
        throughSeq: 0,
        threads: 0,
        candidates: [],
      });

      expect(await failureOf(connection.request("group.metrics", { id: "no-such" }))).toMatchObject(
        { code: 3402, data: { kind: "group.notFound", details: { id: "no-such" } } },
      );
      const ghost = "thr_00000000000000000000000000";
      expect(await failureOf(connection.request("ext.list", { threadId: ghost }))).toMatchObject({
        code: 3001,
      });
      // 로더가 실제로 다시 읽는다: 바뀐 것이 없어도 새 세대로 바꾸고 진단은 없다(자세한 시험은 ext-reload.int.test.ts)
      const reloaded = await connection.request("ext.reload", { name: PROBE });
      expect(reloaded.diagnostics).toEqual([]);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "a handler that throws lands in the failure ledger and the timing buffer, and ext.health and ext.timings report it",
  async () => {
    const { home, host, connection } = await startReal({ fail: true, withGroup: false });
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    try {
      const created = await connection.request("thread.create", {});
      await connection.request("turn.start", { threadId: created.threadId, input: "질문" });
      await collector.waitFor((event) => event.kind === "turn.completed");

      // 경계 정산(`boundary.settle.after`)은 turn.completed 뒤에 돈다: 장부에 실패가 오를 때까지 읽는다(최대 5초)
      const health = await until(
        () => connection.request("ext.health", { name: PROBE }),
        (value) => value.health[0]?.windowFailures !== 0,
      );
      const row = health.health[0];
      expect(row?.windowFailures).toBeGreaterThanOrEqual(1);
      // 창은 호출 수이고 창이 덮는 시간은 가장 오래된 호출부터 지금까지다
      expect(row?.windowCalls).toBeGreaterThanOrEqual(1);
      expect(row?.windowMs).toBeGreaterThan(0);
      expect(row?.consecutiveFailures).toBeGreaterThanOrEqual(1);
      expect(row?.lastError).toContain("probe handler failed");
      expect(typeof row?.lastFailureAt).toBe("string");

      const timings = await connection.request("ext.timings", { name: PROBE });
      expect(timings.traceEnabled).toBe(true);
      expect(timings.timings.map((timing) => [timing.hook, timing.registrationId])).toEqual([
        ["boundary.settle.after", PROBE],
      ]);
      expect(timings.timings[0]?.failures).toBeGreaterThanOrEqual(1);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "in safe mode the user extension is listed as excluded, and ext.reenable and ext.reload are refused",
  async () => {
    const { home, host, connection } = await startReal({ fail: false, safeMode: true });
    try {
      const list = await connection.request("ext.list", {});
      const probe = list.extensions.find((entry) => entry.name === PROBE);
      expect(probe).toMatchObject({ status: "disabled", safeModeExcluded: "flag" });
      expect(
        list.extensions.find((entry) => entry.name === "core-loop")?.safeModeExcluded,
      ).toBeNull();
      const refusals = await Promise.all(
        (["ext.reenable", "ext.reload"] as const).map((method) =>
          failureOf(connection.request(method, { name: PROBE })),
        ),
      );
      for (const refusal of refusals) {
        expect(refusal).toMatchObject({ code: 3403, data: { kind: "extension.safeModeActive" } });
      }
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
