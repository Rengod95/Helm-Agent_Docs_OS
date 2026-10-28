import { describe, expect, test } from "bun:test";
import { createSourceIdRegistry, createSourceIdTable } from "../src/contract/source-ids.ts";
import type { WebSessionSourcesPort } from "../src/ports/session-sources.ts";
import { threadIdOf } from "./support/ids.ts";

const THREAD = threadIdOf(1);

function idOf(table: ReturnType<typeof createSourceIdTable>, url: string): string {
  const result = table.idFor(url);
  if (!result.ok) throw new Error("source id allocation failed");
  return result.value;
}

function portOf(
  sources: readonly { id: string; url: string; finalUrl?: string }[],
  calls: { count: number } = { count: 0 },
): WebSessionSourcesPort {
  return {
    recordedSources() {
      calls.count += 1;
      return Promise.resolve({ ok: true, value: sources });
    },
  };
}

describe("source ids", () => {
  test("source ids are session unique", async () => {
    const calls = { count: 0 };
    const registry = createSourceIdRegistry(portOf([], calls));
    const first = await registry.forThread(THREAD);
    const second = await registry.forThread(THREAD);
    if (!first.ok || !second.ok) throw new Error("expected tables");
    // 두 호출의 같은 URL은 같은 sN, 다른 URL은 이어지는 번호
    expect(idOf(first.value, "https://example.com/a")).toBe("s1");
    expect(idOf(second.value, "https://example.com/b")).toBe("s2");
    expect(idOf(second.value, "https://EXAMPLE.com/a?utm_source=x#top")).toBe("s1");
    expect(calls.count).toBe(1);
  });

  test("a restart continues after the recorded numbers", async () => {
    const registry = createSourceIdRegistry(
      portOf([
        { id: "s1", url: "https://example.com/a" },
        { id: "s7", url: "https://example.com/g", finalUrl: "https://example.com/g2" },
      ]),
    );
    const table = await registry.forThread(THREAD);
    if (!table.ok) throw new Error("expected table");
    expect(idOf(table.value, "https://example.com/a")).toBe("s1");
    expect(idOf(table.value, "https://example.com/g2")).toBe("s7");
    expect(idOf(table.value, "https://example.com/new")).toBe("s8");
  });

  test("a call without a session numbers from s1 inside the call only", async () => {
    const registry = createSourceIdRegistry(portOf([{ id: "s4", url: "https://example.com/a" }]));
    const one = await registry.forThread(undefined);
    const two = await registry.forThread(undefined);
    if (!one.ok || !two.ok) throw new Error("expected tables");
    expect(idOf(one.value, "https://example.com/a")).toBe("s1");
    expect(idOf(two.value, "https://example.com/z")).toBe("s1");
  });

  test("unreadable session events fail the lookup with a value", async () => {
    const registry = createSourceIdRegistry({
      recordedSources: () =>
        Promise.resolve({ ok: false, error: { kind: "read_failed", cause: "io" } }),
    });
    const result = await registry.forThread(THREAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("session_read_failed");
  });

  test("malformed recorded ids are skipped", () => {
    const table = createSourceIdTable();
    table.seed([
      { id: "x9", url: "https://example.com/a" },
      { id: "s0", url: "https://example.com/b" },
      { id: "s2", url: "https://example.com/c" },
    ]);
    expect(idOf(table, "https://example.com/a")).toBe("s3");
    expect(idOf(table, "https://example.com/c")).toBe("s2");
  });
});
