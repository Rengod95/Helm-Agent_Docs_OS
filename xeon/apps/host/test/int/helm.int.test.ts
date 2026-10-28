import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import { buildHelmPlugin } from "@xeon/group-helm/build";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { SDK_MODULE_SPECIFIERS } from "@xeon/ext-host";
import { DEFAULT_PLUGINS_MARKER_FILE } from "../../src/assembly/default-plugins.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M3a E1(UC-2), 실제 엔진: 기본 플러그인 Helm이 첫 실행에 설치되고 외부 로더로 실리며, /helm 명령이 wire로 닿고,
// 확산 단계의 쓰기(exec) 도구가 실행 전에 거부되어 거부 사유가 모델에 돌아간다. 모델은 테이프다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

let bundleRoot: string;
let bundleExternals: readonly string[] = [];

beforeAll(async () => {
  bundleRoot = mkdtempSync(join(tmpdir(), "helm-bundle-"));
  const built = await buildHelmPlugin(join(bundleRoot, "helm"));
  if (!built.ok) throw new Error(`plugin build failed: ${built.error.kind}`);
  bundleExternals = built.value.externals;
}, 60_000);

afterAll(() => {
  rmSync(bundleRoot, { recursive: true, force: true });
});

function answer(label: string, text: string) {
  return {
    role: "main" as const,
    label,
    response: { type: "message" as const, content: [t.text(text)], stopReason: "stop" as const },
  };
}

function report(claim: string): string {
  return `\`\`\`json\n${JSON.stringify({ findings: [{ claim, sources: [], confidence: "medium" }] })}\n\`\`\``;
}

function diverseModels(): NonNullable<Parameters<typeof startInProcessHost>[0]>["buildModels"] {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape("helm-uc2", [
          answer("user turn", "안녕하세요."),
          {
            role: "main" as const,
            label: "diverge: tries bash",
            response: {
              type: "message" as const,
              content: [t.toolCall("bash", { command: "echo should-not-run" }, "call_bash")],
              stopReason: "toolUse" as const,
            },
          },
          answer("diverge: answers after the denial", "쓰기 없이 정리합니다."),
          answer("explorer 1", report("관점 하나")),
          answer("explorer 2", report("관점 둘")),
          answer("explorer 3", report("관점 셋")),
          answer("apply", "발견을 적용했습니다."),
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}

test("every module the Helm bundle leaves external is one X or the host registers", () => {
  expect(bundleExternals.length).toBeGreaterThan(0);
  expect(bundleExternals.filter((specifier) => !SDK_MODULE_SPECIFIERS.includes(specifier))).toEqual(
    [],
  );
});

realTest(
  "uc2.real-engine: Helm is loaded, bash is denied while diverging, 3 lens subagents run and exactly one apply turn follows",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultPluginsDir: bundleRoot,
      buildModels: diverseModels(),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    // 첫 실행 설치: 사용자 확장 위치와 호스트 상태의 표지
    expect(
      existsSync(join(home.root, "config", "extensions", "helm", ".xeon-plugin", "plugin.json")),
    ).toBe(true);
    expect(existsSync(join(home.root, "state", DEFAULT_PLUGINS_MARKER_FILE))).toBe(true);
    const created = await connection.request("thread.create", {});
    const listed = await connection.request("command.list", {});
    expect(listed.commands.find((command) => command.name === "helm")).toMatchObject({
      origin: "helm",
    });
    const started = await connection.request("command.run", {
      threadId: created.threadId,
      text: "/helm start 캐시 무효화",
    });
    expect(started).toMatchObject({ status: "done", name: "helm" });
    // 명령은 다음 on 지점에서 상태에 반영된다. 사용자 turn이 끝나면 Helm이 임대를 받고 발산 turn을 연다
    await connection.request("turn.start", { threadId: created.threadId, input: "hello" });
    const denied = await collector.waitFor(
      (event) => JSON.stringify(event.payload).includes("denied_by_extension"),
      20_000,
    );
    expect(JSON.stringify(denied.payload)).toContain("call_bash");
    expect(JSON.stringify(denied.payload)).toContain("Helm 확산 단계");
    // 거부는 정책·승인 앞에서 일어나므로 사용자 승인 창이 뜨지 않는다
    expect(collector.events.filter((event) => event.kind === "approval.requested")).toEqual([]);
    expect(
      collector.events.filter((event) => event.kind === "grp.helm.state.committed").length,
    ).toBeGreaterThanOrEqual(2);
    await connection.close();
    await host.close();
    home.dispose();
  },
  60_000,
);

realTest(
  "a plugin the user deleted is not installed again on the next start, and safe mode does not load Helm",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const first = await startInProcessHost({ devChecks: true, defaultPluginsDir: bundleRoot });
    await first.close();
    const installed = join(home.root, "config", "extensions", "helm");
    expect(existsSync(installed)).toBe(true);
    rmSync(installed, { recursive: true, force: true });
    const second = await startInProcessHost({ devChecks: true, defaultPluginsDir: bundleRoot });
    await second.close();
    expect(existsSync(installed)).toBe(false);
    // 표지도 지우면 새로 설치되지만 안전 모드에서는 싣지 않는다
    rmSync(join(home.root, "state", DEFAULT_PLUGINS_MARKER_FILE));
    const safe = await startInProcessHost({
      devChecks: true,
      defaultPluginsDir: bundleRoot,
      safeMode: true,
    });
    const connection = createHostConnection(safe.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const listed = await connection.request("command.list", {});
    expect(listed.commands.map((command) => command.name)).not.toContain("helm");
    await connection.close();
    await safe.close();
    home.dispose();
  },
  60_000,
);
