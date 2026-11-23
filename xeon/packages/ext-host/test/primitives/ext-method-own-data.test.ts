import { expect, test } from "bun:test";
import {
  isCapabilityError,
  type CallOptions,
  type ServiceKey,
} from "@fresnel/contracts/capabilities";
import type { ExtMethodDecl } from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import { hostOf, PrimitiveError } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { echoDefs, makeUnit, rejectionOf } from "./fixtures/support.ts";

// `ownDataOnly: true`로 선언한 쓰기 메서드는 자기 상태와 기록만 바꾼다(pgRe §4.2 3번). 다른 확장이나 대화에 닿는 길은 엔진이 막는다

interface Svc {
  echo(input: { text?: string }, options?: CallOptions): Promise<string>;
  peek(input: { text?: string }, options?: CallOptions): Promise<string>;
  poke(input: { text?: string }, options?: CallOptions): Promise<string>;
}
const svcKey: ServiceKey<Svc> = { capability: "demo.echo", version: "1.0.0" };

function decl(verb: string, ownDataOnly: boolean): ExtMethodDecl {
  return { verb, params: {}, result: {}, readOnly: false, ...(ownDataOnly ? { ownDataOnly } : {}) };
}

function primitiveCodeOf(run: () => Promise<unknown>): Promise<string> {
  return rejectionOf(run).then((failure) =>
    failure === undefined
      ? "ok"
      : failure instanceof PrimitiveError
        ? failure.code
        : "not_primitive_error",
  );
}

async function capabilityCodeOf(run: () => unknown): Promise<string> {
  const failure = await rejectionOf(run);
  if (failure === undefined) return "ok";
  if (failure instanceof PrimitiveError) return failure.code;
  return isCapabilityError(failure) ? failure.data.code : "not_capability_error";
}

test("an ownDataOnly method can commit its own state but not post, call a capability, or start a drive; an unmarked write can", async () => {
  const t = await createTestHost({ capabilityDefs: echoDefs });
  const effects: string[] = [];
  await t.host.install(
    makeUnit({ name: "od-provider", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
      hostOf(g).provide(svcKey, {
        echo: () => Promise.resolve("ok"),
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
        name: "od-writer",
        loadIndex: 1,
        usesPost: true,
        requires: [{ id: "demo.echo", range: "^1.0.0" }],
        methods: [decl("own", true), decl("plain", false)],
        def: {
          state: { schema: Type.Object({ n: Type.Integer() }), initial: { n: 0 }, version: 1 },
        },
      },
      (g) => {
        const api = hostOf(g);
        const svc = g.capability(svcKey);
        api.registerMethod("own", {
          handler: async () => {
            codes.ownCommit = await primitiveCodeOf(() => g.commit({ n: 1 }));
            codes.ownPost = await primitiveCodeOf(() =>
              Promise.resolve(
                g.post({ kind: "user", content: "hi" }, { when: "followUp", requestId: "od:post" }),
              ),
            );
            codes.ownCapability = await capabilityCodeOf(() => svc.poke({}));
            codes.ownCapabilityLookup = await primitiveCodeOf(() =>
              Promise.resolve(g.capability(svcKey)),
            );
            codes.ownDrive = await primitiveCodeOf(() => api.startDrive());
            return null;
          },
        });
        api.registerMethod("plain", {
          handler: async () => {
            codes.plainCommit = await primitiveCodeOf(() => g.commit({ n: 2 }));
            codes.plainCapability = await capabilityCodeOf(() => svc.poke({}));
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
      extension: "od-writer",
      verb,
      params: {},
      threadId: thread,
      signal: new AbortController().signal,
      caller: "ui",
    });
  await call("own");
  await call("plain");
  expect(codes.ownCommit).toBe("ok");
  expect(codes.ownPost).toBe("own_data_method");
  expect(codes.ownCapability).toBe("effect_not_allowed");
  expect(codes.ownCapabilityLookup).toBe("own_data_method");
  expect(codes.ownDrive).toBe("own_data_method");
  expect(codes.plainCommit).toBe("ok");
  expect(codes.plainCapability).toBe("ok");
  expect(effects).toEqual(["poke"]);
});
