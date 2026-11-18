import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import { OVERLAY_WIRE_MAX } from "../../src/wire-settings/wire/profile.ts";
import { WIRE_METHODS } from "../../src/wire-settings/wire/index.ts";
import {
  TestRunStartParamsSchema,
  TestRunStartResultSchema,
} from "../../src/wire-settings/wire/profile-test-run.ts";

// M5c §4.8.1: testRun.start의 모양. 처리기는 apps/host가 값으로 시험한다.

const THREAD_ID = "thr_01HZX0000000000000000000ZZ";

function accepts(schema: TSchema, value: unknown): unknown {
  const result = parse(schema, value);
  return result.ok ? "ok" : result.error.kind;
}

function draftsOf(count: number): { plugin: string; draftId: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    plugin: "notes",
    draftId: `draft-${index}`,
  }));
}

describe("testRun.start wire method", () => {
  test("is registered at stage M5 with its params and result schemas", () => {
    expect(WIRE_METHODS["testRun.start"].stage).toBe("M5");
    expect(WIRE_METHODS["testRun.start"].params).toBeDefined();
    expect(WIRE_METHODS["testRun.start"].result).toBeDefined();
  });

  test("drafts is required and may be empty; the base profile, run group and workspace are optional", () => {
    expect(accepts(TestRunStartParamsSchema, { drafts: [] })).toBe("ok");
    expect(
      accepts(TestRunStartParamsSchema, {
        baseProfileId: "work",
        drafts: [],
        runGroupId: "grp-1",
        workspace: "/tmp/work",
      }),
    ).toBe("ok");
    expect(accepts(TestRunStartParamsSchema, {})).not.toBe("ok");
    expect(accepts(TestRunStartParamsSchema, { drafts: [], extra: 1 })).not.toBe("ok");
    expect(accepts(TestRunStartParamsSchema, { baseProfileId: "", drafts: [] })).not.toBe("ok");
  });

  test("draftApproval is optional and takes ask or auto; the value is kept and any other value is refused", () => {
    expect(accepts(TestRunStartParamsSchema, { drafts: [] })).toBe("ok");
    for (const draftApproval of ["ask", "auto"] as const) {
      const parsed = parse(TestRunStartParamsSchema, { drafts: [], draftApproval });
      expect(parsed.ok ? parsed.value.draftApproval : parsed.error.kind).toBe(draftApproval);
    }
    for (const draftApproval of ["AUTO", "always", "", "allow", null, true]) {
      expect(accepts(TestRunStartParamsSchema, { drafts: [], draftApproval })).not.toBe("ok");
    }
  });

  test("each draft names a plugin and a draft id, and nothing else", () => {
    expect(
      accepts(TestRunStartParamsSchema, { drafts: [{ plugin: "notes", draftId: "d1" }] }),
    ).toBe("ok");
    expect(accepts(TestRunStartParamsSchema, { drafts: [{ plugin: "notes" }] })).not.toBe("ok");
    expect(accepts(TestRunStartParamsSchema, { drafts: [{ draftId: "d1" }] })).not.toBe("ok");
    expect(
      accepts(TestRunStartParamsSchema, {
        drafts: [{ plugin: "notes", draftId: "d1", versionId: "x" }],
      }),
    ).not.toBe("ok");
  });

  test("a draft may name the start entry, which runs that draft's start Drive; no other entry is accepted", () => {
    expect(
      accepts(TestRunStartParamsSchema, {
        drafts: [{ plugin: "notes", draftId: "d1", entry: "start" }],
      }),
    ).toBe("ok");
    for (const entry of ["other", "", "Start", "drive"]) {
      expect(
        accepts(TestRunStartParamsSchema, {
          drafts: [{ plugin: "notes", draftId: "d1", entry }],
        }),
      ).not.toBe("ok");
    }
  });

  test("the wire accepts up to the overlay wire bound, and the handler answers the larger count with overlay.limit", () => {
    expect(OVERLAY_WIRE_MAX).toBe(16);
    expect(accepts(TestRunStartParamsSchema, { drafts: draftsOf(OVERLAY_WIRE_MAX) })).toBe("ok");
    expect(accepts(TestRunStartParamsSchema, { drafts: draftsOf(OVERLAY_WIRE_MAX + 1) })).not.toBe(
      "ok",
    );
  });

  test("the result carries threadId, profileId, the drafts with their version ids and the run group id", () => {
    const ok = {
      threadId: THREAD_ID,
      profileId: "default",
      drafts: [{ plugin: "notes", draftId: "d1", versionId: "draft:d1:0123abcd" }],
      runGroupId: "grp-1",
      skippedPlugins: ["helm"],
    };
    expect(accepts(TestRunStartResultSchema, ok)).toBe("ok");
    expect(accepts(TestRunStartResultSchema, { ...ok, skippedPlugins: [] })).toBe("ok");
    const { skippedPlugins: _skipped, ...withoutSkipped } = ok;
    expect(accepts(TestRunStartResultSchema, withoutSkipped)).not.toBe("ok");
    expect(accepts(TestRunStartResultSchema, { ...ok, drafts: [] })).toBe("ok");
    const { runGroupId: _omitted, ...withoutGroup } = ok;
    expect(accepts(TestRunStartResultSchema, withoutGroup)).not.toBe("ok");
    expect(accepts(TestRunStartResultSchema, { ...ok, extra: true })).not.toBe("ok");
  });
});
