import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// X.loading-trust §4.4.4, X.primitives §4.4.10: 실제 엔진이 열린 대화가 있는 채로 확장 코드를 새 버전으로 바꾼다.
// 원천 대역이 아니라 조립(`assemble.ts`)의 로더, ExtHost, 버전 기록, wire 처리기를 쓴다. 어느 버전의 핸들러가 불렸는지는 핸들러가
// 던진 오류 문장(`ext.health`의 `lastError`)으로 읽는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const NAME = "ext-reload";

interface PluginInput {
  /** 핸들러가 던지는 오류 문장의 앞머리 */
  readonly tag: string;
  readonly version: string;
  /** `setup`이 던지는 확장(새 버전이 경계에서 열리지 못하는 경우) */
  readonly setupThrows?: boolean;
  /** 엔트리가 import되지 않는 확장 */
  readonly syntaxError?: boolean;
}

function entryText(input: PluginInput): string {
  if (input.syntaxError === true) return "export const extension = (;\n";
  return `export const extension = ({ register }) => {
  register(${JSON.stringify(NAME)}, {}, (g) => {
    ${input.setupThrows === true ? `throw new Error(${JSON.stringify(`${input.tag} cannot start`)});` : ""}
    g.on("boundary.settle.after", () => {
      throw new Error(${JSON.stringify(`${input.tag} failed`)});
    });
  });
};
`;
}

function manifestText(input: PluginInput): string {
  return JSON.stringify({
    schemaVersion: 2,
    name: NAME,
    version: input.version,
    entry: "./src/index.ts",
    plugins: [{ layer: "plugin", hooks: ["boundary.settle.after"] }],
  });
}

function writeFiles(root: string, input: PluginInput): void {
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, ".fresnel-plugin", "plugin.json"), manifestText(input));
  writeFileSync(join(root, "src", "index.ts"), entryText(input));
}

function installedRoot(home: EngineHome): string {
  return join(home.root, "config", "extensions", NAME);
}

/** `<config>/extensions/.history/<이름>/<버전>/`에 보관본을 손으로 둔다(X.loading-trust §4.4.8 위치) */
function writeStored(home: EngineHome, input: PluginInput): void {
  const versionRoot = join(home.root, "config", "extensions", ".history", NAME, input.version);
  writeFiles(join(versionRoot, "dir"), input);
  writeFileSync(
    join(versionRoot, "meta.json"),
    JSON.stringify({
      version: input.version,
      installedAt: "2026-11-01T00:00:00.000Z",
      source: "user",
      manifestHash: "hand-written",
      stateSchemaVersion: null,
    }),
  );
}

async function startReal(first: PluginInput) {
  const home = useEngineHome();
  // 사용자 확장은 기본이 격리(플러그인 호스트 프로세스)다. 이 시험은 엔진 안의 다시 읽기와 되돌리기 규칙을 보므로 명시로 끈다(L4.host-service.spec §4.9)
  writeUserSettings(home, { ...TAPE_SETTINGS, [`ext.${NAME}.isolation`]: "none" });
  writeFiles(installedRoot(home), first);
  const host = await startInProcessHost({
    devChecks: true,
    // 빈 번들 폴더: 기본 플러그인은 없다. 사용자 위치의 확장은 프로필에 들어 있는 대화를 열 때만 실린다
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "ext-reload-bundles-")),
    extraPlugins: [],
    buildModels: answeringModels("ext-reload", "done."),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  // 매니페스트의 기본으로 켜짐은 번들에만 효력이 있다(AGE-49): 확장을 기본 프로필에 넣어야 `thread.create`로 대화를 열 때 실린다.
  // 기본 프로필을 코어가 기대는 단위 cap-workspace, cap-dialog와 이 확장으로 저장한다(이 확장은 지식 기능을 요구하지 않는다)
  await connection.request("profile.put", {
    profile: {
      id: "default",
      title: "default",
      plugins: [{ name: "cap-workspace" }, { name: "cap-dialog" }, { name: NAME }],
      settings: [],
      startDrive: null,
    },
    baseRev: null,
  });
  return { home, host, connection };
}

type Connection = Awaited<ReturnType<typeof startReal>>["connection"];

/** 값이 조건을 만족할 때까지 다시 읽는다(최대 5초) */
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

/** 열어 둔 대화에서 turn 하나를 돌리고, 경계 정산 핸들러가 남긴 마지막 오류 문장을 돌려준다 */
async function lastErrorAfterTurn(
  connection: Connection,
  threadId: ThreadId,
): Promise<string | null | undefined> {
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  await connection.request("turn.start", { threadId, input: "질문" });
  await collector.waitFor((event) => event.kind === "turn.completed");
  const health = await until(
    () => connection.request("ext.health", { name: NAME }),
    (value) => value.health[0]?.windowFailures !== 0,
  );
  return health.health[0]?.lastError;
}

// 새 규칙(M5c §4.5.8, §4.6.3, §8 수용 27): 실행하는 것은 검토본 `tree/`다. 설치 폴더를 고쳐도 검토와 승인 전에는 돌지 않는다.
// 승인 층(검토 항목, 승인 뒤 current 전환)은 다음 단계다. 그래서 다시 읽기는 검토본을 그대로 다시 싣고, 옛 핸들러가 계속 돈다.

realTest(
  "ext.reload does not run an edited install folder before its review item is approved: the reviewed copy keeps running",
  async () => {
    const { home, host, connection } = await startReal({ tag: "v1", version: "1.0.0" });
    try {
      const created = await connection.request("thread.create", {});
      writeFiles(installedRoot(home), { tag: "v2", version: "1.1.0" });
      await connection.request("ext.reload", { name: NAME });
      const listed = await connection.request("ext.list", {});
      expect(listed.extensions.find((entry) => entry.name === NAME)?.version).toBe("1.0.0");
      expect(await lastErrorAfterTurn(connection, created.threadId)).toContain("v1 failed");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "an unapproved edit that does not import is never loaded: ext.reload leaves the reviewed copy and its handler running",
  async () => {
    const { home, host, connection } = await startReal({ tag: "v1", version: "1.0.0" });
    try {
      const created = await connection.request("thread.create", {});
      writeFiles(installedRoot(home), { tag: "v2", version: "1.1.0", syntaxError: true });
      await connection.request("ext.reload", { name: NAME });
      const listed = await connection.request("ext.list", {});
      expect(listed.extensions.find((entry) => entry.name === NAME)?.version).toBe("1.0.0");
      expect(await lastErrorAfterTurn(connection, created.threadId)).toContain("v1 failed");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "an unapproved edit whose setup would throw is never run: ext.reload leaves the reviewed copy and its handler running",
  async () => {
    const { home, host, connection } = await startReal({ tag: "v1", version: "1.0.0" });
    try {
      const created = await connection.request("thread.create", {});
      writeFiles(installedRoot(home), { tag: "v2", version: "1.1.0", setupThrows: true });
      await connection.request("ext.reload", { name: NAME });
      const listed = await connection.request("ext.list", {});
      expect(listed.extensions.find((entry) => entry.name === NAME)?.version).toBe("1.0.0");
      expect(await lastErrorAfterTurn(connection, created.threadId)).toContain("v1 failed");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

// 버전 목록(`ext.versions`)과 되돌리기(`ext.rollback`)는 검토본 저장소가 한다(M5c §4.6.8). 검토 항목을 승인하지 않은 확장은 검토본이 없어
// 되돌릴 판도 없다. 여기서는 설치 폴더의 `.history`에 둔 판이 되돌릴 대상이 되지 않고 실행본이 그대로인 것만 본다.
realTest(
  "ext.rollback does not change the running copy: the reviewed store owns the running version",
  async () => {
    const { home, host, connection } = await startReal({ tag: "new", version: "1.0.0" });
    try {
      writeStored(home, { tag: "old", version: "0.9.0" });
      const created = await connection.request("thread.create", {});
      await connection.request("ext.rollback", { name: NAME, version: "0.9.0" }).then(
        () => undefined,
        () => undefined,
      );
      expect(await lastErrorAfterTurn(connection, created.threadId)).toContain("new failed");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "ext.rollback to a version with no reviewed copy is refused, and ext.versions lists only the reviewed copy",
  async () => {
    const { home, host, connection } = await startReal({ tag: "new", version: "1.0.0" });
    try {
      writeStored(home, { tag: "old", version: "0.9.0", syntaxError: true });
      const created = await connection.request("thread.create", {});
      const outcome = await connection
        .request("ext.rollback", { name: NAME, version: "0.9.0" })
        .then(
          () => "accepted",
          () => "refused",
        );
      expect(outcome).toBe("refused");
      const versions = await connection.request("ext.versions", { name: NAME });
      // 옮김이 넣은 검토본 하나만 있고 current다. 되돌릴 다른 판은 없다
      expect(
        versions.versions.map((entry) => [entry.version.split("+")[0], entry.current]),
      ).toEqual([["1.0.0", true]]);
      expect(await lastErrorAfterTurn(connection, created.threadId)).toContain("new failed");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
