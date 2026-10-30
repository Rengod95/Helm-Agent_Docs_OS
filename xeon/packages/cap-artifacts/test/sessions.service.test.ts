import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { codeOf } from "./support/assert.ts";
import { openSessions, type SessionsHarness } from "./support/harness.ts";

// 저장소를 여는 시험은 첫 실행에서 기본 5초를 넘긴 적이 있어 시간 상한을 넓힌다.
setDefaultTimeout(20_000);

let opened: SessionsHarness | undefined;

async function harness(): Promise<SessionsHarness> {
  opened = await openSessions();
  return opened;
}

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

/**
 * 시험 세션 넷. 처음 대화(home)는 제목과 작업 공간이 없다. A, B, C는 이 순서로 만든다.
 * 라벨은 C, B, A 순서로 붙여서 최근 갱신 순(A, B, C)과 만든 순(C, B, A)이 서로 다르다.
 * A에는 산출물 하나가 있다.
 */
async function seedSessions(
  h: SessionsHarness,
): Promise<{ a: ThreadId; b: ThreadId; c: ThreadId }> {
  h.advance(10);
  const a = h.newThread({ title: "Alpha", workspace: "/w/one" });
  h.advance(10);
  const b = h.newThread({ title: "Beta", workspace: "/w/two" });
  h.advance(10);
  const c = h.newThread({ title: "Gamma", workspace: "/w/one" });
  h.advance(10);
  await h.api.setMeta({ threadId: c, labels: { set: ["urgent"] } }, h.opts("seed-c"));
  h.advance(10);
  await h.api.setMeta({ threadId: b, labels: { set: ["plan"] } }, h.opts("seed-b"));
  h.advance(10);
  await h.registry.register(
    {
      kind: "document",
      title: "Doc",
      content: { type: "inline", text: "doc\n", mediaType: "text/markdown" },
    },
    h.opts("seed-art", { contextThread: a }),
  );
  await h.api.setMeta({ threadId: a, labels: { set: ["plan", "urgent"] } }, h.opts("seed-a"));
  return { a, b, c };
}

describe("setMeta", () => {
  test("a title and a label set come back in the view, and the labels are one event", async () => {
    const h = await harness();
    h.advance(5);
    const view = await h.api.setMeta(
      { title: "Plan", labels: { set: ["alpha", "베타"] } },
      h.opts("meta-1"),
    );
    const [started] = await h.events(h.threadId, "thread.started");
    const labelEvents = await h.events(h.threadId, "artifact.session_labeled");

    expect(view).toEqual({
      threadId: h.threadId,
      title: "Plan",
      titleSource: "user",
      labels: ["alpha", "베타"],
      workspace: null,
      artifactCount: 0,
      handoffFrom: null,
      createdAt: started?.recordedAt ?? -1,
      updatedAt: labelEvents[0]?.recordedAt ?? -1,
    });
    expect(labelEvents.map((event) => event.payload)).toEqual([{ labels: ["alpha", "베타"] }]);
  });

  test("set keeps the first of each duplicate, add appends new labels once, remove drops the listed ones", async () => {
    const h = await harness();
    const set = await h.api.setMeta({ labels: { set: ["a", "b", "a"] } }, h.opts("m1"));
    expect(set.labels).toEqual(["a", "b"]);

    const added = await h.api.setMeta({ labels: { add: ["b", "c", "c", "d"] } }, h.opts("m2"));
    expect(added.labels).toEqual(["a", "b", "c", "d"]);

    const removed = await h.api.setMeta({ labels: { remove: ["a", "zz"] } }, h.opts("m3"));
    expect(removed.labels).toEqual(["b", "c", "d"]);
  });

  test("labels are NFC normalized and trimmed before they are stored", async () => {
    const h = await harness();
    const view = await h.api.setMeta({ labels: { set: [" é "] } }, h.opts("m1"));
    expect(view.labels).toEqual(["é"]);
  });

  test("a label change that changes nothing writes no event", async () => {
    const h = await harness();
    await h.api.setMeta({ labels: { set: ["a"] } }, h.opts("m1"));
    await h.api.setMeta({ labels: { set: ["a"] } }, h.opts("m2"));
    await h.api.setMeta({ labels: { add: ["a"] } }, h.opts("m3"));
    await h.api.setMeta({ labels: { remove: ["zz"] } }, h.opts("m4"));
    await h.api.setMeta({}, h.opts("m5"));

    expect(await h.events(h.threadId, "artifact.session_labeled")).toHaveLength(1);
  });

  test("more than 32 labels is refused with too_many_labels and writes nothing", async () => {
    const h = await harness();
    const thirtyTwo = Array.from({ length: 32 }, (_, index) => `l${index}`);
    await h.api.setMeta({ labels: { set: thirtyTwo } }, h.opts("m1"));

    expect(await codeOf(h.api.setMeta({ labels: { add: ["extra"] } }, h.opts("m2")))).toBe(
      "too_many_labels",
    );
    const thirtyThree = Array.from({ length: 33 }, (_, index) => `s${index}`);
    expect(await codeOf(h.api.setMeta({ labels: { set: thirtyThree } }, h.opts("m3")))).toBe(
      "too_many_labels",
    );

    const view = await h.api.setMeta({}, h.opts("m4"));
    expect(view.labels).toEqual(thirtyTwo);
    expect(await h.events(h.threadId, "artifact.session_labeled")).toHaveLength(1);
  });

  test("an unknown session is not_found and nothing is written", async () => {
    const h = await harness();
    const unknown = h.ids.next("thr");

    expect(
      await codeOf(
        h.api.setMeta({ threadId: unknown, title: "X", labels: { add: ["a"] } }, h.opts("m1")),
      ),
    ).toBe("not_found");
    expect(h.titleCalls).toEqual([]);
  });

  test("a tool call may not change another session", async () => {
    const h = await harness();
    const other = h.newThread({ title: "Other" });

    expect(
      await codeOf(
        h.api.setMeta({ threadId: other, title: "Hijack" }, h.opts("t1", { toolCallId: "call-1" })),
      ),
    ).toBe("denied");
    expect(h.titleCalls).toEqual([]);
    expect(await h.events(other, "thread.updated")).toEqual([]);
  });

  test("a tool call on its own session sets the title with the model as the source", async () => {
    const h = await harness();
    const view = await h.api.setMeta({ title: "By model" }, h.opts("t1", { toolCallId: "call-1" }));
    expect({ title: view.title, titleSource: view.titleSource }).toEqual({
      title: "By model",
      titleSource: "model",
    });
  });

  test("the title goes through threads.setTitle with a retitle key, and no label event is written for it", async () => {
    const h = await harness();
    const view = await h.api.setMeta({ title: "Plan" }, h.opts("req-title"));

    expect(h.titleCalls).toEqual([
      { threadId: h.threadId, title: "Plan", requestKey: "retitle:req-title" },
    ]);
    expect((await h.events(h.threadId, "thread.updated")).map((event) => event.payload)).toEqual([
      { title: "Plan" },
    ]);
    expect(await h.events(h.threadId, "artifact.session_labeled")).toEqual([]);
    expect(view.title).toBe("Plan");
  });

  test("a retry with the same requestId writes nothing new and returns the same view", async () => {
    const h = await harness();
    const input = { title: "Plan", labels: { add: ["a"] } };
    const first = await h.api.setMeta(input, h.opts("same"));
    const second = await h.api.setMeta(input, h.opts("same"));

    expect(second).toEqual(first);
    expect(await h.events(h.threadId, "artifact.session_labeled")).toHaveLength(1);
    expect(await h.events(h.threadId, "thread.updated")).toHaveLength(1);
  });

  test("the same requestId with other labels is refused as internal and logged", async () => {
    const h = await harness();
    await h.api.setMeta({ labels: { add: ["a"] } }, h.opts("same"));

    expect(await codeOf(h.api.setMeta({ labels: { add: ["b"] } }, h.opts("same")))).toBe(
      "internal",
    );
    expect(h.logs.map((line) => line.event)).toContain("artifacts.sessions_key_reused");
    expect((await h.api.setMeta({}, h.opts("read"))).labels).toEqual(["a"]);
  });

  test("a write without a requestId is invalid_input", async () => {
    const h = await harness();
    expect(await codeOf(h.api.setMeta({ title: "Plan" }, h.opts("")))).toBe("invalid_input");
  });
});

describe("list", () => {
  test("the default order is the latest update first, and the cursor pages through every session", async () => {
    const h = await harness();
    const { a, b, c } = await seedSessions(h);

    const first = await h.api.list({ limit: 2 }, h.opts());
    expect(first.items.map((item) => item.threadId)).toEqual([a, b]);
    expect(first.nextCursor).toBe("2");

    const second = await h.api.list(
      { limit: 2, ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }) },
      h.opts(),
    );
    expect(second.items.map((item) => item.threadId)).toEqual([c, h.threadId]);
    expect(second.nextCursor).toBeNull();
  });

  test("the created order lists the newest sessions first", async () => {
    const h = await harness();
    const { a, b, c } = await seedSessions(h);

    const page = await h.api.list({ order: "created" }, h.opts());
    expect(page.items.map((item) => item.threadId)).toEqual([c, b, a, h.threadId]);
  });

  test("a label filter needs every requested label, and matches exactly", async () => {
    const h = await harness();
    const { a, b } = await seedSessions(h);

    expect(
      (await h.api.list({ labels: ["plan"] }, h.opts())).items.map((item) => item.threadId),
    ).toEqual([a, b]);
    expect(
      (await h.api.list({ labels: ["plan", "urgent"] }, h.opts())).items.map(
        (item) => item.threadId,
      ),
    ).toEqual([a]);
    expect((await h.api.list({ labels: ["Plan"] }, h.opts())).items).toEqual([]);
  });

  test("a workspace filter keeps only the sessions in that workspace", async () => {
    const h = await harness();
    const { a, c } = await seedSessions(h);

    const page = await h.api.list({ workspace: "/w/one" }, h.opts());
    expect(page.items.map((item) => item.threadId)).toEqual([a, c]);
  });

  test("a listed session shows its title, labels, workspace, artifact count and times", async () => {
    const h = await harness();
    const { a } = await seedSessions(h);
    const [started] = await h.events(a, "thread.started");
    const [latest] = (await h.events(a, "artifact.session_labeled")).toReversed();

    const page = await h.api.list({ workspace: "/w/one" }, h.opts());
    expect(page.items[0]).toEqual({
      threadId: a,
      title: "Alpha",
      titleSource: "user",
      labels: ["plan", "urgent"],
      workspace: "/w/one",
      artifactCount: 1,
      handoffFrom: null,
      createdAt: started?.recordedAt ?? -1,
      updatedAt: latest?.recordedAt ?? -1,
    });
  });

  test("a cursor that is not a number is invalid_input", async () => {
    const h = await harness();
    expect(await codeOf(h.api.list({ cursor: "x1" }, h.opts()))).toBe("invalid_input");
  });
});

describe("search", () => {
  test("a query matches titles without regard to ASCII case", async () => {
    const h = await harness();
    const { a, b, c } = await seedSessions(h);

    expect(
      (await h.api.search({ query: "ALPHA" }, h.opts())).items.map((item) => item.threadId),
    ).toEqual([a]);
    expect(
      (await h.api.search({ query: "gam" }, h.opts())).items.map((item) => item.threadId),
    ).toEqual([c]);
    expect(
      (await h.api.search({ query: "beta" }, h.opts())).items.map((item) => item.threadId),
    ).toEqual([b]);
  });

  test("a query matches labels too", async () => {
    const h = await harness();
    const { a, c } = await seedSessions(h);

    expect(
      (await h.api.search({ query: "urg" }, h.opts())).items.map((item) => item.threadId),
    ).toEqual([a, c]);
  });

  test("a label filter in search needs every label as well", async () => {
    const h = await harness();
    const { a } = await seedSessions(h);

    expect(
      (await h.api.search({ query: "plan", labels: ["urgent"] }, h.opts())).items.map(
        (item) => item.threadId,
      ),
    ).toEqual([a]);
  });

  test("the limit keeps the most recently updated matches", async () => {
    const h = await harness();
    const { a, b } = await seedSessions(h);

    expect(
      (await h.api.search({ query: "e", limit: 2 }, h.opts())).items.map((item) => item.threadId),
    ).toEqual([a, b]);
  });
});
