import { describe, expect, test } from "bun:test";
import { actorOf } from "../src/actor.ts";

// L2.knowledge.spec §3.1: 행위자는 호출 문맥의 caller에서 만든다. 문맥이 없는 호출은 행위자를 정할 수 없어 거부한다.
describe("actorOf", () => {
  test("a call without a caller context is denied", () => {
    const actor = actorOf(undefined);
    expect(actor.ok).toBe(false);
    expect(actor.ok ? undefined : actor.error.kind).toBe("denied");
  });

  test("the capability wrapper's extension caller becomes an extension actor", () => {
    const actor = actorOf({ caller: { kind: "extension", extension: "kn-consumer" } });
    expect(actor).toEqual({ ok: true, value: { kind: "extension", extension: "kn-consumer" } });
  });
});
