import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import { WIRE_METHODS } from "../../src/wire-settings/wire/index.ts";
import {
  CraftChatListParamsSchema,
  CraftChatListResultSchema,
  CraftChatOpenParamsSchema,
  CraftChatOpenResultSchema,
} from "../../src/wire-settings/wire/methods.ts";

// M5c §3.6, §4.8.10: craftChat.open와 craftChat.list의 모양. 처리기는 apps/host가 시험한다.

const THREAD_ID = "thr_01HZX0000000000000000000ZZ";

function accepts(schema: TSchema, value: unknown): unknown {
  const result = parse(schema, value);
  return result.ok ? "ok" : result.error.kind;
}

describe("craftChat wire methods", () => {
  test("both methods are registered at stage M5 with their schemas", () => {
    expect(WIRE_METHODS["craftChat.open"].stage).toBe("M5");
    expect(WIRE_METHODS["craftChat.list"].stage).toBe("M5");
    expect(WIRE_METHODS["craftChat.open"].params).toBeDefined();
  });

  test("open takes plugin as a name or null; reuse and intent are optional and closed", () => {
    expect(accepts(CraftChatOpenParamsSchema, { plugin: null })).toBe("ok");
    expect(accepts(CraftChatOpenParamsSchema, { plugin: "notes-helper", reuse: "last" })).toBe(
      "ok",
    );
    expect(
      accepts(CraftChatOpenParamsSchema, { plugin: "notes", reuse: "new", intent: "fix" }),
    ).toBe("ok");
    // 플러그인 이름은 폴더 이름이 되므로 확장 이름 문법을 따른다
    expect(accepts(CraftChatOpenParamsSchema, { plugin: "../escape" })).not.toBe("ok");
    expect(accepts(CraftChatOpenParamsSchema, { plugin: "a/b" })).not.toBe("ok");
    expect(accepts(CraftChatOpenParamsSchema, { plugin: "notes", reuse: "first" })).not.toBe("ok");
    expect(accepts(CraftChatOpenParamsSchema, {})).not.toBe("ok");
    expect(accepts(CraftChatOpenParamsSchema, { plugin: null, extra: 1 })).not.toBe("ok");
  });

  test("open's result carries threadId, the plugin (or null) and reused", () => {
    const ok = { threadId: THREAD_ID, plugin: "notes", reused: true };
    expect(accepts(CraftChatOpenResultSchema, ok)).toBe("ok");
    expect(accepts(CraftChatOpenResultSchema, { ...ok, plugin: null })).toBe("ok");
    expect(accepts(CraftChatOpenResultSchema, { threadId: THREAD_ID, plugin: null })).not.toBe(
      "ok",
    );
  });

  test("list requires the plugin key (null lists the unbound ones) and returns threads", () => {
    expect(accepts(CraftChatListParamsSchema, { plugin: null })).toBe("ok");
    expect(accepts(CraftChatListParamsSchema, { plugin: "notes" })).toBe("ok");
    expect(accepts(CraftChatListParamsSchema, {})).not.toBe("ok");
    expect(accepts(CraftChatListResultSchema, { threads: [] })).toBe("ok");
    expect(accepts(CraftChatListResultSchema, {})).not.toBe("ok");
  });
});
