import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { PostReceipt } from "@xeon/contracts/extensions";
import { PrimitiveError } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { makeUnit } from "./fixtures/support.ts";

async function setup(options: Parameters<typeof createTestHost>[0] = {}) {
  const t = await createTestHost(options);
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, thread };
}

function fire(t: Awaited<ReturnType<typeof createTestHost>>, thread: ThreadId, key: string) {
  return t.host.dispatch(
    "agent_settled",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}

test("duplicate requestId", async () => {
  const { t, thread } = await setup();
  const receipts: PostReceipt[] = [];
  await t.host.install(
    makeUnit({ name: "post-dup", points: ["agent_settled"], usesPost: true }, (g) => {
      g.on("agent_settled", async () => {
        receipts.push(
          await g.post({ kind: "user", content: "hi" }, { when: "followUp", requestId: "same" }),
        );
      });
    }),
  );
  await fire(t, thread, "k1");
  await fire(t, thread, "k2");
  expect(receipts).toEqual([
    { requestId: "same", duplicate: false },
    { requestId: "same", duplicate: true },
  ]);
  expect(t.queue.items.length).toBe(1);
  expect(t.queue.items[0]).toMatchObject({
    scopeId: "post-dup",
    when: "followUp",
    threadId: thread,
  });
});

test("post requires usesPost", async () => {
  const { t, thread } = await setup();
  const errors: unknown[] = [];
  await t.host.install(
    makeUnit({ name: "post-undeclared", points: ["agent_settled"] }, (g) => {
      g.on("agent_settled", async () => {
        try {
          await g.post({ kind: "user", content: "hi" }, { when: "next", requestId: "x" });
        } catch (error) {
          errors.push(error);
        }
      });
    }),
  );
  await fire(t, thread, "k1");
  expect(errors[0]).toBeInstanceOf(PrimitiveError);
  expect(errors[0] instanceof PrimitiveError && errors[0].code).toBe("post_undeclared");
  expect(t.queue.items.length).toBe(0);
});

test("post scoped by scope", async () => {
  const { t, thread } = await setup();
  const receipts: string[] = [];
  await eachInOrder(
    [
      ["post-one", 0],
      ["post-two", 1],
    ] as const,
    async ([name, loadIndex]) => {
      await t.host.install(
        makeUnit({ name, points: ["agent_settled"], usesPost: true, loadIndex }, (g) => {
          g.on("agent_settled", async () => {
            const receipt = await g.post(
              { kind: "user", content: "hi" },
              { when: "steer", requestId: "shared" },
            );
            receipts.push(`${name}:${receipt.duplicate}`);
          });
        }),
      );
      return "continue";
    },
  );
  await fire(t, thread, "k1");
  expect(receipts).toEqual(["post-one:false", "post-two:false"]);
  expect(t.queue.items.length).toBe(2);
});

test("post outside a thread context is no_thread, and a bad requestId is a TypeError", async () => {
  const { t, thread } = await setup();
  const outcome = await t.host.install(
    makeUnit({ name: "post-setup", points: ["agent_settled"], usesPost: true }, async (g) => {
      await g.post({ kind: "user", content: "hi" }, { when: "next", requestId: "x" });
    }),
  );
  expect(outcome.setups[0]?.status).toBe("failed");
  expect(outcome.setups[0]?.failure?.code).toBe("no_thread");

  const errors: unknown[] = [];
  await t.host.install(
    makeUnit({ name: "post-badid", points: ["agent_settled"], usesPost: true }, (g) => {
      g.on("agent_settled", async () => {
        try {
          await g.post({ kind: "user", content: "hi" }, { when: "next", requestId: "" });
        } catch (error) {
          errors.push(error);
        }
      });
    }),
  );
  await fire(t, thread, "k1");
  expect(errors[0]).toBeInstanceOf(TypeError);
});

test("post without the queue port is port_unavailable", async () => {
  const { t, thread } = await setup({ without: ["queue"] });
  const errors: unknown[] = [];
  await t.host.install(
    makeUnit({ name: "post-noport", points: ["agent_settled"], usesPost: true }, (g) => {
      g.on("agent_settled", async () => {
        try {
          await g.post({ kind: "user", content: "hi" }, { when: "next", requestId: "x" });
        } catch (error) {
          errors.push(error);
        }
      });
    }),
  );
  await fire(t, thread, "k1");
  expect(errors[0] instanceof PrimitiveError && errors[0].code).toBe("port_unavailable");
});
