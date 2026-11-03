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

// T-UIPOST(HS-108): 조립된 호스트에서 설치된 Helm 확장의 화면(`helm-panel`)이 실제 wire로 `ext.ui.post`와 `ext.ui.requestApproval`을 부른다.
// post는 입력 큐에 닿고, 승인은 `ext:helm` 출처의 카드로 떠서 `approval.respond`로 풀리며, 거절은 정해진 오류로 돌아온다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

let bundleRoot: string;

beforeAll(async () => {
  bundleRoot = mkdtempSync(join(tmpdir(), "ext-ui-post-bundle-"));
  const built = await buildHelmPlugin(join(bundleRoot, "helm"));
  if (!built.ok) throw new Error(`plugin build failed: ${built.error.kind}`);
}, 60_000);

afterAll(() => {
  rmSync(bundleRoot, { recursive: true, force: true });
});

const ids = { next: 0 };

async function call(
  raw: RawClient,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  ids.next += 1;
  const id = `u${ids.next}`;
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

/** 오류 응답의 코드와 kind. 오류가 아니면 시험이 실패한다 */
function errorOf(reply: Record<string, unknown>): { code: unknown; kind: unknown } {
  const error = reply["error"];
  if (!isRecord(error)) throw new Error(`no error: ${JSON.stringify(reply)}`);
  const data = error["data"];
  return { code: error["code"], kind: isRecord(data) ? data["kind"] : undefined };
}

/** 모델 응답은 post가 낸 대기 입력이 턴을 시작할 때를 위한 여유분이다 */
function spare(): ReturnType<typeof tapePlayer> {
  return tapePlayer(
    tape("ext-ui-post", [
      {
        role: "main" as const,
        label: "spare",
        response: {
          type: "message" as const,
          content: [t.text("받았습니다.")],
          stopReason: "stop" as const,
        },
      },
    ]),
    { clock: realTapeClock() },
  );
}

realTest(
  "ext.ui.post reaches the input queue, ext.ui.requestApproval opens a card from ext:helm that resolves, and refusals are typed",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultPluginsDir: bundleRoot,
      buildModels: tapeBuildModels(tapeProvider(spare())),
    });
    const raw = rawClient(host.client);
    await call(raw, "host.hello", { ...HELLO_PARAMS });
    await call(raw, "events.subscribe", { from: "head" });
    const threadId = resultOf(await call(raw, "thread.create", {}))["threadId"];
    const post = { extension: "helm", ui: "helm-panel", threadId, name: "refresh" };

    // post: 받아들여지고 입력 큐 이벤트가 남는다. 같은 requestId의 두 번째 호출도 받아들이되 큐에는 한 번만 들어간다
    const keyed = { ...post, payload: { n: 1 }, requestId: "r-1" };
    expect(resultOf(await call(raw, "ext.ui.post", keyed))).toEqual({ accepted: true });
    expect(resultOf(await call(raw, "ext.ui.post", keyed))).toEqual({ accepted: true });
    await raw.waitFor((message) => {
      const text = JSON.stringify(message);
      return text.includes("input.queued") && text.includes("x.helm.ui.refresh");
    }, 30_000);
    const queued = raw.received.filter((entry) => {
      const text = JSON.stringify(entry.message);
      return text.includes("input.queued") && text.includes("x.helm.ui.refresh");
    });
    expect(queued).toHaveLength(1);

    // requestApproval: 카드가 뜨고 출처는 ext:helm이다. 같은 requestId는 같은 승인이다
    const ask = {
      extension: "helm",
      ui: "helm-panel",
      threadId,
      method: "status",
      requestId: "a-1",
    };
    const approvalId = resultOf(await call(raw, "ext.ui.requestApproval", ask))["approvalId"];
    expect(typeof approvalId).toBe("string");
    expect(resultOf(await call(raw, "ext.ui.requestApproval", ask))["approvalId"]).toBe(approvalId);
    const listed = resultOf(await call(raw, "approval.list", { threadId }));
    const approvals = listed["approvals"];
    if (!Array.isArray(approvals)) throw new Error("approvals is not a list");
    const mine = approvals.filter((item) => isRecord(item) && item["approvalId"] === approvalId);
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine[0])).toContain('"caller":"ext:helm"');
    const answered = resultOf(
      await call(raw, "approval.respond", {
        approvalId,
        decision: "answer",
        answer: { decision: { selected: ["allow"] } },
      }),
    );
    expect(answered).toEqual({ applied: true });
    await raw.waitFor((message) => {
      const text = JSON.stringify(message);
      return text.includes("approval.resolved") && text.includes(String(approvalId));
    }, 30_000);

    // 거절: 열려 있지 않은 대화, 없는 확장, 선언하지 않은 화면과 메서드, threadId 없음
    const stranger = "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    expect(errorOf(await call(raw, "ext.ui.post", { ...post, threadId: stranger }))).toEqual({
      code: 3001,
      kind: "thread.notFound",
    });
    expect(errorOf(await call(raw, "ext.ui.post", { ...post, extension: "nosuch" }))).toEqual({
      code: 3401,
      kind: "extension.notFound",
    });
    expect(errorOf(await call(raw, "ext.ui.post", { ...post, ui: "nosuch" }))).toEqual({
      code: -32602,
      kind: "jsonrpc.invalidParams",
    });
    expect(errorOf(await call(raw, "ext.ui.post", { ...post, name: "Bad Name" }))).toEqual({
      code: -32602,
      kind: "jsonrpc.invalidParams",
    });
    expect(
      errorOf(await call(raw, "ext.ui.requestApproval", { ...ask, method: "nosuch" })),
    ).toEqual({
      code: -32602,
      kind: "jsonrpc.invalidParams",
    });
    const { threadId: _omitted, ...withoutThread } = post;
    expect(errorOf(await call(raw, "ext.ui.post", withoutThread))).toEqual({
      code: -32602,
      kind: "jsonrpc.invalidParams",
    });

    await raw.close();
    await host.close();
    home.dispose();
  },
  90_000,
);
