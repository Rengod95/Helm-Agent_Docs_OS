import { describe, expect, test } from "bun:test";
import type { WireResult } from "@fresnel/contracts/wire";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until } from "./support.ts";

// 충돌 스킬 본문(`commands.skills.view`, W-14)을 가짜 엔진 위에서 돌린다. 이름과 근거 대화가 정확히 나가는지, 입력 거절이
// "찾지 못함"으로, 기능 없음이 "꺼짐"으로 바뀌는지 본다. 값은 `toEqual`로 비교한다.

const THREAD = "thr_00000000000000000000000001";

const VIEW: WireResult<"knowledge.skills.view"> = {
  name: "cache-debug-old",
  scope: "project",
  description: "캐시 만료를 디버깅한다",
  body: "1. 단위를 확인한다",
  bodyTruncated: true,
  files: ["references/notes.md"],
  treeHash: "c".repeat(64),
};

async function liveApp(extra: Parameters<typeof engineFake>[2]) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.find((entry) => entry.method === method)?.params;

describe("knowledge.skills.view", () => {
  test("the name goes out alone, and the host's body comes back with its truncation flag", async () => {
    const { app, params } = await liveApp({ results: { "knowledge.skills.view": VIEW } });
    const viewed = await app.commands.skills.view("cache-debug-old");
    expect(paramsOf(params, "knowledge.skills.view")).toEqual({ name: "cache-debug-old" });
    expect(viewed).toEqual({ ok: true, value: VIEW });
    await app.stop();
  });

  test("a conversation's id goes with the name, so a project skill is looked up in its workspace", async () => {
    const { app, params } = await liveApp({ results: { "knowledge.skills.view": VIEW } });
    await app.commands.skills.view("cache-debug-old", THREAD);
    expect(paramsOf(params, "knowledge.skills.view")).toEqual({
      name: "cache-debug-old",
      threadId: THREAD,
    });
    await app.stop();
  });

  test("a name the host does not know comes back as not_found, not as a read failure", async () => {
    const { app } = await liveApp({
      errors: {
        "knowledge.skills.view": {
          code: -32602,
          kind: "jsonrpc.invalidParams",
          details: { issues: [{ path: "name", message: "unknown skill" }] },
        },
      },
    });
    expect(await app.commands.skills.view("gone")).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    await app.stop();
  });

  test("another input the host rejects stays a rejected command, with the input's name", async () => {
    const { app } = await liveApp({
      errors: {
        "knowledge.skills.view": {
          code: -32602,
          kind: "jsonrpc.invalidParams",
          details: { issues: [{ path: "threadId", message: "bad thread" }] },
        },
      },
    });
    expect(await app.commands.skills.view("cache-debug-old", THREAD)).toEqual({
      ok: false,
      error: { kind: "rejected", code: -32602, path: "threadId" },
    });
    await app.stop();
  });

  test("a host without the skills feature gives unsupported", async () => {
    const { app } = await liveApp({
      errors: { "knowledge.skills.view": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    expect(await app.commands.skills.view("cache-debug-old")).toEqual({
      ok: false,
      error: { kind: "unsupported" },
    });
    await app.stop();
  });
});
