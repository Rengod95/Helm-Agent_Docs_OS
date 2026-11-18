import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { attempt } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { HostConnection } from "@fresnel/contracts/wire";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import type { PluginHostSupervisor } from "@fresnel/ext-host";
import { buildHelmPlugin } from "@fresnel/group-helm/build";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { isolatedPluginHost } from "../fixtures/isolated-plugin-host.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { answeringModels, realTapeClock } from "../fixtures/tape-host.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// L4.host-service.spec §4.9, X.loading-trust §4.9. 실제 엔진이 사용자 플러그인을 플러그인 호스트 프로세스에서 돌린다.
// 자식은 실제로 `bun apps/host/src/main.ts plugin-host --stdio`로 뜨고, 샌드박스만 대역이다(명령줄을 그대로 돌려준다).
// 플러그인의 훅은 상태를 커밋하고 기록을 쓰며, 자기 프로세스 번호와 커밋된 값을 시험 폴더의 파일에 쓴다.
// 평범한 `register` 플러그인의 `g`에는 `registerTool`·`registerCommand`가 없어 도구와 명령은 이 묶음에서 시험하지 않는다.
// 도구와 명령은 `defineGroup` 플러그인으로 마지막 시험이 본다(group-sdk의 wrap이 자식의 `hostOf`를 쓴다).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

// 기록 종류 정규식이 하이픈을 받지 않으므로(`x.<이름>.<영역>`) 이름에 하이픈을 넣지 않는다
const NAME = "pluginhost";
const TIMEOUT_MS = 30_000;

/** 플러그인 엔트리. 보고 파일 경로를 넣어 만든다. `typebox`는 X가 가상 모듈로 등록한다 */
function entryText(reportPath: string): string {
  return `import { Type } from "typebox";
import { writeFileSync } from "node:fs";
export const extension = ({ register }) => {
  register(${JSON.stringify(NAME)}, { state: { schema: Type.Object({ count: Type.Integer() }), initial: { count: 0 }, version: 1 } }, (g) => {
    g.on("boundary.settle.after", async () => {
      const next = g.state().count + 1;
      await g.commit({ count: next });
      await g.recordPrivate(${JSON.stringify(`x.${NAME}.run.turn`)}, { pid: process.pid });
      writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ pid: process.pid, count: next }));
    });
  });
};
`;
}

const MANIFEST = JSON.stringify({
  schemaVersion: 2,
  name: NAME,
  version: "1.0.0",
  entry: "./src/index.ts",
  plugins: [{ layer: "plugin", hooks: ["boundary.settle.after"] }],
});

function installPlugin(home: EngineHome, reportPath: string): void {
  const root = join(home.root, "config", "extensions", NAME);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, ".fresnel-plugin", "plugin.json"), MANIFEST);
  writeFileSync(join(root, "src", "index.ts"), entryText(reportPath));
}

/** 값이 조건을 만족할 때까지 다시 읽는다. 마감을 넘으면 마지막 값을 돌려준다 */
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  deadline = Date.now() + 10_000,
): Promise<T> {
  const value = await read();
  if (done(value) || Date.now() > deadline) return value;
  await new Promise((resolve) => setTimeout(resolve, 50));
  return until(read, done, deadline);
}

/** 프로세스가 살아 있는가. 신호 0은 존재만 본다(ESRCH면 끝난 것이고, 그 실패는 값으로 받는다) */
function alive(pid: number): boolean {
  return attempt(() => {
    process.kill(pid, 0);
  }).ok;
}

/** 플러그인이 쓴 보고(`{"pid":N,"count":M}`). 없으면 undefined */
function readReport(path: string): { readonly pid: number; readonly count: number } | undefined {
  if (!existsSync(path)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("pid" in parsed) ||
    !("count" in parsed) ||
    typeof parsed.pid !== "number" ||
    typeof parsed.count !== "number"
  ) {
    throw new Error("the plugin wrote an unexpected report");
  }
  return { pid: parsed.pid, count: parsed.count };
}

/**
 * 기본 프로필을 코어 단위(cap-workspace, cap-dialog)와 이 시험의 플러그인 이름들로 저장한다. 사용자 위치의 플러그인은 프로필에 들어 있어야
 * 그 프로필의 대화가 열릴 때 실린다(AGE-49). 코어 단위를 빼면 플러그인이 코어 단위를 요구해 거부된다
 */
async function putDefaultProfile(
  connection: HostConnection,
  plugins: readonly string[],
): Promise<void> {
  await connection.request("profile.put", {
    profile: {
      id: "default",
      title: "default",
      plugins: [
        { name: "cap-workspace" },
        { name: "cap-dialog" },
        ...plugins.map((name) => ({ name })),
      ],
      settings: [],
      startDrive: null,
    },
    baseRev: null,
  });
}

async function startWith(home: EngineHome, settings: Readonly<Record<string, unknown>>) {
  const reportPath = join(home.root, "plugin-report.json");
  writeUserSettings(home, { ...TAPE_SETTINGS, ...settings });
  installPlugin(home, reportPath);
  // 시작 보고(onLoadReport)는 시작 때의 스냅샷이라 대화가 열어 싣는 플러그인은 보이지 않는다. 격리 자식은 실릴 때 감독자를 만든다
  const supervisors: PluginHostSupervisor[] = [];
  const host = await startInProcessHost({
    devChecks: true,
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "plugin-host-bundles-")),
    extraPlugins: [],
    buildModels: answeringModels("plugin-host-e2e", "done."),
    pluginHost: {
      ...isolatedPluginHost(),
      onSupervisor: (name, supervisor) => {
        if (name === NAME) supervisors.push(supervisor);
      },
    },
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  await putDefaultProfile(connection, [NAME]);
  return {
    host,
    connection,
    reportPath,
    isolation: () => (supervisors.length > 0 ? "process" : "none"),
    close: async (): Promise<void> => {
      await connection.close();
      await host.close();
      home.dispose();
    },
  };
}

type Started = Awaited<ReturnType<typeof startWith>>;

/** 기본 프로필의 대화를 하나 연다. 사용자 위치의 플러그인은 이 대화가 열릴 때 실린다 */
async function openThread(started: Started) {
  const created = await started.connection.request("thread.create", {});
  return created.threadId;
}

/** 열어 둔 대화에서 turn 하나를 끝까지 돌린다. 정산 훅이 끝날 때까지 `turn.completed`를 기다린다 */
async function runTurn(started: Started, threadId: ThreadId): Promise<void> {
  const collector = collectEvents(started.connection);
  await started.connection.request("events.subscribe", { from: "head" });
  await started.connection.request("turn.start", { threadId, input: "질문" });
  await collector.waitFor((event) => event.kind === "turn.completed");
}

realTest(
  "a user plugin runs in its own process: its hook commits the state and writes the record there",
  async () => {
    const home = useEngineHome();
    const started = await startWith(home, {});
    try {
      // 플러그인은 대화가 열릴 때 실린다. 열고 나서 격리를 본다
      const threadId = await openThread(started);
      expect(started.isolation()).toBe("process");
      await runTurn(started, threadId);
      const report = await until(
        async () => readReport(started.reportPath),
        (value) => value?.count === 1,
      );
      expect(report?.count).toBe(1);
      // 훅은 엔진의 프로세스가 아니라 플러그인 호스트 프로세스에서 돈다
      expect(report?.pid).not.toBe(process.pid);
      expect(report === undefined ? false : alive(report.pid)).toBe(true);
    } finally {
      await started.close();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "after the host closes, the plugin process exits",
  async () => {
    const home = useEngineHome();
    const started = await startWith(home, {});
    const threadId = await openThread(started);
    await runTurn(started, threadId);
    const report = await until(
      async () => readReport(started.reportPath),
      (value) => value !== undefined,
    );
    expect(report === undefined ? false : alive(report.pid)).toBe(true);
    const childPid = report?.pid ?? process.pid;
    await started.close();
    const stillAlive = await until(
      async () => alive(childPid),
      (value) => !value,
    );
    expect(stillAlive).toBe(false);
  },
  TIMEOUT_MS,
);

realTest(
  "an explicit ext.<name>.isolation = none runs the same plugin inside the engine",
  async () => {
    const home = useEngineHome();
    const started = await startWith(home, { [`ext.${NAME}.isolation`]: "none" });
    try {
      const threadId = await openThread(started);
      expect(started.isolation()).toBe("none");
      await runTurn(started, threadId);
      const report = await until(
        async () => readReport(started.reportPath),
        (value) => value?.count === 1,
      );
      expect(report?.count).toBe(1);
      expect(report?.pid).toBe(process.pid);
    } finally {
      await started.close();
    }
  },
  TIMEOUT_MS,
);

realTest(
  "the bundled Helm plugin runs in its own process: it drives, and drives no longer keep a plugin in the engine",
  async () => {
    const home = useEngineHome();
    const bundles = mkdtempSync(join(tmpdir(), "plugin-host-helm-"));
    try {
      const built = await buildHelmPlugin(join(bundles, "helm"));
      expect(built.ok).toBe(true);
      writeUserSettings(home, TAPE_SETTINGS);
      let helmIsolation: string | undefined;
      const host = await startInProcessHost({
        devChecks: true,
        defaultPluginsDir: bundles,
        buildModels: answeringModels("plugin-host-helm", "done."),
        pluginHost: {
          ...isolatedPluginHost(),
          onLoadReport: (report) => {
            helmIsolation = report.extensions.find((entry) => entry.name === "helm")?.isolation;
          },
        },
      });
      try {
        expect(helmIsolation).toBe("process");
      } finally {
        await host.close();
      }
    } finally {
      home.dispose();
      rmSync(bundles, { recursive: true, force: true });
    }
  },
  60_000,
);

// ── defineGroup 플러그인 ────────────────────────────────────────────────
// 사용자 그룹(`defineGroup`)도 같은 자식 프로세스에서 돈다. 도구와 명령은 자식의 `hostOf(g)`로 등록되고 엔진이 그 선언을 받아 부른다.
// 상태 버전은 1이다: 이 시험은 상태 이전이 없는 경우를 본다. 버전 2 이상의 이전은 자식이 `state.migrate` 요청으로 맡는다(F.extensions 부록).

const GROUP_NAME = "pluginhostgroup";
const GROUP_TOOL = "pluginhostgroup_count";

const GROUP_MANIFEST = JSON.stringify({
  schemaVersion: 2,
  name: GROUP_NAME,
  version: "1.0.0",
  entry: "./src/index.ts",
  group: {},
  plugins: [{ layer: "L3", hooks: ["boundary.settle.after"], requires: [], optional: [] }],
});

/** 그룹 엔트리. 상태 `{count}`를 정산 훅이 한 씩 올려 커밋하고, 도구와 명령이 같은 상태를 읽는다 */
function groupEntryText(reportPath: string): string {
  return `import { writeFileSync } from "node:fs";
import { Type } from "typebox";
import { defineGroup, groupManifest } from "@fresnel/group-sdk";
const manifest = groupManifest(${GROUP_MANIFEST});
const group = defineGroup({
  manifest,
  state: { schema: Type.Object({ count: Type.Integer() }), initial: { count: 0 }, version: 1 },
  setup(g) {
    g.on("boundary.settle.after", async () => {
      const committed = await g.commit({ count: g.state().count + 1 });
      writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ pid: process.pid, count: committed.count }));
    });
    g.registerTool({
      name: ${JSON.stringify(GROUP_TOOL)},
      description: "Return the committed count of the group",
      parameters: Type.Object({}),
      replay: "safe",
      execute: () => Promise.resolve({ count: g.state().count }),
    });
    g.registerCommand(${JSON.stringify(GROUP_NAME)}, {
      description: "Show the committed count of the group",
      handler: () => Promise.resolve({ message: "count " + String(g.state().count), result: { count: g.state().count } }),
    });
  },
});
export const extension = group.entry;
`;
}

function installGroup(home: EngineHome, reportPath: string): void {
  const root = join(home.root, "config", "extensions", GROUP_NAME);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, ".fresnel-plugin", "plugin.json"), GROUP_MANIFEST);
  writeFileSync(join(root, "src", "index.ts"), groupEntryText(reportPath));
}

/** 첫 turn은 답만 하고, 둘째 turn은 도구를 한 번 부른 뒤 답한다(테이프 순서) */
function groupModels() {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape("plugin-host-group", [
          {
            role: "main",
            label: "first answer",
            response: { type: "message", content: [t.text("one.")], stopReason: "stop" },
          },
          {
            role: "main",
            label: "calls the group tool",
            response: {
              type: "message",
              content: [t.toolCall(GROUP_TOOL, {}, "call_group")],
              stopReason: "toolUse",
            },
          },
          {
            role: "main",
            label: "answers after the tool",
            response: { type: "message", content: [t.text("two.")], stopReason: "stop" },
          },
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}

realTest(
  "a defineGroup plugin runs in its own process: its hook commits, its tool and command read the committed state",
  async () => {
    const home = useEngineHome();
    const reportPath = join(home.root, "group-report.json");
    writeUserSettings(home, TAPE_SETTINGS);
    installGroup(home, reportPath);
    // 시작 보고는 시작 때의 스냅샷이라 대화가 열어 싣는 그룹은 보이지 않는다. 격리 자식은 실릴 때 감독자를 만든다
    const groupSupervisors: PluginHostSupervisor[] = [];
    const host = await startInProcessHost({
      devChecks: true,
      defaultPluginsDir: mkdtempSync(join(tmpdir(), "plugin-host-group-bundles-")),
      extraPlugins: [],
      buildModels: groupModels(),
      pluginHost: {
        ...isolatedPluginHost(),
        onSupervisor: (name, supervisor) => {
          if (name === GROUP_NAME) groupSupervisors.push(supervisor);
        },
      },
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      // `command.run`의 명령 서비스는 host-dialog-bridge가 채운다. 기본 프로필을 바꾸면 이 단위도 빠지므로 함께 넣는다
      await putDefaultProfile(connection, [GROUP_NAME, "host-dialog-bridge"]);
      // 그룹은 이 대화가 열릴 때 실린다(AGE-49). 열고 나서 격리를 본다
      const created = await connection.request("thread.create", {});
      expect(groupSupervisors.length > 0 ? "process" : "none").toBe("process");
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });

      // 첫 turn: 정산 훅이 상태를 1로 커밋하고 보고를 쓴다
      await startTurnWhenIdle(connection, { threadId: created.threadId, input: "첫 질문" });
      await collector.waitFor((event) => event.kind === "turn.completed");
      const first = await until(
        async () => readReport(reportPath),
        (value) => value?.count === 1,
      );
      expect(first?.count).toBe(1);
      expect(first?.pid).not.toBe(process.pid);
      expect(first === undefined ? false : alive(first.pid)).toBe(true);

      // 둘째 turn: 도구가 커밋된 상태 1을 읽고, 정산 훅이 2로 올린다
      const seen = new Set(collector.events);
      await startTurnWhenIdle(connection, { threadId: created.threadId, input: "둘째 질문" });
      // 외부 확장의 도구는 exec 위험이라 기본 승인 모드에서 묻는다. 목록에서 이 도구의 승인을 찾아 허용한다
      const asked = await collector.waitFor(
        (event) => event.kind === "approval.requested" && !seen.has(event),
      );
      const listed = await connection.request("approval.list", { threadId: created.threadId });
      expect(JSON.stringify(listed.approvals)).toContain(GROUP_TOOL);
      expect(
        await connection.request("approval.respond", { approvalId: asked.id, decision: "allow" }),
      ).toEqual({ applied: true });
      await collector.waitFor((event) => event.kind === "turn.completed" && !seen.has(event));
      const second = await until(
        async () => readReport(reportPath),
        (value) => value?.count === 2,
      );
      expect(second?.count).toBe(2);
      expect(second?.pid).toBe(first?.pid);
      // 도구 결과는 상태 1을 읽은 값이다(둘째 turn은 정산 훅이 2로 올리기 전에 부른다)
      const toolResults: unknown[] = toolResultTexts(collector.events, Number.MAX_SAFE_INTEGER).map(
        (text) => {
          const parsed: unknown = JSON.parse(text);
          return parsed;
        },
      );
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0]).toMatchObject({
        toolName: GROUP_TOOL,
        isError: false,
        content: [{ type: "text", text: JSON.stringify({ count: 1 }) }],
      });

      // 명령은 같은 상태를 읽는다
      const ran = await connection.request("command.run", {
        threadId: created.threadId,
        text: `/${GROUP_NAME}`,
      });
      expect(ran).toMatchObject({
        status: "done",
        name: GROUP_NAME,
        message: "count 2",
        result: { count: 2 },
      });
      expect(second === undefined ? false : alive(second.pid)).toBe(true);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  TIMEOUT_MS,
);
