import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
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
  writeUserSettings(home, TAPE_SETTINGS);
  writeFiles(installedRoot(home), first);
  const host = await startInProcessHost({
    devChecks: true,
    // 빈 번들 폴더: 기본 플러그인은 없고 로더가 사용자 위치의 확장을 싣는다
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "ext-reload-bundles-")),
    extraPlugins: [],
    buildModels: answeringModels("ext-reload", "done."),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
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

realTest(
  "ext.reload with an open idle thread swaps at once, and the next turn runs the new handler",
  async () => {
    const { home, host, connection } = await startReal({ tag: "v1", version: "1.0.0" });
    try {
      const created = await connection.request("thread.create", {});
      writeFiles(installedRoot(home), { tag: "v2", version: "1.1.0" });
      const reloaded = await connection.request("ext.reload", { name: NAME });
      expect(reloaded).toEqual({ appliesAt: "now", diagnostics: [] });
      const listed = await connection.request("ext.list", {});
      expect(listed.extensions.find((entry) => entry.name === NAME)?.version).toBe("1.1.0");
      expect(await lastErrorAfterTurn(connection, created.threadId)).toContain("v2 failed");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "ext.reload of an entry that does not import reports it and the old handler keeps running",
  async () => {
    const { home, host, connection } = await startReal({ tag: "v1", version: "1.0.0" });
    try {
      const created = await connection.request("thread.create", {});
      writeFiles(installedRoot(home), { tag: "v2", version: "1.1.0", syntaxError: true });
      const reloaded = await connection.request("ext.reload", { name: NAME });
      expect(reloaded.appliesAt).toBe("nextStepBoundary");
      expect(reloaded.diagnostics.map((entry) => [entry.severity, entry.code])).toEqual([
        ["error", "entry_import_failed"],
      ]);
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
  "ext.reload of a version whose setup throws reports reload_failed and the old handler keeps running",
  async () => {
    const { home, host, connection } = await startReal({ tag: "v1", version: "1.0.0" });
    try {
      const created = await connection.request("thread.create", {});
      writeFiles(installedRoot(home), { tag: "v2", version: "1.1.0", setupThrows: true });
      const reloaded = await connection.request("ext.reload", { name: NAME });
      expect(reloaded.appliesAt).toBe("now");
      expect(reloaded.diagnostics.map((entry) => [entry.severity, entry.code])).toEqual([
        ["error", "reload_failed"],
      ]);
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
  "ext.rollback with an open thread swaps the stored version in and the next turn runs it",
  async () => {
    const { home, host, connection } = await startReal({ tag: "new", version: "1.0.0" });
    try {
      writeStored(home, { tag: "old", version: "0.9.0" });
      const created = await connection.request("thread.create", {});
      const rolled = await connection.request("ext.rollback", { name: NAME, version: "0.9.0" });
      expect(rolled).toEqual({ appliesAt: "nextStepBoundary", stateCleared: false });
      // 되돌리기 전 설치본이 보관되어 다시 앞으로 갈 수 있다
      const versions = await connection.request("ext.versions", { name: NAME });
      expect(
        versions.versions
          .map((entry) => [entry.version, entry.current] as const)
          .toSorted((a, b) => a[0].localeCompare(b[0])),
      ).toEqual([
        ["0.9.0", true],
        ["1.0.0", false],
      ]);
      expect(await lastErrorAfterTurn(connection, created.threadId)).toContain("old failed");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "ext.rollback to a stored version that does not load leaves the installed files and the running version alone",
  async () => {
    const { home, host, connection } = await startReal({ tag: "new", version: "1.0.0" });
    try {
      writeStored(home, { tag: "old", version: "0.9.0", syntaxError: true });
      const created = await connection.request("thread.create", {});
      const caught = await connection
        .request("ext.rollback", { name: NAME, version: "0.9.0" })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(caught).toBeInstanceOf(Error);
      const versions = await connection.request("ext.versions", { name: NAME });
      expect(versions.versions.find((entry) => entry.version === "1.0.0")?.current).toBe(true);
      expect(await lastErrorAfterTurn(connection, created.threadId)).toContain("new failed");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
