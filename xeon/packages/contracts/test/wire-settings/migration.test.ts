import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  MIGRATION_WIRE_METHODS,
  MigrationApplyParamsSchema,
  MigrationApplyResultSchema,
  MigrationChangedParamsSchema,
  MigrationDetectParamsSchema,
  MigrationDetectResultSchema,
  MigrationDismissParamsSchema,
  MigrationProgressParamsSchema,
  MigrationProposalParamsSchema,
  MigrationProposalResultSchema,
  MigrationReportGetResultSchema,
  MigrationScanParamsSchema,
  MigrationScanResultSchema,
} from "../../src/wire-settings/wire/migration.ts";
import {
  WIRE_ERRORS,
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
} from "../../src/wire-settings/wire/index.ts";
import { TrustStatusSchema } from "../../src/wire-settings/wire/methods.ts";

// 가져오기 wire(docs/xeon/review/m5/migration.md §7.7 [제안]). 값을 그대로 옮기는지, 잘못된 값을 거절하는지, 시크릿 값 필드가 없는지 본다.

const ROOT = "/work/project";
const ID = "a1b2c3d4e5f60718";
const NOTICE = {
  code: "foreign_format_found",
  willStopReading: [".mcp.json", "../.agents/skills"],
  importable: ["CLAUDE.md"],
  importAvailable: true,
};
const ITEM = {
  itemId: ID,
  harness: "claude-code",
  kind: "mcp",
  scope: "project",
  path: "~/work/project/.mcp.json",
  bytes: 412,
  secretCount: 1,
};
const REPORT_EXACT = {
  itemId: ID,
  harness: "agent-skills",
  kind: "skill",
  label: "스킬 deploy",
  source: { scope: "project", path: "~/work/project/.agents/skills/deploy/SKILL.md" },
  status: "exact",
  differences: [],
  output: { plugin: "agent-skills-project-skills", path: "skills/deploy/SKILL.md" },
};
const REPORT_NOT_PORTED = {
  itemId: ID,
  harness: "claude-code",
  kind: "instruction",
  label: "지침 CLAUDE.md",
  source: { scope: "project", path: "~/work/project/CLAUDE.md", key: "sections" },
  status: "not_ported",
  differences: [{ kind: "scope_change", text: "프로젝트 파일이라 옮기지 않는다" }],
  reason: { code: "not_read_by_fresnel", text: "Fresnel은 CLAUDE.md를 읽지 않는다" },
  alternative: "내용을 AGENTS.md로 옮긴다",
};

/** 값이 스키마를 지나 그대로 돌아오는가 */
function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

function accepts(schema: TSchema, value: unknown): boolean {
  return parse(schema, value).ok;
}

describe("migration.detect", () => {
  test("params take a workspace path with the trust.get length limit", () => {
    expect(accepts(MigrationDetectParamsSchema, { workspace: ROOT })).toBe(true);
    expect(accepts(MigrationDetectParamsSchema, {})).toBe(false);
    expect(accepts(MigrationDetectParamsSchema, { workspace: "" })).toBe(false);
    expect(accepts(MigrationDetectParamsSchema, { workspace: "x".repeat(4097) })).toBe(false);
    expect(accepts(MigrationDetectParamsSchema, { workspace: ROOT, extra: 1 })).toBe(false);
  });

  test("the result lists markers with a three-value harness and a notice or null", () => {
    roundTrip(MigrationDetectResultSchema, {
      found: [
        // M5g-2 뒤 엔진은 두 표지를 읽지 않는다(`engineReads` 거짓). 신호는 그대로 나간다
        { marker: ".mcp.json", harness: "claude-code", engineReads: false, importable: true },
        {
          marker: "../.agents/skills",
          harness: "agent-skills",
          engineReads: false,
          importable: true,
        },
        { marker: ".cursorrules", harness: "other", engineReads: false, importable: false },
      ],
      notice: NOTICE,
    });
    roundTrip(MigrationDetectResultSchema, { found: [], notice: null });
    // 감지는 `agents-md`를 싣지 않는다(존재만 보는 표는 세 값이다)
    const agentsMd = {
      found: [{ marker: "AGENTS.md", harness: "agents-md", engineReads: false, importable: false }],
      notice: null,
    };
    expect(accepts(MigrationDetectResultSchema, agentsMd)).toBe(false);
    expect(accepts(MigrationDetectResultSchema, { found: [], notice: undefined })).toBe(false);
    expect(
      accepts(MigrationDetectResultSchema, {
        found: [],
        notice: { ...NOTICE, code: "foreign_format_lost" },
      }),
    ).toBe(false);
  });
});

describe("migration.scan", () => {
  test("params take one to 64 absolute roots with a user or project scope", () => {
    roundTrip(MigrationScanParamsSchema, {
      roots: [
        { path: "/Users/tester", scope: "user", label: "홈" },
        { path: ROOT, scope: "project", label: "project" },
      ],
    });
    expect(accepts(MigrationScanParamsSchema, { roots: [] })).toBe(false);
    expect(
      accepts(MigrationScanParamsSchema, {
        roots: [{ path: ROOT, scope: "system", label: "x" }],
      }),
    ).toBe(false);
    expect(
      accepts(MigrationScanParamsSchema, { roots: [{ path: ROOT, scope: "project", label: "" }] }),
    ).toBe(false);
    expect(
      accepts(MigrationScanParamsSchema, {
        roots: Array.from({ length: 65 }, () => ({ path: ROOT, scope: "project", label: "p" })),
      }),
    ).toBe(false);
  });

  test("the result carries item counts, diagnostics with an optional path, and no value", () => {
    roundTrip(MigrationScanResultSchema, {
      scanId: "scn_1",
      summary: { itemCount: 1 },
      items: [ITEM],
      diagnostics: [
        { code: "too_large", path: "~/work/project/CLAUDE.md", message: "1 MiB를 넘었다" },
        { code: "limit", message: "스킬 파일 수 상한" },
      ],
    });
    expect(
      accepts(MigrationScanResultSchema, {
        scanId: "scn_1",
        summary: { itemCount: 0 },
        items: [],
        diagnostics: [{ code: "invalid_yaml", message: "x" }],
      }),
    ).toBe(false);
    expect(
      accepts(MigrationScanResultSchema, { scanId: "scn_1", items: [], diagnostics: [] }),
    ).toBe(false);
  });

  test("a scanned item carries a secret count and never a secret value", () => {
    expect(
      accepts(MigrationScanResultSchema, {
        scanId: "s",
        summary: { itemCount: 1 },
        items: [{ ...ITEM, secretCount: -1 }],
        diagnostics: [],
      }),
    ).toBe(false);
    expect(
      accepts(MigrationScanResultSchema, {
        scanId: "s",
        summary: { itemCount: 1 },
        items: [{ ...ITEM, secretCount: 1.5 }],
        diagnostics: [],
      }),
    ).toBe(false);
    // 값, 시크릿 목록, 키 이름 어느 것도 항목에 실을 수 없다(닫힌 객체)
    for (const extra of [
      { value: "x-probe" },
      { secretValue: "x-probe" },
      { secrets: [{ keyPath: "env.API_KEY", kind: "literal" }] },
      { secretName: "github-token" },
    ]) {
      expect(
        accepts(MigrationScanResultSchema, {
          scanId: "s",
          summary: { itemCount: 1 },
          items: [{ ...ITEM, ...extra }],
          diagnostics: [],
        }),
      ).toBe(false);
    }
    const serialized = JSON.stringify([
      MigrationScanResultSchema,
      MigrationProposalResultSchema,
      MigrationReportGetResultSchema,
    ]);
    expect(serialized).not.toMatch(/"(value|values|secret|secrets|secretValue|token|password)":/);
  });
});

describe("migration.proposal", () => {
  test("params take a scan id and optional choices with answers", () => {
    roundTrip(MigrationProposalParamsSchema, { scanId: "scn_1" });
    roundTrip(MigrationProposalParamsSchema, {
      scanId: "scn_1",
      choices: { answers: { "q-model-alias": "omit" }, existingPlugins: ["mcp-github"] },
    });
    expect(accepts(MigrationProposalParamsSchema, {})).toBe(false);
    expect(
      accepts(MigrationProposalParamsSchema, {
        scanId: "scn_1",
        choices: { answers: {}, extra: 1 },
      }),
    ).toBe(false);
  });

  test("the result carries plugin summaries without a folder tree, profile proposals, questions and report lines", () => {
    roundTrip(MigrationProposalResultSchema, {
      proposalId: "prp_1",
      plugins: [
        {
          name: "mcp-github",
          purpose: "GitHub MCP 서버(Claude Code에서 가져옴)",
          derivedFrom: [ID],
        },
      ],
      profileProposals: [
        { name: "project", pluginNames: ["mcp-github"], scope: "project" },
        { name: "common", pluginNames: [], scope: "user-common" },
      ],
      questions: [
        {
          id: "q-model-alias",
          itemId: ID,
          text: "모델 별칭을 어떻게 옮길까?",
          options: ["omit", "claude-sonnet"],
        },
      ],
      report: [REPORT_EXACT, REPORT_NOT_PORTED],
    });
    // 폴더 트리 바이트는 wire에 싣지 않는다
    expect(
      accepts(MigrationProposalResultSchema, {
        proposalId: "prp_1",
        plugins: [{ name: "a", purpose: "b", derivedFrom: [], tree: {} }],
        profileProposals: [],
        questions: [],
        report: [],
      }),
    ).toBe(false);
  });

  test("questions, report lines and profile scopes take only the library's values", () => {
    const base = {
      proposalId: "prp_1",
      plugins: [],
      profileProposals: [],
      questions: [],
      report: [],
    };
    expect(
      accepts(MigrationProposalResultSchema, {
        ...base,
        questions: [{ id: "q", itemId: ID, text: "t", options: [] }],
      }),
    ).toBe(false);
    expect(
      accepts(MigrationProposalResultSchema, {
        ...base,
        report: [{ ...REPORT_EXACT, status: "draft" }],
      }),
    ).toBe(false);
    expect(
      accepts(MigrationProposalResultSchema, {
        ...base,
        report: [{ ...REPORT_EXACT, kind: "hook" }],
      }),
    ).toBe(false);
    expect(
      accepts(MigrationProposalResultSchema, {
        ...base,
        report: [{ ...REPORT_EXACT, differences: [{ kind: "fancy", text: "x" }] }],
      }),
    ).toBe(false);
    expect(
      accepts(MigrationProposalResultSchema, {
        ...base,
        profileProposals: [{ name: "p", pluginNames: [], scope: "global" }],
      }),
    ).toBe(false);
  });
});

describe("migration.apply", () => {
  test("params need the proposal id and choices, and take createProfiles", () => {
    roundTrip(MigrationApplyParamsSchema, { proposalId: "prp_1", choices: { answers: {} } });
    roundTrip(MigrationApplyParamsSchema, {
      proposalId: "prp_1",
      choices: { answers: {} },
      createProfiles: ["project"],
    });
    expect(accepts(MigrationApplyParamsSchema, { proposalId: "prp_1" })).toBe(false);
    expect(
      accepts(MigrationApplyParamsSchema, {
        proposalId: "prp_1",
        choices: { answers: {} },
        createProfiles: [""],
      }),
    ).toBe(false);
  });

  test("the result lists drafts, profiles and the report id", () => {
    roundTrip(MigrationApplyResultSchema, {
      drafts: [{ name: "mcp-github", draftId: "dft_1", itemId: ID }],
      profiles: [{ profileId: "prf_1", name: "project" }],
      reportId: "rpt_1",
    });
    expect(
      accepts(MigrationApplyResultSchema, { drafts: [], profiles: [], reportId: "rpt_1", x: 1 }),
    ).toBe(false);
  });
});

describe("migration.report.get and migration.dismiss", () => {
  test("the report comes with one rules version per harness", () => {
    roundTrip(MigrationReportGetResultSchema, {
      report: [REPORT_EXACT, REPORT_NOT_PORTED],
      rulesVersions: { "claude-code": "2026-11-17", "agent-skills": "2026-11-17" },
    });
    expect(
      accepts(MigrationReportGetResultSchema, {
        report: [],
        rulesVersions: { "claude-code": 1 },
      }),
    ).toBe(false);
  });

  test("dismiss takes a root and a marker and answers with an empty object", () => {
    roundTrip(MigrationDismissParamsSchema, { root: ROOT, marker: ".mcp.json" });
    expect(accepts(MigrationDismissParamsSchema, { root: ROOT })).toBe(false);
    const result = MIGRATION_WIRE_METHODS["migration.dismiss"].result;
    roundTrip(result, {});
    expect(accepts(result, { ok: true })).toBe(false);
  });
});

describe("migration notifications", () => {
  test("progress carries the scan id and counts", () => {
    roundTrip(MigrationProgressParamsSchema, { scanId: "scn_1", done: 3, total: 10 });
    expect(accepts(MigrationProgressParamsSchema, { scanId: "scn_1", done: -1, total: 10 })).toBe(
      false,
    );
    expect(
      accepts(MigrationProgressParamsSchema, { scanId: "scn_1", done: 1, total: 2, extra: 1 }),
    ).toBe(false);
  });

  test("changed names the kind of change and nothing else", () => {
    for (const kind of ["scan", "proposal", "apply", "dismiss"]) {
      roundTrip(MigrationChangedParamsSchema, { kind });
    }
    expect(accepts(MigrationChangedParamsSchema, { kind: "done" })).toBe(false);
    expect(accepts(MigrationChangedParamsSchema, { kind: "scan", scanId: "scn_1" })).toBe(false);
  });

  test("both notifications sit in the server table at stage M4", () => {
    expect(WIRE_NOTIFICATIONS["migration.progress"].stage).toBe("M4");
    expect(WIRE_NOTIFICATIONS["migration.changed"].stage).toBe("M4");
    roundTrip(WIRE_NOTIFICATIONS["migration.changed"].params, { kind: "apply" });
  });
});

describe("migration methods and errors in the registry", () => {
  test("the registry table names exactly the six migration methods, all at stage M4", () => {
    expect(Object.keys(MIGRATION_WIRE_METHODS).toSorted()).toEqual(
      [
        "migration.apply",
        "migration.detect",
        "migration.dismiss",
        "migration.proposal",
        "migration.report.get",
        "migration.scan",
      ].toSorted(),
    );
    // 레지스트리 순서는 정의 순서다(detect, scan, proposal, apply, report.get, dismiss)
    expect(
      Object.entries(WIRE_METHODS)
        .filter(([name]) => name.startsWith("migration."))
        .map(([name, spec]) => [name, spec.stage]),
    ).toEqual([
      ["migration.detect", "M4"],
      ["migration.scan", "M4"],
      ["migration.proposal", "M4"],
      ["migration.apply", "M4"],
      ["migration.report.get", "M4"],
      ["migration.dismiss", "M4"],
    ]);
  });

  test("the migration errors live in 3670~3679 and none is retryable", () => {
    const own = Object.values(WIRE_ERRORS).filter((s) => s.kind.startsWith("migration."));
    expect(own.map((s) => [s.kind, s.code])).toEqual([
      ["migration.scanLimit", 3670],
      ["migration.rootInvalid", 3671],
      ["migration.questionsOpen", 3672],
      ["migration.nameConflict", 3673],
      ["migration.unsupportedHarness", 3674],
      ["migration.notFound", 3675],
    ]);
    for (const spec of own) {
      expect({ kind: spec.kind, retryable: spec.retryable }).toEqual({
        kind: spec.kind,
        retryable: false,
      });
    }
  });
});

describe("TrustStatus.foreignFormats", () => {
  const trust = {
    projectRoot: ROOT,
    required: true,
    verdict: "undecided",
    via: "headless",
    resources: [".mcp.json"],
    options: [],
  };

  test("the signal is optional: a status without it still passes", () => {
    roundTrip(TrustStatusSchema, trust);
  });

  test("the signal carries the notice shape when present", () => {
    roundTrip(TrustStatusSchema, { ...trust, foreignFormats: NOTICE });
    expect(
      accepts(TrustStatusSchema, {
        ...trust,
        foreignFormats: { ...NOTICE, importAvailable: "yes" },
      }),
    ).toBe(false);
    expect(accepts(TrustStatusSchema, { ...trust, foreignFormats: { code: "other" } })).toBe(false);
  });
});
