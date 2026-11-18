import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { startService, type ServiceHandle } from "../../src/index.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { connectedClient, manualTime, scratchRuntimeDir } from "../fixtures/service-harness.ts";

// ext.list는 로더 목록이 원천이다: 서비스 모드에서 작업 폴더를 열 때 실린 프로젝트 확장도 위치(`origin: "project"`)와 함께 나온다.
// 실제 엔진, 임시 홈, 실제 Unix 소켓. 폴더가 신뢰되기 전에는 목록에 없고, 거부한 폴더의 확장은 끝내 없다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
const base = realpathSync(mkdtempSync(join(tmpdir(), "xsvc-extread-")));
afterAll(() => {
  home.dispose();
  rmSync(base, { recursive: true, force: true });
});

function projectExtension(workspace: string, name: string): string {
  const root = join(workspace, ".fresnel", "extensions", name);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name,
      version: "2.1.0",
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: ["boundary.settle.after"] }],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `export const extension = ({ register }) => {
  register(${JSON.stringify(name)}, {}, (g) => {
    g.on("boundary.settle.after", () => {});
  });
};
`,
  );
  return root;
}

function workspaceWith(name: string): { workspace: string; extension: string; root: string } {
  const workspace = join(base, name);
  mkdirSync(workspace, { recursive: true });
  const extension = `proj-${name}`;
  return { workspace, extension, root: projectExtension(workspace, extension) };
}

function handleOf(started: Awaited<ReturnType<typeof startService>>): ServiceHandle {
  if (!started.started) throw new Error(`the service did not start: ${started.reason}`);
  return started.handle;
}

realTest(
  "ext.list does not show a project extension of a trusted workspace before its review item is approved (M5c §4.7.9)",
  async () => {
    const trusted = workspaceWith("trusted");
    const denied = workspaceWith("denied");
    const runtime = scratchRuntimeDir();
    const bundles = mkdtempSync(join(tmpdir(), "xsvc-bundles-"));
    const handle = handleOf(
      await startService({
        runtimeDir: runtime.dir,
        assemble: { pluginHost: { disabled: true }, devChecks: true, defaultPluginsDir: bundles },
        time: manualTime(),
        handleSignals: false,
        startupGraceMs: 0,
        idleGraceMs: 60_000,
      }),
    );
    try {
      const client = await connectedClient({ kind: "unix", path: handle.registration.socket });
      const namesOf = async (): Promise<readonly string[]> =>
        (await client.request("ext.list", {})).extensions.map((entry) => entry.name);

      expect(await namesOf()).not.toContain(trusted.extension);

      await client.request("trust.decide", {
        workspace: trusted.workspace,
        choice: { kind: "session", verdict: "allow" },
      });
      const list = await client.request("ext.list", {});
      // 검토 항목이 승인되기 전에는 목록에 오르지 않는다(M5c §4.7.9). 승인 층은 다음 단계다
      expect(list.extensions.find((entry) => entry.name === trusted.extension)).toBeUndefined();
      // 같은 목록의 내장 단위는 그대로 `builtin`이다
      expect(list.extensions.find((entry) => entry.name === "core-loop")?.origin).toBe("builtin");

      // 실행 목록에도 없다: 등록은 적재된 확장에서만 나온다(승인 전에는 적재하지 않는다)
      const hooks = await client.request("hooks.list", {});
      const settle = hooks.hooks.find((hook) => hook.hook === "boundary.settle.after");
      // 학습 그룹이 빌트인에서 빠져 이 훅에 내장 핸들러가 없다: 순서 목록이 없을 수 있다
      expect(settle?.order?.map((handler) => handler.registrationId) ?? []).not.toContain(
        trusted.extension,
      );

      await client.request("trust.decide", {
        workspace: denied.workspace,
        choice: { kind: "session", verdict: "deny" },
      });
      expect(await namesOf()).not.toContain(denied.extension);
      await client.close();
    } finally {
      await handle.shutdown("stop");
      runtime.dispose();
      rmSync(bundles, { recursive: true, force: true });
    }
  },
  60_000,
);
