import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { McpServerRow, McpToolRow } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  McpFormBody,
  McpServersView,
  type McpServersViewProps,
} from "../../src/views/pages/settings/settings-mcp-view.tsx";
import { EMPTY_DRAFT, type McpDraft } from "../../src/views/pages/settings/settings-mcp-model.ts";

// "MCP 서버" 구역의 그림. 행이 보이는 글(상태, 출처, 막힌 사유, 오류, 숨은 도구)과 펼친 내용, 폼 본문의 칸과 경고를 본다.
// 대화 상자는 포털이라 서버에서 그리지 않으므로 폼 본문을 따로 그린다(`settings-mcp-view.tsx`).

const NOOP = (): void => undefined;

function rowOf(overrides: Partial<McpServerRow>): McpServerRow {
  return {
    server: "files",
    source: "settings:user",
    origin: "settings",
    state: "connected",
    transport: "stdio",
    toolCount: 0,
    tools: [],
    alwaysBlocked: false,
    editable: true,
    ...overrides,
  };
}

function toolOf(overrides: Partial<McpToolRow>): McpToolRow {
  return { name: "read_file", exposed: true, ...overrides };
}

function viewProps(over: Partial<McpServersViewProps>): McpServersViewProps {
  return {
    load: { kind: "ready", rows: [], rev: 0 },
    offline: false,
    locale: "en-US",
    busy: new Set(),
    rowErrors: {},
    expanded: new Set(),
    onReload: NOOP,
    onAdd: NOOP,
    onToggle: NOOP,
    onAction: NOOP,
    onEdit: NOOP,
    onRemove: NOOP,
    ...over,
  };
}

function html(over: Partial<McpServersViewProps>): string {
  return renderToString(<McpServersView {...viewProps(over)} />);
}

/** 설명 글이 화면에 든 횟수. 정보 아이콘의 숨은 글 한 번이 센다 */
function countOf(markup: string, text: string): number {
  return markup.split(text).length - 1;
}

describe("McpServersView rows", () => {
  test("a connected settings row shows its source, state, and the edit and remove actions", () => {
    const markup = html({ load: { kind: "ready", rows: [rowOf({ toolCount: 3 })], rev: 0 } });
    expect(markup).toContain("설정");
    expect(markup).toContain("연결됨");
    expect(markup).toContain("도구 3개");
    expect(markup).toContain("고치기");
    expect(markup).toContain("지우기");
    expect(markup).toContain("항상 끄기");
    expect(markup).toContain("다시 시작");
  });

  test("a title shows the title with the id beside it", () => {
    const markup = html({
      load: { kind: "ready", rows: [rowOf({ title: "Files" })], rev: 0 },
    });
    expect(markup).toContain("Files");
    expect(markup).toContain("files");
  });

  test("an always-blocked server offers unblock, not block", () => {
    const markup = html({
      load: {
        kind: "ready",
        rows: [rowOf({ alwaysBlocked: true, state: "blocked", blockedReason: "denied_by_policy" })],
        rev: 0,
      },
    });
    expect(markup).toContain("차단 풀기");
    expect(markup).not.toContain("항상 끄기");
    expect(markup).toContain("차단 목록에 있어요");
  });

  test("an approval wait shows its reason, and the explanation sits behind the info icon once", () => {
    const explanation = t("desktop.settings.mcp.blocked.approval.info");
    const markup = html({
      load: {
        kind: "ready",
        rows: [rowOf({ state: "blocked", blockedReason: "approval_required" })],
        rev: 0,
      },
    });
    expect(markup).toContain("기동 승인을 기다리는 중이에요");
    expect(countOf(markup, explanation)).toBe(1);
  });

  test("a hidden tool line shows even when the row is collapsed, with the reason in words", () => {
    const markup = html({
      load: {
        kind: "ready",
        rows: [
          rowOf({
            tools: [toolOf({ name: "read_file" })],
            hiddenTools: [
              { name: "a", reason: "name_conflict" },
              { name: "b", reason: "name_conflict" },
            ],
          }),
        ],
        rev: 0,
      },
    });
    expect(markup).toContain("숨은 도구 2개 · 다른 서버와 이름이 같아요");
    // 접힌 상태라 도구 목록은 보이지 않는다
    expect(markup).not.toContain("read_file");
  });

  test("the tool list and the stderr tail appear only when the row is expanded", () => {
    const row = rowOf({
      state: "failed",
      lastError: { code: "spawn_failed", message: "spawn failed", at: 0 },
      stderrTail: ["boot failed at line 3"],
      tools: [toolOf({ name: "read_file", title: "Read a file" })],
    });
    const collapsed = html({ load: { kind: "ready", rows: [row], rev: 0 } });
    expect(collapsed).toContain("spawn failed");
    expect(collapsed).not.toContain("boot failed at line 3");
    expect(collapsed).not.toContain("read_file");
    const expanded = html({
      load: { kind: "ready", rows: [row], rev: 0 },
      expanded: new Set(["files"]),
    });
    expect(expanded).toContain("boot failed at line 3");
    expect(expanded).toContain("read_file");
    expect(expanded).toContain("Read a file");
  });

  test("a row from .mcp.json has no edit or remove action, and names the file behind its info icon", () => {
    const markup = html({
      load: {
        kind: "ready",
        rows: [rowOf({ origin: "mcpjson", source: "mcpjson:project", editable: false })],
        rev: 0,
      },
    });
    expect(markup).not.toContain("고치기");
    expect(markup).not.toContain("지우기");
    expect(countOf(markup, t("desktop.settings.mcp.location.mcpjson"))).toBe(1);
  });

  test("an extension row names its extension", () => {
    const markup = html({
      load: {
        kind: "ready",
        rows: [rowOf({ origin: "extension", source: "ext:helm", editable: false })],
        rev: 0,
      },
    });
    expect(markup).toContain("확장 helm");
  });

  test("the original error text sits behind an info icon and the Korean sentence stays visible", () => {
    const markup = html({
      load: {
        kind: "ready",
        rev: 0,
        rows: [
          rowOf({
            state: "failed",
            lastError: {
              code: "connect_failed",
              message: "서버 files에 연결하지 못했어요: 원인을 알 수 없어요\nweird original",
              at: 0,
            },
          }),
        ],
      },
    });
    expect(markup).toContain("서버 files에 연결하지 못했어요: 원인을 알 수 없어요");
    expect(
      countOf(markup, t("desktop.settings.mcp.error.original", { text: "weird original" })),
    ).toBe(1);
  });

  test("a row's last action error shows under it", () => {
    const markup = html({
      load: { kind: "ready", rows: [rowOf({})], rev: 0 },
      rowErrors: { files: { id: "desktop.settings.mcp.error.failed" } },
    });
    expect(markup).toContain(t("desktop.settings.mcp.error.failed"));
  });
});

describe("McpServersView states", () => {
  test("an empty list says there are no servers", () => {
    expect(html({})).toContain(t("desktop.settings.mcp.empty"));
  });

  test("a failed read shows the failure and a reload button", () => {
    const markup = html({ load: { kind: "failed" } });
    expect(markup).toContain(t("desktop.settings.mcp.load.failed"));
    expect(markup).toContain(t("desktop.settings.mcp.reload"));
  });

  test("offline and not yet read says the engine is not connected", () => {
    expect(html({ load: { kind: "loading" }, offline: true })).toContain(
      t("desktop.settings.offline"),
    );
  });
});

/** 폼 본문을 그린 글. 칸과 경고는 그 글에서 찾는다 */
function formOf(draft: McpDraft, over: { issue?: "url"; plaintextSecret?: boolean } = {}): string {
  return renderToString(
    <McpFormBody
      draft={draft}
      issue={over.issue ?? null}
      error={null}
      plaintextSecret={over.plaintextSecret ?? false}
      onDraft={NOOP}
    />,
  );
}

describe("McpFormBody", () => {
  test("a stdio draft shows the command, the arguments and the environment rows, and no URL", () => {
    const markup = formOf({ ...EMPTY_DRAFT, transport: "stdio" });
    expect(markup).toContain(t("desktop.settings.mcp.form.command"));
    expect(markup).toContain(t("desktop.settings.mcp.form.args"));
    expect(markup).toContain(t("desktop.settings.mcp.form.env"));
    expect(markup).not.toContain(t("desktop.settings.mcp.form.url"));
  });

  test("an http draft shows the URL and the headers, and no command", () => {
    const markup = formOf({ ...EMPTY_DRAFT, transport: "http" });
    expect(markup).toContain(t("desktop.settings.mcp.form.url"));
    expect(markup).toContain(t("desktop.settings.mcp.form.headers"));
    expect(markup).not.toContain(t("desktop.settings.mcp.form.command"));
  });

  test("a plaintext secret-looking value shows the warning, and no secret reference hides it", () => {
    const warning = t("desktop.settings.mcp.form.secretWarning");
    expect(countOf(formOf(EMPTY_DRAFT, { plaintextSecret: true }), warning)).toBe(1);
    expect(countOf(formOf(EMPTY_DRAFT), warning)).toBe(0);
  });

  test("a validation issue shows its sentence under the form", () => {
    expect(formOf({ ...EMPTY_DRAFT, transport: "http" }, { issue: "url" })).toContain(
      "주소는 http:// 또는 https://로 시작해야 해요",
    );
  });
});
