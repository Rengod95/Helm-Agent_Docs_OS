import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { attempt, parse, repeatAsync } from "@fresnel/contracts";
import { LeaseAcquiredPayloadSchema, LeaseReleasedPayloadSchema } from "@fresnel/contracts/records";
import type { EventWire } from "@fresnel/contracts/wire";
import type { PluginHostSupervisor } from "@fresnel/ext-host";
import { HelmStateSchema } from "@fresnel/group-helm";
import { buildHelmPlugin } from "@fresnel/group-helm/build";
import { tapeBuildModels, tapeProvider } from "@fresnel/core-models/testing";
import { Type } from "typebox";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { isolatedPluginHost } from "../fixtures/isolated-plugin-host.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { helmDivergeTape } from "../fixtures/helm-tape.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startInputWhenIdle, until } from "../fixtures/wire-client.ts";

// L4.host-service.spec §4.9, L3.helm.spec §4.9. 기본 설정의 Helm(번들, 사용자 등급)은 격리 자식(플러그인 호스트 프로세스)에서 돈다.
// (a) 자식이 떠 있고 엔진과 다른 프로세스다. (b) `/helm start`의 주도 단계는 `drive.step` 요청으로 돌고 임대 기록이 순서대로 남는다.
// (d) `/helm plugin`의 맡기기(Helm 격리 → 빌더 엔진 안 → Helm 격리)는 엔진 안 Helm과 같은 기록과 상태를 낸다.
// (c) v1 문서 이전은 v1 Helm 묶음이 없어 이 파일에서 시험하지 않는다(보고서에 적는다).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const HELM = "helm";
const LEASE_KINDS: ReadonlySet<string> = new Set([
  "lease.acquired",
  "drive.command_settled",
  "lease.released",
]);
/** `/helm start` 한 번의 `drive.step` 요청 수. 대본 `helmDivergeTape`가 정한 값이다 */
const DRIVE_STEP_REQUESTS = 6;

let bundleRoot: string;

beforeAll(async () => {
  bundleRoot = mkdtempSync(join(tmpdir(), "helm-isolated-bundle-"));
  const built = await buildHelmPlugin(join(bundleRoot, "helm"));
  if (!built.ok) throw new Error(`plugin build failed: ${built.error.kind}`);
}, 60_000);

afterAll(() => {
  rmSync(bundleRoot, { recursive: true, force: true });
});

/** 프로세스가 살아 있는가. 신호 0은 존재만 본다 */
function alive(pid: number): boolean {
  return attempt(() => {
    process.kill(pid, 0);
  }).ok;
}

/** 연속으로 같은 값은 하나로 줄인다. 순서만 본다 */
function collapse(values: readonly string[]): string[] {
  return values.filter((value, index) => value !== values[index - 1]);
}

/** 감독자의 `call`을 감싸 보낸 요청 이름을 센다. 감독자 메서드는 `this`를 쓰지 않으므로 바꿔 끼워도 된다 */
function recordRequests(supervisor: PluginHostSupervisor, methods: string[]): void {
  const call = supervisor.call.bind(supervisor);
  supervisor.call = (method, params, options) => {
    methods.push(method);
    return call(method, params, options);
  };
}

const CommittedSchema = Type.Object({ doc: Type.Unknown() });
const NoticeSchema = Type.Object({ item: Type.Object({ content: Type.String() }) });

function leaseAcquiredOf(event: EventWire) {
  const checked = parse(LeaseAcquiredPayloadSchema, event.payload);
  return checked.ok ? checked.value : undefined;
}

function leaseReleasedOf(event: EventWire) {
  const checked = parse(LeaseReleasedPayloadSchema, event.payload);
  return checked.ok ? checked.value : undefined;
}

// 격리 플러그인은 검토본 사본(`<data>/plugin-store/reviewed/<이름>/<해시>/tree`)에서 뜬다. 그 경로는 보호된 데이터 폴더 안이라 읽기 허용 목록이
// 보호 경로와 겹쳐 빠지면 호스트가 자기 코드를 읽지 못한다(enSec 한계). 실제 샌드박스(macOS)에서 실제로 뜨는지 본다.
const realSandboxTest = process.platform === "darwin" ? realTest : test.skip;
realSandboxTest(
  "under the real sandbox the bundled Helm still starts from its reviewed copy in the data folder",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    let isolation: string | undefined;
    let root: string | undefined;
    const host = await startInProcessHost({
      devChecks: true,
      defaultPluginsDir: bundleRoot,
      buildModels: tapeBuildModels(tapeProvider(helmDivergeTape("helm-isolated-real-sandbox"))),
      pluginHost: {
        ...isolatedPluginHost({ realSandbox: true }),
        onLoadReport: (report) => {
          const found = report.extensions.find((entry) => entry.name === HELM);
          isolation = found?.isolation;
          root = found?.root;
        },
      },
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      expect(isolation).toBe("process");
      expect(root?.includes("/plugin-store/reviewed/helm/")).toBe(true);
    } finally {
      await connection.close();
      await host.close();
    }
  },
  60_000,
);

realTest(
  "the bundled Helm runs in its own process: the process is alive and not the engine, and /helm start drives through drive.step requests",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const supervisors: PluginHostSupervisor[] = [];
    const requests: string[] = [];
    let isolation: string | undefined;
    const host = await startInProcessHost({
      devChecks: true,
      defaultPluginsDir: bundleRoot,
      buildModels: tapeBuildModels(tapeProvider(helmDivergeTape("helm-isolated-start"))),
      pluginHost: {
        ...isolatedPluginHost(),
        onLoadReport: (report) => {
          isolation = report.extensions.find((entry) => entry.name === HELM)?.isolation;
        },
        onSupervisor: (name, supervisor) => {
          if (name !== HELM) return;
          supervisors.push(supervisor);
          recordRequests(supervisor, requests);
        },
      },
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      expect(isolation).toBe("process");
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      const started = await connection.request("command.run", {
        threadId: created.threadId,
        text: "/helm start 캐시 무효화",
      });
      expect(started).toMatchObject({ status: "done", name: HELM });
      const finished = await collector.waitFor(
        (event) => event.kind === "grp.helm.inquiry.finished",
        60_000,
      );
      expect(finished.payload).toMatchObject({
        payload: { outcome: "applied", lensCount: 3, failedLenses: 0, findingCount: 3 },
      });
      await collector.waitFor((event) => event.kind === "lease.released", 30_000);

      // (a) 자식 프로세스가 떠 있고 번호가 엔진과 다르다
      expect(supervisors).toHaveLength(1);
      const status = supervisors[0]?.status();
      expect(status?.state).toBe("running");
      const pid = status?.pid ?? null;
      expect(pid).not.toBeNull();
      expect(pid).not.toBe(process.pid);
      expect(pid === null ? false : alive(pid)).toBe(true);

      // (b) 주도 단계는 `drive.step` 요청으로 돈다. 명령마다 임대 기록이 쌓이고 순서는 획득, 명령 정산, 반납이다
      expect(requests.filter((method) => method === "drive.step")).toHaveLength(
        DRIVE_STEP_REQUESTS,
      );
      const leaseKinds = collector.events
        .map((event) => event.kind)
        .filter((kind) => LEASE_KINDS.has(kind));
      expect(collapse(leaseKinds)).toEqual([
        "lease.acquired",
        "drive.command_settled",
        "lease.released",
      ]);
      expect(collector.events.filter((event) => event.kind === "lease.released")).toHaveLength(1);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  90_000,
);

realTest(
  "a profile whose start drive is Helm starts the isolated Helm: the lease is granted to helm and drive.step requests reach the child",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const requests: string[] = [];
    let isolation: string | undefined;
    const host = await startInProcessHost({
      devChecks: true,
      defaultPluginsDir: bundleRoot,
      buildModels: answeringModels("helm-profile-start", "done."),
      pluginHost: {
        ...isolatedPluginHost(),
        onLoadReport: (report) => {
          isolation = report.extensions.find((entry) => entry.name === HELM)?.isolation;
        },
        onSupervisor: (name, supervisor) => {
          if (name === HELM) recordRequests(supervisor, requests);
        },
      },
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      expect(isolation).toBe("process");
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      await connection.request("profile.put", {
        profile: {
          id: "helm-start",
          title: "helm-start",
          plugins: [{ name: HELM }],
          settings: [],
          startDrive: HELM,
        },
        baseRev: null,
      });
      const created = await connection.request("thread.create", { profileId: "helm-start" });
      const granted = await collector.waitFor((event) => event.kind === "lease.acquired", 30_000);
      expect(leaseAcquiredOf(granted)).toMatchObject({ scopeId: HELM, depth: 0 });
      // 프로필의 시작 주도는 사용자의 첫 메시지를 첫 단계의 입력으로 받는다(AGE-47): 메시지가 오기 전에는 단계 요청이 없다
      expect(requests.filter((method) => method === "drive.step")).toEqual([]);
      await startInputWhenIdle(connection, {
        threadId: created.threadId,
        input: "캐시 구조를 살펴봐 줘",
      });
      expect(await until(() => requests.includes("drive.step"), 30_000)).toBe(true);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  90_000,
);

/** 맡기기 한 번을 돌려 기록을 값으로 돌려준다. 격리면 Helm이 자식에서 돈다, 아니면 엔진 안에서 돈다 */
async function handoffRecord(isolated: boolean) {
  const home = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  const host = await startInProcessHost({
    devChecks: true,
    defaultPluginsDir: bundleRoot,
    buildModels: answeringModels("helm-handoff", "done."),
    pluginHost: isolated ? isolatedPluginHost() : { disabled: true },
  });
  const connection = createHostConnection(host.client);
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    const reply = await connection.request("command.run", {
      threadId: created.threadId,
      text: "/helm plugin 로그 정리 도구",
    });
    expect(JSON.stringify(reply)).toContain("로그 정리 도구");
    // 빌더가 맡은 일을 끝내고 Helm이 결과를 알리고 임대를 반납할 때까지
    await collector.waitFor(
      (event) =>
        event.kind === "lease.released" &&
        collector.events.filter((e) => e.kind === "lease.released").length >= 2,
      60_000,
    );
    const acquired = collector.events
      .filter((event) => event.kind === "lease.acquired")
      .map(leaseAcquiredOf);
    const helm = acquired[0];
    const released = collector.events
      .filter((event) => event.kind === "lease.released")
      .map(leaseReleasedOf);
    const notices = collector.events.flatMap((event) => {
      if (event.kind !== "input.queued") return [];
      const checked = parse(NoticeSchema, event.payload);
      return checked.ok ? [checked.value.item.content] : [];
    });
    const stateEvents = collector.events.filter(
      (event) => event.kind === "grp.helm.state.committed",
    );
    const lastDoc = stateEvents.at(-1);
    const checkedDoc = lastDoc === undefined ? undefined : parse(CommittedSchema, lastDoc.payload);
    const docValue = checkedDoc?.ok ? checkedDoc.value.doc : undefined;
    const checkedState = parse(HelmStateSchema, docValue);
    return {
      leases: acquired.map((entry) =>
        entry === undefined
          ? null
          : [
              entry.scopeId,
              entry.depth ?? null,
              entry.parent !== undefined && entry.parent === helm?.leaseId,
            ],
      ),
      released: released.map((entry) =>
        entry === undefined ? null : [entry.scopeId, entry.reason],
      ),
      notices: notices.filter((text) => text.includes("[authoring]") || text.includes("받았어요")),
      state: checkedState.ok
        ? { phase: checkedState.value.phase, pluginNeed: checkedState.value.pluginNeed }
        : null,
    };
  } finally {
    await connection.close();
    await host.close();
    home.dispose();
  }
}

realTest(
  "/helm plugin hands off from the isolated Helm to the in-engine builder and back: the records and the state match the in-engine Helm",
  async () => {
    const isolated = await handoffRecord(true);
    const inEngine = await handoffRecord(false);
    // 값으로 비교한다: 두 모드의 임대 순서, 반납 사유, 알림 글, 끝난 상태가 같다
    expect(isolated).toEqual(inEngine);
    expect(isolated.leases).toEqual([
      ["helm", 0, false],
      ["authoring", 1, true],
    ]);
    expect(isolated.released).toEqual([
      ["authoring", "done"],
      ["helm", "done"],
    ]);
    expect(isolated.notices).toHaveLength(2);
    expect(isolated.state).toEqual({ phase: "idle", pluginNeed: null });
  },
  120_000,
);

// ── 단계 한 번의 추가 시간(격리 왕복) 상한 ───────────────────────────────────────
// 같은 격리 호스트 위의 최소 플러그인(`drive`가 `yield`만 돌려준다)에 `drive.step` 요청을 N번 보낸다.
// 측정 숫자는 이 파일이 쓰지 않는다. 상한만 단언한다(보고서의 숫자는 저장소 밖 임시 스크립트가 잰다).

const BENCH_NAME = "benchdrive";
const BENCH_SAMPLES = 200;

function benchEntry(): string {
  return `import { Type } from "typebox";
import { defineGroup, groupManifest } from "@fresnel/group-sdk";
const manifest = groupManifest(${BENCH_MANIFEST});
const group = defineGroup({
  manifest,
  state: { schema: Type.Object({}), initial: {}, version: 1 },
  setup(g) {
    g.drive(async () => ({ do: "yield" }));
  },
});
export const extension = group.entry;
`;
}

const BENCH_MANIFEST = JSON.stringify({
  schemaVersion: 2,
  name: BENCH_NAME,
  version: "1.0.0",
  entry: "./src/index.ts",
  group: {},
  plugins: [{ layer: "L3", drives: true, hooks: [], requires: [], optional: [] }],
});

function installBench(home: { readonly root: string }): void {
  const root = join(home.root, "config", "extensions", BENCH_NAME);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, ".fresnel-plugin", "plugin.json"), BENCH_MANIFEST);
  writeFileSync(join(root, "src", "index.ts"), benchEntry());
}

function quantile(sorted: readonly number[], q: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

realTest(
  "one drive.step round trip to an isolated plugin stays under the bound (median and p95, 200 requests)",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    installBench(home);
    const emptyBundles = mkdtempSync(join(tmpdir(), "helm-isolated-empty-"));
    const supervisors: PluginHostSupervisor[] = [];
    const host = await startInProcessHost({
      devChecks: true,
      defaultPluginsDir: emptyBundles,
      buildModels: answeringModels("helm-isolated-bench", "done."),
      pluginHost: {
        ...isolatedPluginHost(),
        onSupervisor: (name, supervisor) => {
          if (name === BENCH_NAME) supervisors.push(supervisor);
        },
      },
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      // 사용자 위치의 플러그인은 프로필에 들어 있어야 그 대화가 열 때 실린다(AGE-49). 코어 단위 둘과 이 시험의 플러그인을 기본 프로필에 넣는다
      await connection.request("profile.put", {
        profile: {
          id: "default",
          title: "default",
          plugins: [{ name: "cap-workspace" }, { name: "cap-dialog" }, { name: BENCH_NAME }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      const created = await connection.request("thread.create", {});
      const supervisor = supervisors[0];
      expect(supervisor).toBeDefined();
      if (supervisor === undefined) return;
      const body = {
        threadId: created.threadId,
        deadlineMs: null,
        replay: false,
        caller: "engine",
        state: {},
        settings: {},
        registration: BENCH_NAME,
        last: null,
        budget: { turns: null, spawns: null, tokens: null },
        frame: { frameDepth: 1, calledBy: null, input: null },
      };
      // 요청은 앞 응답을 받은 뒤에 하나씩 보낸다(왕복 한 번의 시간을 잰다)
      const samples: number[] = [];
      await repeatAsync(async () => {
        if (samples.length === BENCH_SAMPLES) return { value: undefined };
        const startedAt = performance.now();
        const reply = await supervisor.call("drive.step", body);
        samples.push(performance.now() - startedAt);
        expect(reply.ok).toBe(true);
        return undefined;
      });
      const sorted = samples.toSorted((a, b) => a - b);
      expect(quantile(sorted, 0.5)).toBeLessThan(BENCH_MEDIAN_BOUND_MS);
      expect(quantile(sorted, 0.95)).toBeLessThan(BENCH_P95_BOUND_MS);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
      rmSync(emptyBundles, { recursive: true, force: true });
    }
  },
  120_000,
);

/**
 * 상한(ms). 측정 숫자는 보고서에 있다. 이 값은 부하가 높은 기기(load average 수백)에서도 넘지 않을 만큼 넉넉하게 잡는다
 * (중앙값은 여유를 두고, p95는 긴 꼬리만 막는다)
 */
const BENCH_MEDIAN_BOUND_MS = 5;
const BENCH_P95_BOUND_MS = 50;
