import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// L3.authoring.spec §3.3, Y8: 실제 엔진에서 제작 wire 한 바퀴. 뼈대를 만들고(`ext.scaffold`), 검사하고(`ext.validate`),
// 한 파일로 묶고(`ext.package`), 사용자 위치에 설치한다(`ext.install`). 엔진을 다시 띄우면 그 확장이 실리고, 새 버전을 다시
// 묶어 설치한 뒤 `ext.reload`가 열린 대화에서 새 번들 코드로 바꾼다(한 파일 번들이라 완전히 다시 읽힌다). `ext.remove`로 뺀다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const NAME = "auth-demo";

async function startReal(home: EngineHome) {
  writeUserSettings(home, TAPE_SETTINGS);
  const host = await startInProcessHost({
    devChecks: true,
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "devkit-bundles-")),
    extraPlugins: [],
    buildModels: answeringModels("devkit", "done."),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return { host, connection };
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
  "authoring wire: scaffold, validate, package and install, then reload the bundle and remove",
  async () => {
    const home = useEngineHome();
    const source = mkdtempSync(join(tmpdir(), "devkit-src-"));
    const dir = join(source, NAME);
    const installedDir = join(home.root, "config", "extensions", NAME);
    let session = await startReal(home);
    try {
      const kinds = await session.connection.request("ext.kinds", {});
      expect(kinds.kinds.map((kind) => `${kind.id}:${kind.status}`)).toEqual([
        "plugin-group:stable",
        "single-plugin:stable",
      ]);

      const scaffolded = await session.connection.request("ext.scaffold", {
        kind: "single-plugin",
        name: NAME,
        dir,
      });
      expect(scaffolded.files).toEqual([
        ".fresnel-plugin/plugin.json",
        "README.md",
        "src/index.ts",
      ]);
      const manifestPath = join(dir, ".fresnel-plugin", "plugin.json");
      writeFileSync(
        manifestPath,
        readFileSync(manifestPath, "utf8").replace(
          '"defaultEnabled": false',
          '"defaultEnabled": true',
        ),
      );
      expect(await session.connection.request("ext.validate", { dir })).toEqual({
        ok: true,
        issues: [],
      });
      const packed = await session.connection.request("ext.package", { dir });
      expect(packed.files).toEqual([".fresnel-plugin/plugin.json", "README.md", "dist/index.js"]);
      const installed = await session.connection.request("ext.install", { source: packed.path });
      expect(installed).toEqual({ name: NAME, version: "0.1.0", location: installedDir });
      expect(existsSync(join(installedDir, "dist", "index.js"))).toBe(true);

      // 엔진을 다시 띄우면 설치한 확장이 실린다
      await session.connection.close();
      await session.host.close();
      session = await startReal(home);
      const listed = await session.connection.request("ext.list", {});
      expect(listed.extensions.find((entry) => entry.name === NAME)?.version).toBe("0.1.0");
      const created = await session.connection.request("thread.create", {});

      // 새 버전: 소스를 고쳐 다시 묶고 설치하면 이전 설치본이 버전 기록에 남고, ext.reload가 새 번들로 바꾼다
      writeFileSync(
        manifestPath,
        readFileSync(manifestPath, "utf8").replace('"version": "0.1.0"', '"version": "0.2.0"'),
      );
      const entryPath = join(dir, "src", "index.ts");
      writeFileSync(
        entryPath,
        readFileSync(entryPath, "utf8").replace(
          'g.on("boundary.settle.after", () => {});',
          'g.on("boundary.settle.after", () => {\n      throw new Error("auth-demo v2 failed");\n    });',
        ),
      );
      const repacked = await session.connection.request("ext.package", { dir });
      const reinstalled = await session.connection.request("ext.install", {
        source: repacked.path,
      });
      expect(reinstalled.version).toBe("0.2.0");
      const versions = await session.connection.request("ext.versions", { name: NAME });
      expect(versions.versions.map((entry) => `${entry.version}:${entry.source}`)).toContain(
        "0.1.0:authored",
      );
      expect(await session.connection.request("ext.reload", { name: NAME })).toEqual({
        appliesAt: "now",
        diagnostics: [],
      });
      const after = await session.connection.request("ext.list", {});
      expect(after.extensions.find((entry) => entry.name === NAME)?.version).toBe("0.2.0");
      expect(await lastErrorAfterTurn(session.connection, created.threadId)).toContain(
        "auth-demo v2 failed",
      );

      expect(await session.connection.request("ext.remove", { name: NAME })).toEqual({
        name: NAME,
        appliesAt: "nextStepBoundary",
      });
      expect(existsSync(installedDir)).toBe(false);
    } finally {
      await session.connection.close();
      await session.host.close();
      home.dispose();
      rmSync(source, { recursive: true, force: true });
    }
  },
  120_000,
);
