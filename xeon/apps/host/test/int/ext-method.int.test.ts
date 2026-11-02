import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { buildHelmPlugin } from "@fresnel/group-helm/build";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { isRecord, rawClient, type RawClient } from "../fixtures/raw-client.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// X-2, X-3, X-9: 조립된 호스트가 실제로 설치한 Helm 플러그인의 `ext.helm.status|inquiries|findings`에 wire로 답한다.
// 닫힌 처리기 표 밖의 이름이 연결 층에서 X의 `ExtHost.methods`로 가고, 결과는 매니페스트 선언으로 검사된다. 모델은 테이프다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

let bundleRoot: string;

beforeAll(async () => {
  bundleRoot = mkdtempSync(join(tmpdir(), "ext-method-bundle-"));
  const built = await buildHelmPlugin(join(bundleRoot, "helm"));
  if (!built.ok) throw new Error(`plugin build failed: ${built.error.kind}`);
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

/** `/helm start` 하나로 발산, 렌즈 셋, 적용 한 번이 도는 테이프 */
function inquiryPlayer(): ReturnType<typeof tapePlayer> {
  return tapePlayer(
    tape("ext-method-helm", [
      answer("diverge", "세 관점으로 나눕니다."),
      answer("explorer 1", report("관점 하나")),
      answer("explorer 2", report("관점 둘")),
      answer("explorer 3", report("관점 셋")),
      answer("apply", "발견을 적용했습니다."),
    ]),
    { clock: realTapeClock() },
  );
}

const ids = { next: 0 };

async function call(
  raw: RawClient,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  ids.next += 1;
  const id = `w${ids.next}`;
  await raw.send({ jsonrpc: "2.0", id, method, params });
  const reply = await raw.response(id, 30_000);
  if (!isRecord(reply.message)) throw new Error("reply is not an object");
  return reply.message;
}

function resultOf(reply: Record<string, unknown>): Record<string, unknown> {
  const result = reply["result"];
  if (!isRecord(result)) throw new Error(`no result: ${JSON.stringify(reply)}`);
  return result;
}

realTest(
  "ext.helm.* over the real wire: idle status, a finished inquiry in the list, its findings, and exact errors",
  async () => {
    const player = inquiryPlayer();
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultPluginsDir: bundleRoot,
      buildModels: tapeBuildModels(tapeProvider(player)),
    });
    const raw = rawClient(host.client);
    await call(raw, "host.hello", { ...HELLO_PARAMS });
    await call(raw, "events.subscribe", { from: "head" });
    const created = resultOf(await call(raw, "thread.create", {}));
    const threadId = created["threadId"];

    // 탐구 전: 대기 상태 그대로의 보기와 빈 목록
    const idle = resultOf(await call(raw, "ext.helm.status", { threadId }));
    expect(idle).toEqual({
      enabled: true,
      phase: "idle",
      inquiryId: null,
      topic: null,
      lenses: [],
      findings: 0,
      lease: "none",
    });
    expect(resultOf(await call(raw, "ext.helm.inquiries", { threadId }))).toEqual({
      inquiries: [],
    });

    // 틀린 params는 확장 선언 검사에서 invalidParams로 돌아온다
    const bad = await call(raw, "ext.helm.findings", { threadId });
    expect(bad["error"]).toMatchObject({ code: -32602, data: { kind: "jsonrpc.invalidParams" } });
    // 선언하지 않은 동사와 없는 확장은 methodNotFound다
    expect(await call(raw, "ext.helm.nothing", { threadId })).toMatchObject({
      error: { code: -32601 },
    });
    expect(await call(raw, "ext.nosuch.status", {})).toMatchObject({ error: { code: -32601 } });

    // 탐구 한 번을 끝까지 돌린다
    const started = resultOf(
      await call(raw, "command.run", { threadId, text: "/helm start 캐시 무효화" }),
    );
    expect(started).toMatchObject({ status: "done", name: "helm" });
    const finishedAt = await raw.waitFor(
      (message) => JSON.stringify(message).includes("grp.helm.inquiry.finished"),
      30_000,
    );
    expect(player.remaining()).toBe(0);
    // 끝 기록 뒤에 단계를 idle로 돌리는 상태 커밋이 따로 온다. 그 이벤트까지 기다린 뒤 읽는다
    await raw.waitFor((message) => {
      const text = JSON.stringify(message);
      const index = raw.received.findIndex((entry) => entry.message === message);
      return (
        index > finishedAt.index &&
        text.includes("grp.helm.state.committed") &&
        text.includes('"phase":"idle"')
      );
    }, 30_000);

    const after = resultOf(await call(raw, "ext.helm.status", { threadId }));
    expect(after).toMatchObject({ enabled: true, phase: "idle", lease: "none" });
    const listed = resultOf(await call(raw, "ext.helm.inquiries", { threadId }));
    const inquiries = listed["inquiries"];
    expect(Array.isArray(inquiries)).toBe(true);
    if (!Array.isArray(inquiries)) throw new Error("inquiries is not a list");
    expect(inquiries).toHaveLength(1);
    expect(inquiries[0]).toMatchObject({
      topic: "캐시 무효화",
      status: "finished",
      outcome: "applied",
      findingCount: 3,
    });
    const inquiryId = isRecord(inquiries[0]) ? inquiries[0]["inquiryId"] : undefined;
    const found = resultOf(await call(raw, "ext.helm.findings", { threadId, inquiryId }));
    expect(found["inquiryId"]).toBe(inquiryId);
    const findings = found["findings"];
    if (!Array.isArray(findings)) throw new Error("findings is not a list");
    // 렌즈 셋이 동시에 돌아 발견이 쌓이는 순서는 정해져 있지 않다: 집합으로 비교한다
    expect(
      findings.map((item) => (isRecord(item) ? String(item["claim"]) : "")).toSorted(),
    ).toEqual(["관점 둘", "관점 셋", "관점 하나"].toSorted());

    // 모르는 탐구의 발견은 빈 목록이다
    expect(
      resultOf(await call(raw, "ext.helm.findings", { threadId, inquiryId: "hnotinquiry234" })),
    ).toEqual({ inquiryId: "hnotinquiry234", findings: [] });

    await raw.close();
    await host.close();
    home.dispose();
  },
  90_000,
);
