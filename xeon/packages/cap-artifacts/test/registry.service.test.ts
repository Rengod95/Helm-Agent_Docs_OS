import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { TurnId } from "@xeon/contracts/conversation";
import { codeOf, rejection } from "./support/assert.ts";
import { openRegistry, type RegistryHarness } from "./support/harness.ts";

// 저장소를 여는 시험은 첫 실행에서 기본 5초를 넘긴 적이 있어 시간 상한을 넓힌다.
setDefaultTimeout(20_000);

let opened: RegistryHarness | undefined;

async function harness(maxPerSession = 500, maxContentBytes = 26214400): Promise<RegistryHarness> {
  opened = await openRegistry({ maxPerSession, maxContentBytes });
  return opened;
}

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

const TEXT = "# Plan\n\nBody\n";

function inline(
  text: string,
  mediaType = "text/markdown",
): { type: "inline"; text: string; mediaType: string } {
  return { type: "inline", text, mediaType };
}

function bytesOf(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** 시계를 밀어 가며 산출물 셋을 만든다. 같은 대화에 A(문서, 턴 있음), B(표), C(문서)를 등록하고 A를 한 번 고친다 */
async function seedThree(h: RegistryHarness): Promise<{ turnId: TurnId }> {
  const turnId = h.ids.next("trn");
  await h.api.register(
    { kind: "document", title: "A", content: inline("alpha\n") },
    h.opts("seed-a", { turnId }),
  );
  h.advance(10);
  await h.api.register(
    { kind: "table", title: "B", content: inline("x,y\n1,2\n", "text/csv") },
    h.opts("seed-b"),
  );
  h.advance(10);
  await h.api.register(
    { kind: "document", title: "C", content: inline("gamma\n") },
    h.opts("seed-c"),
  );
  h.advance(10);
  const a = await h.api.list({ threadId: h.threadId }, h.opts());
  const first = a.items.find((item) => item.title === "A");
  if (first === undefined) throw new Error("seed: A is missing");
  await h.api.update(
    { artifactId: first.artifactId, baseVersion: 1, content: inline("alpha 2\n") },
    h.opts("seed-a2"),
  );
  return { turnId };
}

describe("register", () => {
  test("an inline document registers as version 1 with its kind, title, active status, origin and a line count", async () => {
    const h = await harness();
    const summary = await h.api.register(
      { kind: "document", title: "Plan", content: inline(TEXT) },
      h.opts("reg-1"),
    );

    expect({
      kind: summary.kind,
      title: summary.title,
      version: summary.version,
      status: summary.status,
      mediaType: summary.content.mediaType,
      size: summary.content.size,
      lines: summary.meta.preview?.lines,
      origin: summary.origin,
    }).toEqual({
      kind: "document",
      title: "Plan",
      version: 1,
      status: "active",
      mediaType: "text/markdown",
      size: bytesOf(TEXT),
      lines: 3,
      origin: { threadId: h.threadId, turnId: null, toolCallId: null, producer: "model" },
    });
    expect(summary.createdAt).toBe(summary.updatedAt);
    const [registered] = await h.events(h.threadId, "artifact.registered");
    expect(summary.createdAt).toBe(registered?.recordedAt ?? -1);
  });

  test("a CSV table gets its rows and columns in the preview", async () => {
    const h = await harness();
    const summary = await h.api.register(
      { kind: "table", title: "Table", content: inline("a,b,c\n1,2,3\n4,5,6\n", "text/csv") },
      h.opts(),
    );
    expect(summary.meta.preview).toEqual({ lines: 3, rows: 3, columns: 3 });
  });

  test("a replay with the same requestId returns the first artifact and writes one event", async () => {
    const h = await harness();
    const input = { kind: "document" as const, title: "Once", content: inline("one\n") };
    const first = await h.api.register(input, h.opts("same"));
    const second = await h.api.register(input, h.opts("same"));

    expect(second).toEqual(first);
    expect(second.artifactId).toBe(first.artifactId);
    expect(await h.events(h.threadId, "artifact.registered")).toHaveLength(1);
  });

  test("the session limit refuses the next registration and writes nothing", async () => {
    const h = await harness(1);
    await h.api.register({ kind: "document", title: "A", content: inline("a\n") }, h.opts("a"));

    expect(
      await codeOf(
        h.api.register({ kind: "document", title: "B", content: inline("b\n") }, h.opts("b")),
      ),
    ).toBe("artifact_limit_reached");
    expect(await h.events(h.threadId, "artifact.registered")).toHaveLength(1);
  });

  test("content larger than maxContentBytes is refused before anything is written", async () => {
    const h = await harness(500, 1024);
    const text = "a".repeat(1025);

    expect(
      await codeOf(
        h.api.register(
          { kind: "log", title: "Big", content: inline(text, "text/plain") },
          h.opts(),
        ),
      ),
    ).toBe("content_too_large");
    expect(await h.events(h.threadId, "artifact.registered")).toHaveLength(0);
  });

  test("a file content is refused until file sources are supported", async () => {
    const h = await harness();
    expect(
      await codeOf(
        h.api.register(
          { kind: "document", title: "File", content: { type: "file", path: "notes.md" } },
          h.opts(),
        ),
      ),
    ).toBe("file_unreadable");
  });

  test("a blob content that is in the store keeps its ref, and one that is missing is file_unreadable", async () => {
    const h = await harness();
    const put = h.store.service.putBlob(new TextEncoder().encode("blob body\n"), "text/plain");
    if (!put.ok) throw new Error("seed: the blob was not written");

    const summary = await h.api.register(
      { kind: "document", title: "From blob", content: { type: "blob", ref: put.value } },
      h.opts("blob-ok"),
    );
    expect(summary.content).toEqual(put.value);
    expect(summary.meta.preview?.lines).toBe(1);

    expect(
      await codeOf(
        h.api.register(
          {
            kind: "document",
            title: "Missing",
            content: {
              type: "blob",
              ref: { type: "blob", sha256: "0".repeat(64), size: 3, mediaType: "text/plain" },
            },
          },
          h.opts("blob-missing"),
        ),
      ),
    ).toBe("file_unreadable");
  });

  test("meta larger than 16 KiB is invalid_input", async () => {
    const h = await harness();
    expect(
      await codeOf(
        h.api.register(
          {
            kind: "document",
            title: "Heavy",
            content: inline("x\n"),
            meta: { custom: { big: "y".repeat(17_000) } },
          },
          h.opts(),
        ),
      ),
    ).toBe("invalid_input");
  });

  test("the producer is model for a model caller and cap.artifacts for a host caller", async () => {
    const h = await harness();
    const host = await h.api.register(
      { kind: "document", title: "Host", content: inline("h\n") },
      h.opts("host", { caller: { kind: "host" } }),
    );
    expect(host.origin.producer).toBe("cap.artifacts");
  });

  test("a tool call records its tool call id, and it cannot register into another session", async () => {
    const h = await harness();
    const other = h.newThread();
    const tool = await h.api.register(
      { kind: "plan", title: "Tool", content: inline("step\n") },
      h.opts("tool-1", { toolCallId: "tc-1" }),
    );
    expect(tool.origin.toolCallId).toBe("tc-1");

    expect(
      await codeOf(
        h.api.register(
          { threadId: other, kind: "document", title: "Elsewhere", content: inline("e\n") },
          h.opts("tool-2", { toolCallId: "tc-2" }),
        ),
      ),
    ).toBe("denied");
  });

  test("a service call may register into another session named in the input", async () => {
    const h = await harness();
    const other = h.newThread();
    const summary = await h.api.register(
      { threadId: other, kind: "document", title: "Elsewhere", content: inline("e\n") },
      h.opts("svc-other"),
    );
    expect(summary.origin.threadId).toBe(other);
    expect(await h.events(h.threadId, "artifact.registered")).toHaveLength(0);
  });
});

describe("update", () => {
  test("an update with the latest base version makes version 2, recounts the lines, and keeps version 1", async () => {
    const h = await harness();
    const created = await h.api.register(
      { kind: "document", title: "Plan", content: inline(TEXT) },
      h.opts("reg"),
    );
    const updated = await h.api.update(
      {
        artifactId: created.artifactId,
        baseVersion: 1,
        title: "Plan v2",
        content: inline("New body"),
      },
      h.opts("upd-1"),
    );

    expect({
      version: updated.version,
      title: updated.title,
      size: updated.content.size,
      lines: updated.meta.preview?.lines,
    }).toEqual({ version: 2, title: "Plan v2", size: bytesOf("New body"), lines: 1 });

    const old = await h.api.get(
      { artifactId: created.artifactId, version: 1, includeText: true },
      h.opts(),
    );
    expect({
      version: old.artifact.version,
      title: old.artifact.title,
      text: old.text,
      latest: old.latestVersion,
    }).toEqual({
      version: 1,
      title: "Plan",
      text: TEXT,
      latest: 2,
    });
  });

  test("a stale base version is version_conflict with the latest version in the detail", async () => {
    const h = await harness();
    const created = await h.api.register(
      { kind: "document", title: "Plan", content: inline(TEXT) },
      h.opts(),
    );
    await h.api.update(
      { artifactId: created.artifactId, baseVersion: 1, content: inline("two\n") },
      h.opts(),
    );

    const error = await rejection(
      h.api.update(
        { artifactId: created.artifactId, baseVersion: 1, content: inline("late\n") },
        h.opts(),
      ),
    );
    expect({ code: error.data.code, detail: error.data.detail }).toEqual({
      code: "version_conflict",
      detail: { latestVersion: 2 },
    });
  });

  test("an archived artifact cannot be updated", async () => {
    const h = await harness();
    const created = await h.api.register(
      { kind: "document", title: "Plan", content: inline(TEXT) },
      h.opts(),
    );
    await h.api.archive({ artifactId: created.artifactId }, h.opts());

    expect(
      await codeOf(
        h.api.update({ artifactId: created.artifactId, baseVersion: 1, title: "Late" }, h.opts()),
      ),
    ).toBe("artifact_archived");
  });

  test("a tool call merges only the summary into the existing meta", async () => {
    const h = await harness();
    const created = await h.api.register(
      {
        kind: "document",
        title: "Plan",
        content: inline(TEXT),
        meta: { summary: "old", tags: ["draft"] },
      },
      h.opts("reg"),
    );
    const updated = await h.api.update(
      { artifactId: created.artifactId, baseVersion: 1, meta: { summary: "new" } },
      h.opts("tool-upd", { toolCallId: "tc-up" }),
    );

    expect({
      summary: updated.meta.summary,
      tags: updated.meta.tags,
      version: updated.version,
    }).toEqual({
      summary: "new",
      tags: ["draft"],
      version: 2,
    });
    expect(updated.meta.preview).toEqual(created.meta.preview);
  });

  test("a service update replaces the whole meta", async () => {
    const h = await harness();
    const created = await h.api.register(
      {
        kind: "document",
        title: "Plan",
        content: inline(TEXT),
        meta: { summary: "old", tags: ["draft"] },
      },
      h.opts("reg"),
    );
    const updated = await h.api.update(
      { artifactId: created.artifactId, baseVersion: 1, meta: { summary: "only" } },
      h.opts("svc-upd"),
    );
    expect(updated.meta.summary).toBe("only");
    expect(updated.meta.tags).toBeUndefined();
  });

  test("a tool call cannot update an artifact of another session", async () => {
    const h = await harness();
    const created = await h.api.register(
      { kind: "document", title: "Plan", content: inline(TEXT) },
      h.opts(),
    );
    const other = h.newThread();

    expect(
      await codeOf(
        h.api.update(
          { artifactId: created.artifactId, baseVersion: 1, meta: { summary: "x" } },
          h.opts("cross", { toolCallId: "tc-x", contextThread: other }),
        ),
      ),
    ).toBe("denied");
  });
});

describe("list", () => {
  test("the default list is the active artifacts of the session, most recently updated first", async () => {
    const h = await harness();
    await seedThree(h);
    const page = await h.api.list({ threadId: h.threadId }, h.opts());
    expect(page.items.map((item) => item.title)).toEqual(["A", "C", "B"]);
    expect(page.nextCursor).toBeNull();
  });

  test("walking the pages with limit 1 yields every item once and ends with no cursor", async () => {
    const h = await harness();
    await seedThree(h);
    const walk = async (
      cursor: string | undefined,
      seen: string[],
    ): Promise<{ titles: string[]; pages: number }> => {
      const page = await h.api.list(
        { threadId: h.threadId, limit: 1, ...(cursor === undefined ? {} : { cursor }) },
        h.opts(),
      );
      const titles = [...seen, ...page.items.map((item) => item.title)];
      if (page.nextCursor === null) return { titles, pages: titles.length };
      return walk(page.nextCursor, titles);
    };
    const { titles, pages } = await walk(undefined, []);
    expect({ titles, pages }).toEqual({ titles: ["A", "C", "B"], pages: 3 });
  });

  test("kind, turn and status filters narrow the list", async () => {
    const h = await harness();
    const { turnId } = await seedThree(h);
    const byKind = await h.api.list({ threadId: h.threadId, kinds: ["table"] }, h.opts());
    const byTurn = await h.api.list({ threadId: h.threadId, turnId }, h.opts());
    expect({
      kind: byKind.items.map((item) => item.title),
      turn: byTurn.items.map((item) => item.title),
    }).toEqual({
      kind: ["B"],
      turn: ["A"],
    });

    const c = (
      await h.api.list({ threadId: h.threadId, kinds: ["document"] }, h.opts())
    ).items.find((item) => item.title === "C");
    if (c === undefined) throw new Error("seed: C is missing");
    await h.api.archive({ artifactId: c.artifactId }, h.opts());

    const active = await h.api.list({ threadId: h.threadId }, h.opts());
    const archived = await h.api.list({ threadId: h.threadId, status: "archived" }, h.opts());
    const everything = await h.api.list({ threadId: h.threadId, status: "all" }, h.opts());
    expect({
      active: active.items.map((item) => item.title),
      archived: archived.items.map((item) => item.title),
      all: everything.items.map((item) => item.title),
    }).toEqual({ active: ["A", "B"], archived: ["C"], all: ["A", "C", "B"] });
  });

  test("a session filter reads one session, and an omitted session reads all of them", async () => {
    const h = await harness();
    await seedThree(h);
    const other = h.newThread();
    h.advance(5);
    await h.api.register(
      { threadId: other, kind: "document", title: "D", content: inline("d\n") },
      h.opts("d"),
    );

    const mine = await h.api.list({ threadId: h.threadId }, h.opts());
    const everyone = await h.api.list({}, h.opts());
    expect(mine.items.map((item) => item.title)).toEqual(["A", "C", "B"]);
    expect(everyone.items.map((item) => item.title)).toEqual(["D", "A", "C", "B"]);
  });

  test("a malformed cursor is invalid_input", async () => {
    const h = await harness();
    expect(await codeOf(h.api.list({ cursor: "-1" }, h.opts()))).toBe("invalid_input");
  });
});

describe("get", () => {
  test("get returns the latest version by default and an older version on request", async () => {
    const h = await harness();
    await seedThree(h);
    const latest = await h.api.list({ threadId: h.threadId, kinds: ["document"] }, h.opts());
    const a = latest.items.find((item) => item.title === "A");
    if (a === undefined) throw new Error("seed: A is missing");

    const current = await h.api.get({ artifactId: a.artifactId }, h.opts());
    const first = await h.api.get({ artifactId: a.artifactId, version: 1 }, h.opts());
    expect({
      version: current.artifact.version,
      latest: current.latestVersion,
      text: current.text,
    }).toEqual({
      version: 2,
      latest: 2,
      text: null,
    });
    expect({ version: first.artifact.version, size: first.artifact.content.size }).toEqual({
      version: 1,
      size: bytesOf("alpha\n"),
    });
  });

  test("includeText returns the text of a text artifact and null for other media types", async () => {
    const h = await harness();
    const text = await h.api.register(
      { kind: "document", title: "T", content: inline("hello\n") },
      h.opts(),
    );
    const binary = await h.api.register(
      { kind: "document", title: "B", content: inline("bin", "application/octet-stream") },
      h.opts(),
    );
    const withText = await h.api.get({ artifactId: text.artifactId, includeText: true }, h.opts());
    const withoutText = await h.api.get(
      { artifactId: binary.artifactId, includeText: true },
      h.opts(),
    );
    const omitted = await h.api.get({ artifactId: text.artifactId }, h.opts());
    expect({
      withText: withText.text,
      withoutText: withoutText.text,
      omitted: omitted.text,
    }).toEqual({
      withText: "hello\n",
      withoutText: null,
      omitted: null,
    });
  });

  test("an unknown artifact or version is not_found", async () => {
    const h = await harness();
    const created = await h.api.register(
      { kind: "document", title: "T", content: inline("t\n") },
      h.opts(),
    );
    expect(await codeOf(h.api.get({ artifactId: h.localIds.next("art") }, h.opts()))).toBe(
      "not_found",
    );
    expect(await codeOf(h.api.get({ artifactId: created.artifactId, version: 9 }, h.opts()))).toBe(
      "not_found",
    );
  });
});

describe("archive", () => {
  test("archive changes the status once, and a second archive adds no event", async () => {
    const h = await harness();
    const created = await h.api.register(
      { kind: "document", title: "T", content: inline("t\n") },
      h.opts(),
    );
    const first = await h.api.archive({ artifactId: created.artifactId }, h.opts("arc-1"));
    const second = await h.api.archive({ artifactId: created.artifactId }, h.opts("arc-2"));

    expect({ status: first.status, again: second }).toEqual({ status: "archived", again: first });
    const archived = await h.events(h.threadId, "artifact.archived");
    expect(archived).toHaveLength(1);
    expect(archived[0]?.payload).toEqual({ artifactId: created.artifactId, reason: "user" });
  });

  test("an unknown artifact is not_found", async () => {
    const h = await harness();
    expect(await codeOf(h.api.archive({ artifactId: h.localIds.next("art") }, h.opts()))).toBe(
      "not_found",
    );
  });
});
