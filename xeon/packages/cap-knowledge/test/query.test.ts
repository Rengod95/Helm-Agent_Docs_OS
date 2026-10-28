import { afterEach, describe, expect, test } from "bun:test";
import { eachAsync } from "@xeon/contracts";
import {
  clipSnippet,
  likeSnippet,
  normalizeQuery,
  queryPath,
  toLikePattern,
  toMatchExpression,
  tokenizeQuery,
} from "../src/search/query-model.ts";
import { asHost, rejection } from "./support/helpers.ts";
import {
  closeWorlds,
  createWorld,
  putSkill,
  USER_SKILLS,
  userLayer,
  type World,
} from "./support/world.ts";

afterEach(closeWorlds);

function byText(a: string | undefined, b: string | undefined): number {
  if (a === undefined || b === undefined) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}

const KIT = (world: World) => {
  if (world.sessions === undefined) throw new Error("world has no sessions");
  return world.sessions;
};

async function seedConversation(world: World) {
  const kit = KIT(world);
  const threadId = kit.newThread({ title: "Korean notes", workspace: "/work/alpha" });
  kit.say(threadId, "user", "검색을 위한 색인을 만든다");
  world.clock.advance(1000);
  kit.say(threadId, "assistant", "색인은 trigram 방식으로 만들었다");
  await world.settleIndex();
  return threadId;
}

describe("query model", () => {
  test("tokens and phrases", () => {
    expect(tokenizeQuery(normalizeQuery('  foo "bar baz" qux  ')).tokens).toEqual([
      "foo",
      "bar baz",
      "qux",
    ]);
    expect(tokenizeQuery('"unterminated phrase').tokens).toEqual(["unterminated phrase"]);
    expect(tokenizeQuery('"" a').tokens).toEqual(["a"]);
    expect(tokenizeQuery("   ").tokens).toEqual([]);
  });

  test("the path follows the shortest token in code points", () => {
    expect(queryPath(["검색을"])).toBe("fts");
    expect(queryPath(["검색"])).toBe("like");
    expect(queryPath(["abc", "de"])).toBe("like");
    expect(queryPath(["😀😀😀"])).toBe("fts");
    expect(queryPath(["😀😀"])).toBe("like");
  });

  test("match expressions quote every token and double inner quotes", () => {
    expect(toMatchExpression(["foo:bar", 'say "hi"', "(x)*", "AND"])).toBe(
      '"foo:bar" "say ""hi""" "(x)*" "AND"',
    );
  });

  test("like patterns escape the wildcards", () => {
    expect(toLikePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });

  test("snippets are clipped to 600 characters and the like snippet centres on the first match", () => {
    expect(Array.from(clipSnippet("x".repeat(2000)))).toHaveLength(600);
    const text = `${"a".repeat(500)}NEEDLE${"b".repeat(500)}`;
    const snippet = likeSnippet(text, ["needle"]);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("NEEDLE");
    expect(Array.from(snippet).length).toBeLessThanOrEqual(600);
    expect(likeSnippet("short text", ["short"])).toBe("short text");
  });
});

describe("session search", () => {
  test("korean short query uses like", async () => {
    const world = await createWorld({ sessions: true });
    await seedConversation(world);
    const found = await world.runtime.searchApi.query(
      { query: "검색", kinds: ["session"] },
      asHost(),
    );
    expect(found.path).toBe("like");
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0]).toMatchObject({ kind: "session", role: "user", title: "Korean notes" });
    expect(found.hits[0]?.snippet).toContain("검색을");
    expect(found.hits[0]?.score).toBeUndefined();
  });

  test("three char query uses fts", async () => {
    const world = await createWorld({ sessions: true });
    await seedConversation(world);
    const found = await world.runtime.searchApi.query(
      { query: "검색을", kinds: ["session"] },
      asHost(),
    );
    expect(found.path).toBe("fts");
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0]?.score).toBeTypeOf("number");
    // 2글자로는 trigram MATCH가 오류 없이 0건을 낸다. 그래서 LIKE 경로가 따로 있다
    const exact = await world.runtime.searchApi.query(
      { query: "색인은", kinds: ["session"] },
      asHost(),
    );
    expect(exact.hits.map((hit) => hit.role)).toEqual(["assistant"]);
  });

  test("nfc normalization", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    kit.say(threadId, "user", "한글로 쓴 문서".normalize("NFD"));
    await world.settleIndex();
    const found = await world.runtime.searchApi.query(
      { query: "한글로".normalize("NFC"), kinds: ["session"] },
      asHost(),
    );
    expect(found.hits).toHaveLength(1);
    const decomposed = await world.runtime.searchApi.query(
      { query: "한글로".normalize("NFD"), kinds: ["session"] },
      asHost(),
    );
    expect(decomposed.hits).toHaveLength(1);
  });

  test("bm25 then recency", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    kit.say(threadId, "user", "deploy checklist for release");
    world.clock.advance(5000);
    kit.say(threadId, "user", "deploy checklist for release");
    await world.settleIndex();
    const found = await world.runtime.searchApi.query(
      { query: "deploy checklist", kinds: ["session"] },
      asHost(),
    );
    // 같은 점수면 최신 메시지가 앞이다
    expect(found.hits.map((hit) => hit.seq)).toEqual([2, 1]);
    expect(found.hits[0]?.score).toBe(found.hits[1]?.score);
  });

  test("fts special chars quoted", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    kit.say(threadId, "user", 'she said "hello world" (really) foo:bar NEAR AND OR * ^x');
    await world.settleIndex();
    await eachAsync(
      ['"hello world"', "(really)", "foo:bar", "NEAR", "AND", 'x"y', "*^x"],
      async (query) => {
        const outcome = await world.runtime.searchApi
          .query({ query, kinds: ["session"] }, asHost())
          .then(
            (value) => value,
            (reason: unknown) => reason,
          );
        expect(outcome, query).not.toBeInstanceOf(Error);
        return undefined;
      },
    );
    // 따옴표만 있는 질의는 토큰이 없어 입력 오류다
    const quotesOnly = await rejection(world.runtime.searchApi.query({ query: '"' }, asHost()));
    expect(quotesOnly.data.code).toBe("invalid_input");
    const found = await world.runtime.searchApi.query(
      { query: "foo:bar", kinds: ["session"] },
      asHost(),
    );
    expect(found.hits).toHaveLength(1);
  });

  test("like wildcards are literal", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    kit.say(threadId, "user", "discount of 50% today");
    kit.say(threadId, "user", "discount of 5000 today");
    await world.settleIndex();
    const found = await world.runtime.searchApi.query(
      { query: "0%", kinds: ["session"] },
      asHost(),
    );
    expect(found.path).toBe("like");
    expect(found.hits.map((hit) => hit.seq)).toEqual([1]);
  });

  test("all tokens must match", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    kit.say(threadId, "user", "alpha beta gamma");
    kit.say(threadId, "user", "alpha delta");
    await world.settleIndex();
    const both = await world.runtime.searchApi.query(
      { query: "alpha gamma", kinds: ["session"] },
      asHost(),
    );
    expect(both.hits.map((hit) => hit.seq)).toEqual([1]);
  });

  test("hidden sessions, ids, time range, limit and project scope", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const a = kit.newThread({ title: "A", workspace: "/work/a" });
    const b = kit.newThread({ title: "B", workspace: "/work/b" });
    const child = kit.newThread({ title: "child" });
    kit.spawn(a, child, false);
    kit.say(a, "user", "needle in project a");
    world.clock.advance(10_000);
    const midpoint = world.clock.now();
    world.clock.advance(10_000);
    kit.say(b, "user", "needle in project b");
    kit.say(child, "assistant", "needle inside a subagent");
    await world.settleIndex();
    const api = world.runtime.searchApi;
    const ids = async (
      extra: Parameters<typeof api.query>[0] extends infer I ? Partial<I> : never,
    ) =>
      (await api.query({ query: "needle", kinds: ["session"], ...extra }, asHost())).hits
        .map((hit) => hit.sessionId)
        .toSorted(byText);
    // 기본은 main 세션만
    expect(await ids({})).toEqual([a, b].toSorted(byText));
    expect(await ids({ includeHidden: true })).toEqual([a, b, child].toSorted(byText));
    expect(await ids({ sessionIds: [b] })).toEqual([b]);
    expect(await ids({ after: midpoint })).toEqual([b]);
    expect(await ids({ before: midpoint })).toEqual([a]);
    expect(await ids({ limit: 1 })).toHaveLength(1);
    // 프로젝트 범위는 현재 세션의 프로젝트만이다
    const inA = await api.query(
      { query: "needle", kinds: ["session"], scope: "project" },
      { context: { threadId: a, caller: { kind: "model", agent: "main" } } },
    );
    expect(inA.hits.map((hit) => hit.sessionId)).toEqual([a]);
    // 현재 세션을 모르면 프로젝트 범위는 아무것도 찾지 않는다
    const noSession = await api.query(
      { query: "needle", kinds: ["session"], scope: "project" },
      asHost(),
    );
    expect(noSession.hits).toEqual([]);
    world.setLayers([userLayer({ "l2.knowledge.search.defaultScope": "project" })]);
    const byDefault = await api.query(
      { query: "needle", kinds: ["session"] },
      { context: { threadId: b, caller: { kind: "model", agent: "main" } } },
    );
    expect(byDefault.hits.map((hit) => hit.sessionId)).toEqual([b]);
  });

  test("the like scan only looks at the most recent documents", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    kit.say(threadId, "user", "ab old message");
    world.clock.advance(1000);
    kit.say(threadId, "user", "ab new message");
    await world.settleIndex();
    world.setLayers([userLayer({ "l2.knowledge.search.likeScanLimit": 1000 })]);
    const all = await world.runtime.searchApi.query({ query: "ab", kinds: ["session"] }, asHost());
    expect(all.hits).toHaveLength(2);
    // 설정 범위(최소 1000)를 넘은 값은 무시되므로 검색 범위 상한은 코드 경로 시험이 따로 있다
    expect(all.hits[0]?.snippet).toContain("new");
  });
});

describe("scroll, read and list", () => {
  test("scroll returns the neighbours by session message number", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    for (let index = 1; index <= 9; index += 1)
      kit.say(threadId, index % 2 === 0 ? "assistant" : "user", `message ${String(index)}`);
    await world.settleIndex();
    const around = await world.runtime.searchApi.scroll(
      { sessionId: threadId, aroundSeq: 5, before: 2, after: 1 },
      asHost(),
    );
    expect(around.messages.map((message) => message.seq)).toEqual([3, 4, 5, 6]);
    expect(around.messages[1]).toMatchObject({
      role: "assistant",
      text: "message 4",
      truncated: false,
    });
    const edge = await world.runtime.searchApi.scroll(
      { sessionId: threadId, aroundSeq: 1 },
      asHost(),
    );
    expect(edge.messages.map((message) => message.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    const missing = await rejection(
      world.runtime.searchApi.scroll(
        { sessionId: threadId, aroundSeq: 99, before: 0, after: 0 },
        asHost(),
      ),
    );
    expect(missing.data.code).toBe("not_found");
  });

  test("read pages through a session in order", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    for (let index = 1; index <= 5; index += 1) kit.say(threadId, "user", `note ${String(index)}`);
    await world.settleIndex();
    const page = await world.runtime.searchApi.read({ sessionId: threadId, limit: 2 }, asHost());
    expect(page.messages.map((message) => message.text)).toEqual(["note 1", "note 2"]);
    expect(page.nextSeq).toBe(3);
    const last = await world.runtime.searchApi.read(
      { sessionId: threadId, fromSeq: 5, limit: 2 },
      asHost(),
    );
    expect(last.messages.map((message) => message.seq)).toEqual([5]);
    expect(last.nextSeq).toBeUndefined();
  });

  test("an explicit read works on a hidden session and a long message is truncated", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const parent = kit.newThread();
    const child = kit.newThread();
    kit.spawn(parent, child, true);
    kit.say(child, "assistant", "z".repeat(100_100));
    await world.settleIndex();
    const read = await world.runtime.searchApi.read({ sessionId: child }, asHost());
    expect(read.messages[0]?.truncated).toBe(true);
    expect(Array.from(read.messages[0]?.text ?? "")).toHaveLength(100_000);
  });

  test("list is newest first with a before cursor", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const first = kit.newThread({ title: "first" });
    kit.say(first, "user", "one");
    world.clock.advance(1000);
    const second = kit.newThread({ title: "second" });
    kit.say(second, "user", "two");
    const api = world.runtime.searchApi;
    const page = await api.list({}, asHost());
    expect(page.sessions.map((session) => session.title)).toEqual(["second", "first"]);
    const older = await api.list({ before: page.sessions[0]?.lastAt ?? 0 }, asHost());
    expect(older.sessions.map((session) => session.title)).toEqual(["first"]);
    const limited = await api.list({ limit: 1 }, asHost());
    expect(limited.sessions).toHaveLength(1);
  });
});

async function seedKnowledge(world: World) {
  putSkill(world.fs, USER_SKILLS, "release-checklist", {
    description: "Steps to publish a release safely.",
    body: "# Release\n\nTag the commit, then run the smoke checks before publishing.\n",
  });
  putSkill(world.fs, USER_SKILLS, "quiet-skill", {
    description: "Hidden helper for smoke work.",
    frontmatter: "disable-model-invocation: true\n",
  });
  await world.runtime.skillsApi.reindex({});
  await world.runtime.memoryApi.add(
    { store: "user", text: "Prefers smoke tests before every release." },
    asHost(),
  );
}

describe("skill and memory search", () => {
  test("kind order concatenation", async () => {
    const world = await createWorld({ sessions: true });
    await seedKnowledge(world);
    const kit = KIT(world);
    const threadId = kit.newThread();
    kit.say(threadId, "user", "what about the smoke checks?");
    await world.settleIndex();
    const found = await world.runtime.searchApi.query({ query: "smoke" }, asHost());
    expect(found.path).toBe("fts");
    expect(found.hits.map((hit) => hit.kind)).toEqual(["skill", "memory", "session"]);
    const [skill, memory] = found.hits;
    expect(skill).toMatchObject({
      kind: "skill",
      ref: "release-checklist",
      title: "release-checklist",
    });
    expect(memory?.ref).toMatch(/^user:[0-9a-f]{12}$/);
    // 가린 스킬은 includeHidden일 때만 나온다
    const hidden = await world.runtime.searchApi.query(
      { query: "smoke", kinds: ["skill"], includeHidden: true },
      asHost(),
    );
    expect(hidden.hits.map((hit) => hit.ref).toSorted(byText)).toEqual([
      "quiet-skill",
      "release-checklist",
    ]);
    const only = await world.runtime.searchApi.query(
      { query: "smoke", kinds: ["memory", "skill"] },
      asHost(),
    );
    expect(only.hits.map((hit) => hit.kind)).toEqual(["skill", "memory"]);
  });

  test("a skill write updates the search index in the same step and a removal drops it", async () => {
    const world = await createWorld({ sessions: true });
    const api = world.runtime.skillsApi;
    await api.create(
      {
        name: "found-by-search",
        description: "A freshly written skill.",
        body: "Mentions the zebra crossing procedure.",
      },
      asHost(),
    );
    const hit = await world.runtime.searchApi.query(
      { query: "zebra crossing", kinds: ["skill"] },
      asHost(),
    );
    expect(hit.hits.map((entry) => entry.ref)).toEqual(["found-by-search"]);
    const hash = (await api.view({ name: "found-by-search" })).treeHash;
    await api.edit(
      { name: "found-by-search", baseHash: hash, body: "Now about giraffes only." },
      asHost(),
    );
    expect(
      (await world.runtime.searchApi.query({ query: "zebra crossing", kinds: ["skill"] }, asHost()))
        .hits,
    ).toEqual([]);
    expect(
      (await world.runtime.searchApi.query({ query: "giraffes", kinds: ["skill"] }, asHost())).hits,
    ).toHaveLength(1);
    const next = (await api.view({ name: "found-by-search" })).treeHash;
    await api.remove({ name: "found-by-search", baseHash: next }, asHost());
    expect(
      (await world.runtime.searchApi.query({ query: "giraffes", kinds: ["skill"] }, asHost())).hits,
    ).toEqual([]);
  });

  test("a memory write updates the search index", async () => {
    const world = await createWorld({ sessions: true });
    const added = await world.runtime.memoryApi.add(
      { store: "env", text: "The staging cluster is called orchard." },
      asHost(),
    );
    expect(
      (await world.runtime.searchApi.query({ query: "orchard", kinds: ["memory"] }, asHost())).hits,
    ).toHaveLength(1);
    await world.runtime.memoryApi.remove(
      { store: "env", entryId: added.view.entries[0]?.id ?? "", baseHash: added.view.fileHash },
      asHost(),
    );
    expect(
      (await world.runtime.searchApi.query({ query: "orchard", kinds: ["memory"] }, asHost())).hits,
    ).toEqual([]);
  });

  test("a shadowed skill does not appear twice", async () => {
    const world = await createWorld({ sessions: true });
    putSkill(world.fs, "/proj/.xeon/skills", "same-name", {
      description: "project version with cabbage",
    });
    putSkill(world.fs, USER_SKILLS, "same-name", { description: "user version with cabbage" });
    await world.runtime.skillsApi.reindex({});
    const found = await world.runtime.searchApi.query(
      { query: "cabbage", kinds: ["skill"] },
      asHost(),
    );
    expect(found.hits).toHaveLength(1);
    expect(found.hits[0]?.snippet).toContain("project");
  });
});

describe("search settings and errors", () => {
  test("an empty query and a switched-off search are refused", async () => {
    const world = await createWorld({ sessions: true });
    const empty = await rejection(world.runtime.searchApi.query({ query: '   ""  ' }, asHost()));
    expect(empty.data.code).toBe("invalid_input");
    world.setLayers([userLayer({ "l2.knowledge.search.enabled": false })]);
    const off = await rejection(world.runtime.searchApi.query({ query: "anything" }, asHost()));
    expect(off.data.code).toBe("unavailable");
    expect(
      (await rejection(world.runtime.searchApi.read({ sessionId: "x" }, asHost()))).data.code,
    ).toBe("unavailable");
  });
});
