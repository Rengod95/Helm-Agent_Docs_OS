import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { FieldVM } from "@fresnel/client/settings";
import { err, ok } from "@fresnel/contracts";
import { renderToString } from "react-dom/server";
import type { FieldHandlers } from "../../src/views/pages/settings/settings-field.tsx";
import { PermissionRulesTable } from "../../src/views/pages/settings/settings-rules-panel.tsx";
import {
  changedVerdictsOf,
  checkNewDomain,
  domainRowsOf,
  withDomainVerdict,
} from "../../src/views/pages/settings/settings-rules-web.ts";
import {
  sandboxCheckStepsOf,
  sandboxSelfTestStepsOf,
  selfTestViewOfLast,
} from "../../src/views/pages/settings/settings-sandbox-panel.tsx";
import { CheckSteps } from "../../src/views/pages/shared/check-steps.tsx";
import { ListEditor } from "../../src/views/pages/shared/list-editor.tsx";
import { VerdictTable, type VerdictRow } from "../../src/views/pages/shared/verdict-table.tsx";
import { defOf, fieldIn, settingOf, viewOf } from "./settings-fixtures.ts";

// 권한·샌드박스 구역(DP-109, DP-110)의 공용 부품과 순수 모델. 값은 `toEqual`, 그림은 서버 렌더 글로 비교한다.

const NOOP = (): void => undefined;
const handlers: FieldHandlers = {
  edit: NOOP,
  change: NOOP,
  commit: NOOP,
  discard: NOOP,
  keepDraft: NOOP,
  reset: NOOP,
};
const verdictLabel = (verdict: "allow" | "ask" | "deny"): string =>
  t(`desktop.settings.verdict.${verdict}`);

/** 서버 렌더가 바꾼 `>` */
function escaped(text: string): string {
  return text.replaceAll(">", "&gt;");
}

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("VerdictTable", () => {
  const rows: readonly VerdictRow[] = [
    { key: "read", subject: "read", verdict: "allow" },
    { key: "bash", subject: "bash", verdict: "deny", locked: true },
  ];

  test("each row shows its subject, and a locked row shows its verdict as text", () => {
    const html = renderToString(
      <VerdictTable
        label="rules"
        subjectHeader="대상"
        verdictHeader="판정"
        choices={["allow", "ask", "deny"]}
        verdictLabel={verdictLabel}
        rows={rows}
        onVerdict={NOOP}
        onRemove={NOOP}
        removeLabel={(row) => `remove ${row.key}`}
        emptyText="none"
      />,
    );
    expect(countOf(html, 'role="row"')).toBe(3);
    expect(html).toContain(">read<");
    expect(html).toContain(">bash<");
    expect(html).toContain("remove read");
    expect(html).not.toContain("remove bash");
    expect(html).not.toContain(">none<");
  });

  test("an empty table shows the hint and the example chips", () => {
    const html = renderToString(
      <VerdictTable
        label="rules"
        subjectHeader="대상"
        verdictHeader="판정"
        choices={["allow", "deny"]}
        verdictLabel={verdictLabel}
        rows={[]}
        onVerdict={NOOP}
        emptyText="아직 없어요"
        examples={[{ subject: "bash(git status)", verdict: "allow" }]}
        onExample={NOOP}
      />,
    );
    expect(html).toContain("아직 없어요");
    expect(html).toContain("bash(git status)");
  });

  test("the add row shows its refusal under the table", () => {
    const html = renderToString(
      <VerdictTable
        label="rules"
        subjectHeader="대상"
        verdictHeader="판정"
        choices={["allow", "ask", "deny"]}
        verdictLabel={verdictLabel}
        rows={rows}
        onVerdict={NOOP}
        emptyText="none"
        addLabel="추가"
        add={{
          subject: "git status",
          placeholder: "read",
          verdict: "ask",
          error: "형식이 달라요",
          onSubject: NOOP,
          onVerdict: NOOP,
          onAdd: NOOP,
        }}
      />,
    );
    expect(html).toContain('value="git status"');
    expect(html).toContain("형식이 달라요");
  });
});

describe("ListEditor", () => {
  const base = {
    label: "paths",
    emptyText: "비었어요",
    draft: "",
    placeholder: "경로",
    error: null,
    onDraft: NOOP,
    onAdd: NOOP,
    onRemove: NOOP,
    removeLabel: (item: string) => `지우기 ${item}`,
    addLabel: "추가",
  };

  test("an empty list says so; a pick button appears only when given", () => {
    const html = renderToString(<ListEditor {...base} items={[]} />);
    expect(html).toContain("비었어요");
    expect(html).not.toContain("폴더 고르기");
    const picking = renderToString(
      <ListEditor {...base} items={[]} onPick={NOOP} pickLabel="폴더 고르기" />,
    );
    expect(picking).toContain("폴더 고르기");
  });

  test("items show with their remove labels, and the error under the add row", () => {
    const html = renderToString(
      <ListEditor {...base} items={["/srv", "~/a"]} error="이미 있어요" />,
    );
    expect(countOf(html, 'data-slot="list-editor-item"')).toBe(2);
    expect(html).toContain("지우기 /srv");
    expect(html).toContain("이미 있어요");
  });

  test("a disabled editor disables its controls", () => {
    const html = renderToString(<ListEditor {...base} items={["/srv"]} disabled />);
    expect(countOf(html, "disabled")).toBeGreaterThanOrEqual(3);
  });
});

const RULES_TYPE = { type: "array", items: { type: "object" } };

function rulesField(value: unknown): FieldVM {
  const key = "l1.tools.rules";
  const field = fieldIn(
    viewOf([defOf(key, "permissions", "table", RULES_TYPE)], [settingOf(key, value)]),
    key,
  );
  if (field === undefined) throw new Error("field must exist");
  return field;
}

describe("PermissionRulesTable", () => {
  test("no rule shows the empty hint with examples", () => {
    const html = renderToString(
      <PermissionRulesTable field={rulesField([])} editable handlers={handlers} />,
    );
    expect(html).toContain(t("desktop.settings.perm.rules.empty"));
    expect(html).toContain("bash(git status)");
  });

  test("rules show their pattern and memo, overlapping allow and deny note each other", () => {
    const html = renderToString(
      <PermissionRulesTable
        field={rulesField([
          { id: "allow-bash", action: "tool.call", resource: { tool: "bash" }, effect: "allow" },
          {
            id: "deny-all",
            action: "tool.call",
            resource: {},
            effect: "deny",
            description: "기본 막기",
          },
        ])}
        editable
        handlers={handlers}
      />,
    );
    expect(html).toContain(">bash<");
    expect(html).toContain(">*<");
    expect(html).toContain('value="기본 막기"');
    expect(html).toContain(escaped(t("desktop.settings.perm.rules.conflict", { rules: "*" })));
    expect(html).toContain(escaped(t("desktop.settings.perm.rules.conflict", { rules: "bash" })));
  });

  test("a rule with other conditions is shown as a summary with a badge", () => {
    const html = renderToString(
      <PermissionRulesTable
        field={rulesField([
          { id: "docs", action: "tool.call", resource: { mcpServer: "docs" }, effect: "ask" },
        ])}
        editable
        handlers={handlers}
      />,
    );
    expect(html).toContain("docs");
    expect(html).toContain(t("desktop.settings.perm.rules.moreConditions"));
  });

  test("an unreadable value shows the unreadable note", () => {
    const html = renderToString(
      <PermissionRulesTable field={rulesField("bash")} editable handlers={handlers} />,
    );
    expect(html).toContain(t("desktop.settings.rules.unreadable"));
  });
});

describe("web access lists", () => {
  const lists = { allow: ["a.com", "b.com"], ask: ["c.com"], deny: ["b.com"] };

  test("rows keep list order and a domain in two lists shows its strongest verdict once", () => {
    expect(domainRowsOf(lists)).toEqual([
      { domain: "a.com", verdict: "allow" },
      { domain: "b.com", verdict: "deny" },
      { domain: "c.com", verdict: "ask" },
    ]);
  });

  test("changing a verdict moves the domain out of every list and appends it once", () => {
    const next = withDomainVerdict(lists, "b.com", "ask");
    expect(next).toEqual({ allow: ["a.com"], ask: ["c.com", "b.com"], deny: [] });
    expect(changedVerdictsOf(lists, next)).toEqual(["allow", "ask", "deny"]);
    expect(withDomainVerdict(lists, "c.com", null)).toEqual({
      allow: ["a.com", "b.com"],
      ask: [],
      deny: ["b.com"],
    });
  });

  test("a new domain is checked and must not be in the table yet", () => {
    expect(checkNewDomain(lists, " d.com ")).toEqual({ ok: true, value: "d.com" });
    expect(checkNewDomain(lists, "c.com")).toEqual({ ok: false, error: "duplicate" });
    expect(checkNewDomain(lists, "").ok).toBe(false);
  });
});

describe("sandboxCheckStepsOf", () => {
  test("before and during the check only the OS step shows", () => {
    expect(sandboxCheckStepsOf({ kind: "idle" })).toEqual([
      { id: "os", label: t("desktop.settings.sandbox.check.os"), state: "waiting" },
    ]);
    expect(sandboxCheckStepsOf({ kind: "running" })[0]?.state).toBe("running");
  });

  test("macOS checks rg only; a missing tool fails with its impact and fix", () => {
    const steps = sandboxCheckStepsOf({
      kind: "done",
      elapsedMs: 40,
      binaries: {
        platform: "darwin",
        ready: false,
        rows: [
          {
            name: "rg",
            need: "required",
            usedBy: "sandbox",
            ok: false,
            impact: "검색이 느려요",
            note: "brew install ripgrep",
          },
        ],
      },
    });
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ["os", "passed"],
      ["rg", "failed"],
    ]);
    expect(steps[1]?.detail).toBe("검색이 느려요");
    expect(steps[1]?.fix).toBe("brew install ripgrep");
    // 옛 엔진 화면의 "필수/선택" 열은 도구 줄의 구분 글로 온다(AGE-69). 운영체제 줄에는 없다
    expect(steps.map((step) => step.tag ?? null)).toEqual([
      null,
      t("desktop.settings.sandbox.check.need.required"),
    ]);
  });

  test("an optional tool shows the optional tag, and the row draws it after the name", () => {
    const steps = sandboxCheckStepsOf({
      kind: "done",
      elapsedMs: 3,
      binaries: {
        platform: "darwin",
        ready: true,
        rows: [
          { name: "rg", need: "optional", usedBy: "sandbox", ok: true, impact: "", note: "14.1" },
        ],
      },
    });
    expect(steps[1]?.tag).toBe(t("desktop.settings.sandbox.check.need.optional"));
    const html = renderToString(<CheckSteps label="check" steps={steps} />);
    const tag = `>${t("desktop.settings.sandbox.check.need.optional")}<`;
    expect(html.indexOf(">rg<")).toBeGreaterThan(-1);
    expect(html.indexOf(">rg<")).toBeLessThan(html.indexOf(tag));
    expect(html.indexOf(tag)).toBeLessThan(html.indexOf(">14.1<"));
  });

  test("Linux checks rg, bwrap and socat; a tool missing from the report is skipped", () => {
    const steps = sandboxCheckStepsOf({
      kind: "done",
      elapsedMs: 10,
      binaries: {
        platform: "linux",
        ready: false,
        rows: [
          { name: "rg", need: "required", usedBy: "sandbox", ok: true, impact: "", note: "14.1" },
          { name: "bwrap", need: "required", usedBy: "sandbox", ok: true, impact: "", note: "0.8" },
        ],
      },
    });
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ["os", "passed"],
      ["rg", "passed"],
      ["bwrap", "passed"],
      ["socat", "skipped"],
    ]);
  });

  test("another OS fails the OS step, and no report fails with the connection fix", () => {
    const other = sandboxCheckStepsOf({
      kind: "done",
      elapsedMs: 5,
      binaries: { platform: "win32", ready: false, rows: [] },
    });
    expect(other.map((step) => step.state)).toEqual(["failed"]);
    expect(sandboxCheckStepsOf({ kind: "failed" })[0]?.fix).toBe(
      t("desktop.settings.sandbox.check.noReportFix"),
    );
  });
});

describe("sandboxSelfTestStepsOf", () => {
  const REPORT = {
    at: 1_700_000_000_000,
    durationMs: 9,
    passed: false,
    items: [
      { id: "protected_read_denied" as const, passed: true, detail: "exit=1" },
      { id: "network_denied" as const, passed: false, detail: "exit=0" },
    ],
  };

  test("a report shows one step per item: a passed item has no detail, a failed one has its reason and a fix", () => {
    expect(sandboxSelfTestStepsOf({ kind: "report", report: REPORT })).toEqual([
      {
        id: "protected_read_denied",
        label: t("desktop.settings.sandbox.selfTest.item.protectedReadDenied"),
        state: "passed",
      },
      {
        id: "network_denied",
        label: t("desktop.settings.sandbox.selfTest.item.networkDenied"),
        state: "failed",
        detail: t("desktop.settings.sandbox.selfTest.itemFailed", { reason: "exit=0" }),
        fix: t("desktop.settings.sandbox.selfTest.fix"),
      },
    ]);
  });

  test("a run in progress, no result yet, and a failed read each show one status step", () => {
    const title = t("desktop.settings.sandbox.selfTest.title");
    expect(sandboxSelfTestStepsOf({ kind: "running" })).toEqual([
      { id: "selfTest", label: title, state: "running" },
    ]);
    expect(sandboxSelfTestStepsOf({ kind: "never" })).toEqual([
      {
        id: "selfTest",
        label: title,
        state: "waiting",
        detail: t("desktop.settings.sandbox.selfTest.never"),
      },
    ]);
    expect(sandboxSelfTestStepsOf({ kind: "failed" })).toEqual([
      {
        id: "selfTest",
        label: title,
        state: "failed",
        detail: t("desktop.settings.sandbox.selfTest.failed"),
        fix: t("desktop.settings.sandbox.selfTest.fix"),
      },
    ]);
  });

  test("an old host without the methods draws no self-test step", () => {
    expect(sandboxSelfTestStepsOf({ kind: "unsupported" })).toEqual([]);
  });
});

describe("selfTestViewOfLast", () => {
  const REPORT = {
    at: 1_700_000_000_000,
    durationMs: 9,
    passed: true,
    items: [{ id: "env_allowlist" as const, passed: true }],
  };

  test("the last result is none yet, a report, an old host, or a failed read", () => {
    expect(selfTestViewOfLast(ok({ report: null }))).toEqual({ kind: "never" });
    expect(selfTestViewOfLast(ok({ report: REPORT }))).toEqual({ kind: "report", report: REPORT });
    expect(selfTestViewOfLast(err({ kind: "unsupported" }))).toEqual({ kind: "unsupported" });
    expect(selfTestViewOfLast(err({ kind: "failed" }))).toEqual({ kind: "failed" });
  });
});
