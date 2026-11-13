import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";
import type { JsonObject } from "@fresnel/contracts/conversation";

// 플러그인 빌더(기본 켜짐, 도구 지연)와 Fresnel Guide(기본 꺼짐, 개발 모드에서 켜짐)의 실제 엔진 시험([결정: 2026-11-13 사용자]).
// 요청 본문은 테이프 provider가 받은 페이로드이고, 도구 이름과 스킬 인덱스가 거기 들었는지, 그 크기가 달라지는지를 본다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const GUIDE_SKILLS = [
  "fresnel-plugin-authoring",
  "fresnel-settings-and-safety",
  "fresnel-agent-assets",
  "fresnel-data-and-diagnostics",
];

interface Run {
  readonly payloadText: string;
  readonly toolText: string;
  /** `ext.list`의 가이드 그룹 행 */
  readonly extGuide: { readonly status: string; readonly forcedOn?: string } | undefined;
}

/** 모델이 `calls`에 적은 도구를 차례로 부르고 끝내는 대화 하나를 돌린다. 호출이 없으면 "hi"에 답만 한다 */
async function run(options: {
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly calls?: readonly { readonly tool: string; readonly args: JsonObject }[];
}): Promise<Run> {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, ...options.settings });
  mkdirSync(home.dataDir, { recursive: true, mode: 0o700 });
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-guide-")));
  const calls = options.calls ?? [];
  const provider = tapeProvider(
    tapePlayer(
      tape("guide", [
        ...calls.map((call, index) => ({
          role: "main" as const,
          label: `call ${String(index + 1)}`,
          response: {
            type: "message" as const,
            content: [t.toolCall(call.tool, call.args, `call_${String(index + 1)}`)],
            stopReason: "toolUse" as const,
          },
        })),
        {
          role: "main" as const,
          label: "answer",
          response: {
            type: "message" as const,
            content: [t.text("ok.")],
            stopReason: "stop" as const,
          },
        },
      ]),
      { clock: realTapeClock() },
    ),
  );
  // 대화 중 도구 추가를 받는 모델(Claude 5 계열)을 흉내 낸다. 아니면 엔진은 지연 없이 도구를 모두 싣는다(dzD §5)
  Object.assign(provider.model, {
    compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true },
  });
  const host = await startInProcessHost({
    devChecks: true,
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "xh-guide-bundles-")),
    buildModels: tapeBuildModels(provider),
  });
  try {
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", { workspace });
    await connection.request("turn.start", { threadId: created.threadId, input: "hi" });
    await collector.waitFor((event) => event.kind === "turn.completed");
    const first = provider.calls()[0];
    const toolText = toolResultTexts(collector.events, 6000).join("\n");
    const listed = await connection.request("ext.list", {});
    const row = listed.extensions.find((entry) => entry.name === "guide");
    const extGuide =
      row === undefined
        ? undefined
        : { status: row.status, ...(row.forcedOn === undefined ? {} : { forcedOn: row.forcedOn }) };
    await connection.close();
    return { payloadText: JSON.stringify(first?.payload ?? null), toolText, extGuide };
  } finally {
    await host.close();
    rmSync(workspace, { recursive: true, force: true });
    home.dispose();
  }
}

realTest(
  "default: the plugin builder is on but adds nothing to the first request, and the guide skills are absent",
  async () => {
    const withBuilder = await run({});
    const withoutBuilder = await run({ settings: { "ext.authoring.enabled": false } });
    expect(withBuilder.payloadText).not.toContain("authoring_");
    for (const name of GUIDE_SKILLS) expect(withBuilder.payloadText).not.toContain(name);
    // 문맥 비용 0: 빌더를 켜도 요청 본문의 길이가 같다
    expect(withBuilder.payloadText.length).toBe(withoutBuilder.payloadText.length);
  },
  60_000,
);

realTest(
  "dev mode: the four guide skills appear in the skill index and cost only their names and descriptions",
  async () => {
    const off = await run({});
    const on = await run({ settings: { "l3.authoring.devMode": true } });
    for (const name of GUIDE_SKILLS) expect(on.payloadText).toContain(name);
    expect(on.payloadText).not.toContain("# Fresnel plugin authoring");
    const delta = on.payloadText.length - off.payloadText.length;
    expect(delta).toBeGreaterThan(0);
    // 이름과 설명만 든다(스킬마다 대략 200자 안팎). 본문(수천 자)은 들지 않는다
    expect(delta).toBeLessThan(2500);
  },
  60_000,
);

realTest(
  "the guide group switch turns the skills on outside dev mode, and off means off",
  async () => {
    const on = await run({ settings: { "ext.guide.enabled": true } });
    for (const name of GUIDE_SKILLS) expect(on.payloadText).toContain(name);
    const off = await run({ settings: { "ext.guide.enabled": false } });
    for (const name of GUIDE_SKILLS) expect(off.payloadText).not.toContain(name);
  },
  60_000,
);

realTest(
  "a dev run (FRESNEL_DEV=1) turns the guide on and the extension list says it is forced on",
  async () => {
    const previous = process.env["FRESNEL_DEV"];
    process.env["FRESNEL_DEV"] = "1";
    try {
      const on = await run({});
      for (const name of GUIDE_SKILLS) expect(on.payloadText).toContain(name);
      expect(on.extGuide).toMatchObject({ status: "enabled", forcedOn: "devMode" });
    } finally {
      if (previous === undefined) delete process.env["FRESNEL_DEV"];
      else process.env["FRESNEL_DEV"] = previous;
    }
    const off = await run({});
    expect(off.extGuide?.forcedOn).toBeUndefined();
    expect(off.extGuide).toMatchObject({ status: "disabled" });
  },
  60_000,
);

realTest(
  "dev mode: skill_view reads a guide skill body and a reference file",
  async () => {
    const settings = { "l3.authoring.devMode": true };
    const body = await run({
      settings,
      calls: [{ tool: "skill_view", args: { name: "fresnel-plugin-authoring" } }],
    });
    expect(body.toolText).toContain(".fresnel-plugin/plugin.json");
    const reference = await run({
      settings,
      calls: [
        {
          tool: "skill_view",
          args: { name: "fresnel-plugin-authoring", file: "references/manifest.md" },
        },
      ],
    });
    expect(reference.toolText).toContain("schemaVersion");
  },
  60_000,
);

realTest(
  "the plugin builder reads the guide through authoring_guide with the guide group off",
  async () => {
    const listed = await run({
      calls: [
        { tool: "tool_search", args: { query: "authoring_guide" } },
        { tool: "authoring_guide", args: {} },
      ],
    });
    for (const name of GUIDE_SKILLS) expect(listed.toolText).toContain(name);
    const body = await run({
      calls: [
        { tool: "tool_search", args: { query: "authoring_guide" } },
        { tool: "authoring_guide", args: { topic: "fresnel-plugin-authoring" } },
      ],
    });
    expect(body.toolText).toContain(".fresnel-plugin/plugin.json");
  },
  60_000,
);

realTest(
  "tool_search finds the plugin builder tools for plugin, extension, authoring and build queries",
  async () => {
    const queries = [
      "plugin",
      "extension",
      "authoring",
      "build a plugin",
      "plugin builder",
      "create plugin manifest",
    ];
    // 엔진 홈이 하나라 차례로 돌린다
    const found = await queries.reduce<Promise<Record<string, boolean>>>(
      async (previous, query) => {
        const done = await previous;
        const result = await run({ calls: [{ tool: "tool_search", args: { query } }] });
        return { ...done, [query]: /authoring_(kinds|start|guide|scaffold)/.test(result.toolText) };
      },
      Promise.resolve({}),
    );
    expect(found).toEqual(Object.fromEntries(queries.map((query) => [query, true])));
  },
  120_000,
);
