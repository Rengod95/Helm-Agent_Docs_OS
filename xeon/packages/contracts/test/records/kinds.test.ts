import { describe, expect, test } from "bun:test";
import {
  CORE_EVENT_KINDS,
  CORE_KIND_PATTERN,
  EXTENSION_KIND_PATTERN,
  EventKindSchema,
  parseEventKind,
  type CatalogEntry,
  type EventKindRegistration,
  type EventKindRegistry,
  type KindError,
} from "../../src/records/index.ts";
import { err, ok, parse, type Result } from "../../src/index.ts";
import { Type } from "typebox";

describe("core kinds", () => {
  test("all 40 parse as core", () => {
    for (const kind of CORE_EVENT_KINDS) {
      const result = parseEventKind(kind);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.origin).toBe("core");
    }
  });

  test("part.delta is not in the catalog", () => {
    expect(parseEventKind("part.delta")).toEqual({
      ok: false,
      error: { kind: "reserved_area", eventKind: "part.delta" },
    });
  });
});

describe("domain areas", () => {
  test("registered-name rule: only kinds in the merged catalog pass, the rest of a domain area is reserved", () => {
    for (const kind of [
      "work.unknown_name",
      "dialog.unknown_name",
      "artifact.created",
      "schedule.fired",
    ]) {
      const result = parseEventKind(kind);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("reserved_area");
    }
  });

  test("work and dialog kinds registered by their domain catalogs parse as domain kinds", () => {
    for (const [kind, area, name] of [
      ["work.task_created", "work", "task_created"],
      ["work.report_built", "work", "report_built"],
      ["dialog.status", "dialog", "status"],
      ["dialog.notified", "dialog", "notified"],
    ] as const) {
      const result = parseEventKind(kind);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ origin: "domain", area, name });
    }
  });

  test("reserved L2 areas are reserved", () => {
    for (const kind of ["workspace.read", "mcp.connected", "web.searched", "knowledge.updated"]) {
      const result = parseEventKind(kind);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("reserved_area");
    }
  });
});

describe("prefix rules (acceptance 14)", () => {
  test("valid extension and group kinds", () => {
    for (const kind of [
      "x.foo.bar.baz",
      "x.web-exa.search.done",
      "grp.helm.item.tagged",
      "grp.learning.skill.proposed",
      "x.foo.note_v2.added",
    ]) {
      const result = parseEventKind(kind);
      expect(result.ok).toBe(true);
    }
    const parsed = parseEventKind("grp.helm.item.tagged");
    expect(parsed).toEqual({
      ok: true,
      value: {
        origin: "extension",
        ownerType: "grp",
        ownerId: "helm",
        area: "item",
        name: "tagged",
      },
    });
  });

  test("malformed kinds", () => {
    const malformed = [
      "x.acme_notes.a.b",
      `x.${"a".repeat(33)}.a.b`,
      `x.foo.${"a".repeat(33)}.b`,
      "X.foo.a.b",
      "x..a.b",
      "x.foo.a",
      "x.1foo.a.b",
      "x.foo.2note.added",
      "grp.learning.skill_proposed",
      "thread",
      "",
      "Thread.started",
    ];
    for (const kind of malformed) {
      const result = parseEventKind(kind);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("malformed");
    }
  });

  test("a prefix-less kind outside the core and domain areas is reserved_area", () => {
    for (const kind of ["foo.bar", "thread.unknown_name"]) {
      const result = parseEventKind(kind);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("reserved_area");
    }
  });

  test("patterns agree with the parser", () => {
    expect(new RegExp(EXTENSION_KIND_PATTERN).test("x.alpha.note_v2.added")).toBe(true);
    expect(new RegExp(EXTENSION_KIND_PATTERN).test("x.alpha.2note.added")).toBe(false);
    expect(new RegExp(CORE_KIND_PATTERN).test("thread.started")).toBe(true);
    expect(parse(EventKindSchema, "thread.started").ok).toBe(true);
  });
});

/** 테스트용 가짜 레지스트리. 실제 구현은 X 몫이다. 계약만 확인한다. */
function fakeRegistry(): EventKindRegistry {
  const entries = new Map<string, CatalogEntry>();
  return {
    register(owner, entry): Result<void, KindError> {
      const parsed = parseEventKind(entry.kind);
      if (!parsed.ok) return err(parsed.error);
      if (
        parsed.value.origin !== "extension" ||
        parsed.value.ownerType !== owner.type ||
        parsed.value.ownerId !== owner.id
      ) {
        return err({ kind: "reserved_area", eventKind: entry.kind });
      }
      if (entries.has(entry.kind)) return err({ kind: "duplicate", eventKind: entry.kind });
      entries.set(entry.kind, {
        kind: entry.kind,
        version: entry.version,
        durable: entry.durable,
        payload: entry.payload,
      });
      return ok(undefined);
    },
    lookup(kind) {
      return entries.get(kind);
    },
  };
}

describe("registry contract (fake implementation)", () => {
  const registration: EventKindRegistration = {
    kind: "x.acme.note.added",
    version: 1,
    durable: true,
    payload: Type.Object({}, { additionalProperties: false }),
  };

  test("register, duplicate, malformed and lookup", () => {
    const registry = fakeRegistry();
    expect(registry.register({ type: "x", id: "acme" }, registration).ok).toBe(true);
    expect(registry.lookup("x.acme.note.added")?.version).toBe(1);
    expect(registry.lookup("x.acme.note.removed")).toBeUndefined();
    const dup = registry.register({ type: "x", id: "acme" }, registration);
    expect(dup).toEqual({
      ok: false,
      error: { kind: "duplicate", eventKind: "x.acme.note.added" },
    });
    const bad = registry.register(
      { type: "x", id: "acme" },
      { ...registration, kind: "x.acme_notes.a.b" },
    );
    expect(bad.ok).toBe(false);
  });

  test("a core kind cannot be registered (compile-time and runtime)", () => {
    const registry = fakeRegistry();
    const result = registry.register(
      { type: "x", id: "acme" },
      {
        // @ts-expect-error -- 코어 kind는 EventKindRegistration.kind(ExtensionEventKind)에 넣을 수 없다 (F.records.plan §5)
        kind: "thread.started",
        version: 1,
        durable: true,
        payload: Type.Object({}),
      },
    );
    expect(result.ok).toBe(false);
  });
});
