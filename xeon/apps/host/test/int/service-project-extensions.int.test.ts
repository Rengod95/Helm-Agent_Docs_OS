import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { startService, type ServiceHandle } from "../../src/index.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { connectedClient, manualTime, scratchRuntimeDir } from "../fixtures/service-harness.ts";

// M3-REQ-38 (int): 서비스 모드는 시작 때 프로젝트 확장을 싣지 않고, 작업 폴더를 여는 때 그 폴더가 신뢰되어 있을 때만 싣는다.
// 프롬프트를 받을 클라이언트는 그 폴더를 연 연결이다: 결정이 없으면 싣지 않고, 그 연결이 trust.decide로 허용하면 그때 싣는다.
// 플러그인은 엔트리가 실행될 때 표지 파일을 쓴다. 실제 엔진, 임시 홈, 실제 Unix 소켓.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
const base = realpathSync(mkdtempSync(join(tmpdir(), "xsvc-proj-")));
afterAll(() => {
  home.dispose();
  rmSync(base, { recursive: true, force: true });
});

/** 엔트리가 실행되면 `marker`에 파일을 쓰는 프로젝트 확장을 `<workspace>/.xeon/extensions/<name>/`에 만든다 */
function projectExtension(workspace: string, name: string, marker: string): void {
  const root = join(workspace, ".xeon", "extensions", name);
  mkdirSync(join(root, ".xeon-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".xeon-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 1,
      name,
      version: "1.0.0",
      layer: "plugin",
      kind: "plugin",
      entry: "./src/index.ts",
      points: ["boundary.settle.after"],
      usesDrive: false,
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `import { writeFileSync } from "node:fs";
export const extension = ({ scope }) => {
  writeFileSync(${JSON.stringify(marker)}, "loaded");
  scope(${JSON.stringify(name)}, {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
};
`,
  );
}

function workspaceWith(name: string): { workspace: string; marker: string } {
  const workspace = join(base, name);
  mkdirSync(workspace, { recursive: true });
  const marker = join(base, `${name}.marker`);
  projectExtension(workspace, `proj-${name}`, marker);
  return { workspace, marker };
}

function handleOf(started: Awaited<ReturnType<typeof startService>>): ServiceHandle {
  if (!started.started) throw new Error(`the service did not start: ${started.reason}`);
  return started.handle;
}

realTest(
  "a project extension is not loaded at start; it loads when the connection that opened the workspace allows it, and not for a denied workspace",
  async () => {
    const trusted = workspaceWith("trusted");
    const denied = workspaceWith("denied");
    const runtime = scratchRuntimeDir();
    const bundles = mkdtempSync(join(tmpdir(), "xsvc-bundles-"));
    const handle = handleOf(
      await startService({
        runtimeDir: runtime.dir,
        assemble: { devChecks: true, defaultPluginsDir: bundles },
        time: manualTime(),
        handleSignals: false,
        startupGraceMs: 0,
        idleGraceMs: 60_000,
      }),
    );
    try {
      // 시작 때는 어떤 프로젝트도 싣지 않았다
      expect(existsSync(trusted.marker)).toBe(false);
      const client = await connectedClient({ kind: "unix", path: handle.registration.socket });

      // 결정이 없는 폴더: thread를 열어도 싣지 않는다. 클라이언트가 trust.get으로 묻는다
      const asked = await client.request("trust.get", { workspace: trusted.workspace });
      expect(asked).toMatchObject({ required: true, verdict: "undecided", via: "headless" });
      await client.request("thread.create", { workspace: trusted.workspace });
      expect(existsSync(trusted.marker)).toBe(false);

      // 그 연결이 허용하면 그때 싣는다
      await client.request("trust.decide", {
        workspace: trusted.workspace,
        choice: { kind: "session", verdict: "allow" },
      });
      expect(existsSync(trusted.marker)).toBe(true);

      // 거부한 폴더는 싣지 않는다. thread를 열어도 같다
      await client.request("trust.decide", {
        workspace: denied.workspace,
        choice: { kind: "session", verdict: "deny" },
      });
      await client.request("thread.create", { workspace: denied.workspace });
      expect(existsSync(denied.marker)).toBe(false);
      await client.close();
    } finally {
      await handle.shutdown("stop");
      runtime.dispose();
      rmSync(bundles, { recursive: true, force: true });
    }
  },
  60_000,
);

realTest(
  "a workspace trusted by a stored decision loads its project extension when a thread is created in it, not at start",
  async () => {
    const stored = workspaceWith("stored");
    const bundles = mkdtempSync(join(tmpdir(), "xsvc-bundles-"));
    const options = (runtimeDir: string) => ({
      runtimeDir,
      assemble: { devChecks: true, defaultPluginsDir: bundles },
      time: manualTime(),
      handleSignals: false,
      startupGraceMs: 0,
      idleGraceMs: 60_000,
    });
    try {
      // 첫 서비스: 결정을 저장 파일에 남긴다
      const firstRuntime = scratchRuntimeDir();
      const first = handleOf(await startService(options(firstRuntime.dir)));
      const client = await connectedClient({ kind: "unix", path: first.registration.socket });
      await client.request("trust.decide", {
        workspace: stored.workspace,
        choice: { kind: "folder", verdict: "allow" },
      });
      expect(existsSync(stored.marker)).toBe(true);
      await client.close();
      await first.shutdown("stop");
      firstRuntime.dispose();
      rmSync(stored.marker);

      // 두 번째 서비스: 시작 때는 싣지 않고, 작업 폴더에 thread를 만들 때 싣는다
      const secondRuntime = scratchRuntimeDir();
      const second = handleOf(await startService(options(secondRuntime.dir)));
      try {
        expect(existsSync(stored.marker)).toBe(false);
        const again = await connectedClient({ kind: "unix", path: second.registration.socket });
        await again.request("thread.create", { workspace: stored.workspace });
        expect(existsSync(stored.marker)).toBe(true);
        await again.close();
      } finally {
        await second.shutdown("stop");
        secondRuntime.dispose();
      }
    } finally {
      rmSync(bundles, { recursive: true, force: true });
    }
  },
  60_000,
);
