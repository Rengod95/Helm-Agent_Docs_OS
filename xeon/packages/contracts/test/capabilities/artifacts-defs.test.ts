import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  ARTIFACTS_CAPABILITIES,
  ArtifactBlobRefSchema,
  ArtifactContentInputSchema,
  ArtifactIdSchema,
  ArtifactKindSchema,
  ArtifactMetaSchema,
  ArtifactProducerSchema,
  ArtifactSummarySchema,
  ArtifactVersionRefSchema,
  ArtifactsRegistry,
  ArtifactsRegistryKey,
  ArtifactsReviews,
  ArtifactsReviewsKey,
  ArtifactsSessions,
  ArtifactsSessionsKey,
  ChangeSourceSchema,
  CommentTargetSchema,
  HunkDecisionSchema,
  HunkIdSchema,
  LabelSchema,
  MediaTypeSchema,
  ReviewIdSchema,
  ReviewViewSchema,
  SessionMetaViewSchema,
  WORK_CAPABILITIES,
  toJsonSchema,
  validateCapability,
  validateCapabilitySet,
} from "../../src/capabilities/index.ts";
import { BlobRefSchema, ReviewAnswerSchema } from "../../src/records/index.ts";
import { rawId } from "../helpers/ids.ts";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const OPEN = ArtifactsReviews.service.methods.open;

describe("artifacts.reviews definition", () => {
  test("validates with no issues, warnings included", () => {
    expect(validateCapability(ArtifactsReviews)).toEqual([]);
  });

  test("the key carries the capability id and version", () => {
    expect(ArtifactsReviewsKey).toEqual({ capability: "artifacts.reviews", version: "1.0.0" });
  });

  test("the only model tool is review_request and it calls open", () => {
    expect(ArtifactsReviews.tools.map((t) => t.name)).toEqual(["review_request"]);
    expect(ArtifactsReviews.tools[0].method).toBe("open");
  });

  test("toInput maps empty parameters to a turn source", () => {
    const tool = ArtifactsReviews.tools[0];
    const input = tool.toInput?.({});
    expect(input).toEqual({ changes: { type: "turn" } });
    expect(parse(OPEN.input, input).ok).toBe(true);
  });

  test("toInput maps tool call ids and title", () => {
    const tool = ArtifactsReviews.tools[0];
    const input = tool.toInput?.({ toolCallIds: ["a"], title: "t" });
    expect(input).toEqual({ changes: { type: "toolCalls", toolCallIds: ["a"] }, title: "t" });
    expect(parse(OPEN.input, input).ok).toBe(true);
  });

  test("open declares source_unsupported as a non-retryable error", () => {
    expect(Object.keys(OPEN.errors ?? {}).toSorted()).toEqual([
      "diff_unparsable",
      "no_changes",
      "review_too_large",
      "source_unsupported",
    ]);
    expect(OPEN.errors?.source_unsupported?.retryable).toBe(false);
  });

  test("mutating methods declare idempotent and get is read only", () => {
    const methods = ArtifactsReviews.service.methods;
    expect(methods.get.readOnly).toBe(true);
    for (const name of ["open", "approve", "reject", "comment", "submit", "close"] as const) {
      expect(methods[name].idempotent).toBe(true);
    }
  });
});

describe("artifacts.reviews schemas", () => {
  test("the four change sources parse and an empty toolCalls list does not", () => {
    const sources = [
      { type: "turn" },
      { type: "turn", turnId: rawId("trn", 1) },
      { type: "toolCalls", toolCallIds: ["a"] },
      { type: "checkpoint", checkpointId: rawId("ckp", 1) },
      { type: "patch", patch: "--- a\n+++ b" },
    ];
    for (const source of sources) expect(parse(ChangeSourceSchema, source).ok).toBe(true);
    expect(parse(ChangeSourceSchema, { type: "toolCalls", toolCallIds: [] }).ok).toBe(false);
  });

  test("hunk ids accept f<n>h<n> and reject other strings", () => {
    expect(parse(HunkIdSchema, "f0h1").ok).toBe(true);
    expect(parse(HunkIdSchema, "x").ok).toBe(false);
  });

  test("artifact and review ids use the art and rvw local prefixes", () => {
    expect(parse(ArtifactIdSchema, `art_${ULID}`).ok).toBe(true);
    expect(parse(ArtifactIdSchema, `rvw_${ULID}`).ok).toBe(false);
    expect(parse(ReviewIdSchema, `rvw_${ULID}`).ok).toBe(true);
    expect(parse(ReviewIdSchema, `art_${ULID}`).ok).toBe(false);
  });

  test("review view accepts a minimal value and rejects an unknown status", () => {
    const view = {
      reviewId: `rvw_${ULID}`,
      threadId: rawId("thr", 1),
      artifactId: `art_${ULID}`,
      title: "t",
      status: "open",
      round: 1,
      files: [],
      comments: [],
    };
    expect(parse(ReviewViewSchema, view).ok).toBe(true);
    expect(parse(ReviewViewSchema, { ...view, status: "bogus" }).ok).toBe(false);
  });

  test("hunk decision and comment target keep the approval record shape", () => {
    const answer = ReviewAnswerSchema.properties.decisions.items.properties.decision;
    const target = ReviewAnswerSchema.properties.comments.items.properties.target;
    expect(toJsonSchema(HunkDecisionSchema)).toEqual(toJsonSchema(answer));
    expect(toJsonSchema(CommentTargetSchema)).toEqual(toJsonSchema(target));
  });
});

const SHA = "a".repeat(64);
const ARTIFACT = `art_${ULID}`;
const REGISTER = ArtifactsRegistry.service.methods.register;
const UPDATE = ArtifactsRegistry.service.methods.update;
const LIST = ArtifactsRegistry.service.methods.list;
const SET_META = ArtifactsSessions.service.methods.setMeta;

describe("artifacts.registry definition", () => {
  test("validates with no issues, warnings included", () => {
    expect(validateCapability(ArtifactsRegistry)).toEqual([]);
  });

  test("the key carries the capability id and version", () => {
    expect(ArtifactsRegistryKey).toEqual({ capability: "artifacts.registry", version: "1.0.0" });
  });

  test("the model tools are artifact_create (register) and artifact_update (update)", () => {
    expect(ArtifactsRegistry.tools.map((t) => [t.name, t.method])).toEqual([
      ["artifact_create", "register"],
      ["artifact_update", "update"],
    ]);
  });

  test("mutating methods are idempotent and list and get are read only", () => {
    const methods = ArtifactsRegistry.service.methods;
    for (const name of ["register", "update", "archive"] as const) {
      expect(methods[name].idempotent).toBe(true);
      expect(methods[name].readOnly).toBeUndefined();
    }
    for (const name of ["list", "get"] as const) {
      expect(methods[name].readOnly).toBe(true);
      expect(methods[name].idempotent).toBeUndefined();
    }
    expect(Object.keys(methods).toSorted()).toEqual([
      "archive",
      "get",
      "list",
      "register",
      "update",
    ]);
  });

  test("artifact_create without a table kind uses text/markdown and copies summary into meta", () => {
    const tool = ArtifactsRegistry.tools[0];
    const input = tool.toInput?.({
      kind: "document",
      title: "글",
      text: "# 제목",
      summary: "요약",
    });
    expect(input).toEqual({
      kind: "document",
      title: "글",
      content: { type: "inline", text: "# 제목", mediaType: "text/markdown" },
      meta: { summary: "요약" },
      producer: "model",
    });
    expect(parse(REGISTER.input, input).ok).toBe(true);
  });

  test("artifact_create on a table without mediaType is text/csv and has no meta", () => {
    const tool = ArtifactsRegistry.tools[0];
    const input = tool.toInput?.({ kind: "table", title: "표", text: "a,b\n1,2" });
    expect(input).toEqual({
      kind: "table",
      title: "표",
      content: { type: "inline", text: "a,b\n1,2", mediaType: "text/csv" },
      producer: "model",
    });
    expect(parse(REGISTER.input, input).ok).toBe(true);
  });

  test("artifact_create keeps an explicit mediaType", () => {
    const input = ArtifactsRegistry.tools[0].toInput?.({
      kind: "log",
      title: "로그",
      text: "ok",
      mediaType: "text/plain",
    });
    expect(input).toEqual({
      kind: "log",
      title: "로그",
      content: { type: "inline", text: "ok", mediaType: "text/plain" },
      producer: "model",
    });
  });

  test("artifact_update maps text to inline content and summary to meta", () => {
    const tool = ArtifactsRegistry.tools[1];
    const input = tool.toInput?.({
      artifactId: ARTIFACT,
      baseVersion: 2,
      text: "새 본문",
      summary: "요약",
    });
    expect(input).toEqual({
      artifactId: ARTIFACT,
      baseVersion: 2,
      content: { type: "inline", text: "새 본문", mediaType: "text/markdown" },
      meta: { summary: "요약" },
    });
    expect(parse(UPDATE.input, input).ok).toBe(true);
  });

  test("artifact_update with only a title sends no content", () => {
    const input = ArtifactsRegistry.tools[1].toInput?.({
      artifactId: ARTIFACT,
      baseVersion: 1,
      title: "새 제목",
    });
    expect(input).toEqual({ artifactId: ARTIFACT, baseVersion: 1, title: "새 제목" });
  });
});

describe("artifacts.registry schemas", () => {
  test("kind accepts the built-in kinds and a three-part extension kind", () => {
    for (const kind of [
      "document",
      "table",
      "plan",
      "changeset",
      "file",
      "image",
      "log",
      "x.mermaid.diagram",
      "grp.team.report",
    ]) {
      expect(parse(ArtifactKindSchema, kind).ok).toBe(true);
    }
  });

  test("kind rejects an unknown word, an uppercase word and a two-part extension", () => {
    for (const kind of ["bogus", "Document", "x.mermaid", "y.mermaid.diagram"]) {
      expect(parse(ArtifactKindSchema, kind).ok).toBe(false);
    }
  });

  test("baseVersion must be at least 1", () => {
    expect(parse(UPDATE.input, { artifactId: ARTIFACT, baseVersion: 0 }).ok).toBe(false);
    expect(parse(UPDATE.input, { artifactId: ARTIFACT, baseVersion: 1 }).ok).toBe(true);
  });

  test("list limit is 1 to 200", () => {
    expect(parse(LIST.input, { limit: 200 }).ok).toBe(true);
    expect(parse(LIST.input, { limit: 201 }).ok).toBe(false);
    expect(parse(LIST.input, { limit: 0 }).ok).toBe(false);
  });

  test("content accepts inline, blob and file and rejects an unknown type or media type", () => {
    expect(
      parse(ArtifactContentInputSchema, { type: "inline", text: "x", mediaType: "text/plain" }).ok,
    ).toBe(true);
    expect(
      parse(ArtifactContentInputSchema, {
        type: "blob",
        ref: { type: "blob", sha256: SHA, size: 1, mediaType: null },
      }).ok,
    ).toBe(true);
    expect(parse(ArtifactContentInputSchema, { type: "file", path: "a.md" }).ok).toBe(true);
    expect(parse(ArtifactContentInputSchema, { type: "url", href: "x" }).ok).toBe(false);
    expect(
      parse(ArtifactContentInputSchema, { type: "inline", text: "x", mediaType: "plain" }).ok,
    ).toBe(false);
  });

  test("the blob ref shape is the same as the records BlobRef", () => {
    expect(toJsonSchema(ArtifactBlobRefSchema)).toEqual(toJsonSchema(BlobRefSchema));
  });

  test("media type needs a type and a subtype", () => {
    expect(parse(MediaTypeSchema, "text/csv").ok).toBe(true);
    expect(parse(MediaTypeSchema, "csv").ok).toBe(false);
  });

  test("producer accepts model, user, cap.<domain> and extension owners", () => {
    for (const producer of ["model", "user", "cap.artifacts", "x.mermaid"]) {
      expect(parse(ArtifactProducerSchema, producer).ok).toBe(true);
    }
    expect(parse(ArtifactProducerSchema, "bogus").ok).toBe(false);
  });

  test("meta summary is at most 500 characters", () => {
    expect(parse(ArtifactMetaSchema, { summary: "x".repeat(500) }).ok).toBe(true);
    expect(parse(ArtifactMetaSchema, { summary: "x".repeat(501) }).ok).toBe(false);
  });

  test("summary accepts a complete value and rejects an unknown status and version 0", () => {
    const summary = {
      artifactId: ARTIFACT,
      kind: "document",
      title: "글",
      version: 1,
      status: "active",
      content: { type: "blob", sha256: SHA, size: 3, mediaType: "text/markdown" },
      sourcePath: null,
      meta: {},
      origin: { threadId: rawId("thr", 1), turnId: null, toolCallId: null, producer: "model" },
      createdAt: 1,
      updatedAt: 1,
    };
    expect(parse(ArtifactSummarySchema, summary).ok).toBe(true);
    expect(parse(ArtifactSummarySchema, { ...summary, status: "deleted" }).ok).toBe(false);
    expect(parse(ArtifactSummarySchema, { ...summary, version: 0 }).ok).toBe(false);
  });

  test("version reference defaults to latest and rejects version 0", () => {
    expect(parse(ArtifactVersionRefSchema, { artifactId: ARTIFACT }).ok).toBe(true);
    expect(parse(ArtifactVersionRefSchema, { artifactId: ARTIFACT, version: 0 }).ok).toBe(false);
  });
});

describe("artifacts.sessions definition", () => {
  test("validates with no issues, warnings included", () => {
    expect(validateCapability(ArtifactsSessions)).toEqual([]);
  });

  test("the key carries the capability id and version", () => {
    expect(ArtifactsSessionsKey).toEqual({ capability: "artifacts.sessions", version: "1.0.0" });
  });

  test("only setMeta, list and search are defined; handoff and export wait for the second phase", () => {
    expect(Object.keys(ArtifactsSessions.service.methods).toSorted()).toEqual([
      "list",
      "search",
      "setMeta",
    ]);
    expect(ArtifactsSessions.tools.map((t) => t.name)).toEqual(["session_rename"]);
  });

  test("setMeta is idempotent and list and search are read only", () => {
    const methods = ArtifactsSessions.service.methods;
    expect(methods.setMeta.idempotent).toBe(true);
    expect(methods.list.readOnly).toBe(true);
    expect(methods.search.readOnly).toBe(true);
  });

  test("session_rename maps the title to setMeta input", () => {
    const tool = ArtifactsSessions.tools[0];
    const input = tool.toInput?.({ title: "회의 정리" });
    expect(tool.method).toBe("setMeta");
    expect(input).toEqual({ title: "회의 정리" });
    expect(parse(SET_META.input, input).ok).toBe(true);
  });

  test("label accepts letters and digits (any script), then space and ._/- up to 48 characters", () => {
    expect(parse(LabelSchema, "x".repeat(48)).ok).toBe(true);
    expect(parse(LabelSchema, "회의 메모 1.0/rc-2").ok).toBe(true);
    expect(parse(LabelSchema, "café").ok).toBe(true);
    expect(parse(LabelSchema, "a_b").ok).toBe(true);
  });

  test("label rejects 49 characters, a leading mark or underscore, a disallowed symbol and an empty value", () => {
    expect(parse(LabelSchema, "x".repeat(49)).ok).toBe(false);
    expect(parse(LabelSchema, "_x").ok).toBe(false);
    expect(parse(LabelSchema, "a#b").ok).toBe(false);
    expect(parse(LabelSchema, "").ok).toBe(false);
  });

  test("setMeta rejects a label that is too long inside labels.add", () => {
    expect(parse(SET_META.input, { labels: { add: ["x".repeat(49)] } }).ok).toBe(false);
    expect(parse(SET_META.input, { labels: { add: ["x".repeat(48)] } }).ok).toBe(true);
  });

  test("session view accepts a minimal value and rejects an unknown title source", () => {
    const view = {
      threadId: rawId("thr", 1),
      title: null,
      titleSource: null,
      labels: [],
      workspace: null,
      artifactCount: 0,
      handoffFrom: null,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(parse(SessionMetaViewSchema, view).ok).toBe(true);
    expect(parse(SessionMetaViewSchema, { ...view, titleSource: "bogus" }).ok).toBe(false);
  });
});

describe("artifacts definitions with the rest of the set", () => {
  test("the group lists the three ids in order and each has no validation issues", () => {
    expect(ARTIFACTS_CAPABILITIES.map((d) => d.id)).toEqual([
      "artifacts.registry",
      "artifacts.reviews",
      "artifacts.sessions",
    ]);
    expect(ARTIFACTS_CAPABILITIES.map((d) => validateCapability(d))).toEqual([[], [], []]);
  });

  test("the group and the work definitions share no tool name", () => {
    const issues = validateCapabilitySet([...WORK_CAPABILITIES, ...ARTIFACTS_CAPABILITIES]);
    expect(issues.filter((i) => i.code === "tool_name_conflict")).toEqual([]);
  });
});
