import { expect, test } from "bun:test";
import {
  isCapabilityError,
  type CallOptions,
  type ServiceKey,
} from "@fresnel/contracts/capabilities";
import type { ExtMethodDecl } from "@fresnel/contracts/extensions";
import { hostOf } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { echoDefs, makeUnit, rejectionOf } from "./fixtures/support.ts";

// `readOnly: true`로 선언한 확장 메서드는 쓰기 위험 기능을 부를 수 없다(ADR-0021 §3.4.2: `query`는 확인 없이 지나가므로 엔진이 선언을 지킨다)

interface Svc {
  echo(input: { text?: string }, options?: CallOptions): Promise<string>;
  peek(input: { text?: string }, options?: CallOptions): Promise<string>;
  poke(input: { text?: string }, options?: CallOptions): Promise<string>;
}
const svcKey: ServiceKey<Svc> = { capability: "demo.echo", version: "1.0.0" };

function decl(verb: string, readOnly: boolean): ExtMethodDecl {
  return { verb, params: {}, result: {}, readOnly };
}

async function codeOf(run: () => unknown): Promise<string> {
  const failure = await rejectionOf(run);
  if (failure === undefined) return "ok";
  return isCapabilityError(failure) ? failure.data.code : "not_capability_error";
}

test("a readOnly method cannot reach a write capability, a writable method can", async () => {
  const t = await createTestHost({ capabilityDefs: echoDefs });
  const effects: string[] = [];
  await t.host.install(
    makeUnit({ name: "ro-provider", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(svcKey, {
        echo: () => {
          effects.push("echo");
          return Promise.resolve("ok");
        },
        peek: () => Promise.resolve("peeked"),
        poke: () => {
          effects.push("poke");
          return Promise.resolve("poked");
        },
      });
    }),
  );
  const codes: Record<string, string> = {};
  await t.host.install(
    makeUnit(
      {
        name: "ro-caller",
        loadIndex: 1,
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
        methods: [decl("look", true), decl("change", false)],
      },
      (g) => {
        const api = hostOf(g);
        api.registerMethod("look", {
          handler: async () => {
            const svc = g.capability(svcKey);
            codes.lookRead = await codeOf(() => svc.peek({}));
            codes.lookWrite = await codeOf(() => svc.poke({}));
            codes.lookKeyed = await codeOf(() => svc.echo({}, { requestId: "ro:1" }));
            return null;
          },
        });
        api.registerMethod("change", {
          handler: async () => {
            const svc = g.capability(svcKey);
            codes.changeWrite = await codeOf(() => svc.poke({}));
            return null;
          },
        });
      },
    ),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  const call = (verb: string) =>
    t.host.methods.call({
      extension: "ro-caller",
      verb,
      params: {},
      threadId: thread,
      signal: new AbortController().signal,
      caller: "ui",
    });
  await call("look");
  await call("change");
  expect(codes).toEqual({
    lookRead: "ok",
    lookWrite: "effect_not_allowed",
    lookKeyed: "effect_not_allowed",
    changeWrite: "ok",
  });
  expect(effects).toEqual(["poke"]);
});
