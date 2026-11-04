import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import type { CommandError } from "../../src/views/commands.ts";
import { errorText } from "../../src/views/settings.tsx";
import {
  initialFileEditor,
  type FileDoc,
  type FileEditorState,
} from "../../src/views/pages/settings/settings-file-model.ts";
import {
  SettingsFileEditorView,
  type SettingsFileEditorProps,
  type SettingsFileHandlers,
} from "../../src/views/pages/settings/settings-file-view.tsx";

// 설정 파일 편집기의 서버 렌더. 읽는 중, 준비됨, 충돌, 오프라인(잠김), 읽기 실패, 저장 실패, 읽기 전용, 없는 파일을 그린다.
// 클릭과 키 입력은 DOM이 없어 시험하지 못한다(뜻은 settings-file-model.test.ts가 본다). 문장은 `t()`로 비교한다.

const NOOP = (): void => {};
const handlers: SettingsFileHandlers = {
  scope: NOOP,
  edit: NOOP,
  save: NOOP,
  discard: NOOP,
  close: NOOP,
  reread: NOOP,
};

const DOC: FileDoc = {
  path: "/home/user/.fresnel/settings.json",
  exists: true,
  readOnly: false,
  text: '{"model": "sonnet"}\n',
  sha256: "ab".repeat(32),
};

function stateOf(over: Partial<FileEditorState>): FileEditorState {
  return { ...initialFileEditor, seq: 1, phase: "ready", doc: DOC, draft: DOC.text, ...over };
}

function propsOf(over: Partial<SettingsFileEditorProps> = {}): SettingsFileEditorProps {
  return { state: stateOf({}), live: true, hasThread: false, handlers, ...over };
}

function html(props: SettingsFileEditorProps): string {
  return renderToString(<SettingsFileEditorView {...props} />);
}

/** 글이 그 문장 하나인 단추의 태그 묶음. 속성(`disabled`)을 그 단추 안에서만 본다. 없으면 빈 글이다 */
function buttonHtml(out: string, label: string): string {
  const buttons = out.match(/<button[\s\S]*?<\/button>/g) ?? [];
  return buttons.find((button) => button.includes(`>${label}<`)) ?? "";
}

/** `aria-label`을 가진 선택 상자의 단추 태그 한 개. 옵션은 포털이라 서버 렌더에 없다 */
function triggerOf(out: string, label: string): string {
  const at = out.indexOf(`aria-label="${label}"`);
  if (at === -1) return "";
  const start = out.lastIndexOf("<button", at);
  return out.slice(start, out.indexOf(">", at) + 1);
}

describe("file editor states", () => {
  test("closed draws nothing", () => {
    expect(html(propsOf({ state: initialFileEditor }))).toBe("");
  });

  test("while the file is read the editor shows a loading line and no text area", () => {
    const out = html(propsOf({ state: stateOf({ phase: "loading", doc: null, draft: "" }) }));
    expect(out).toContain(t("desktop.settings.loading.status"));
    expect(out).not.toContain("<textarea");
  });

  test("a read file shows its path and the text, with save and discard", () => {
    const out = html(propsOf());
    expect(out).toContain(t("desktop.settings.file.title"));
    expect(out).toContain(t("desktop.settings.file.path", { path: DOC.path ?? "" }));
    expect(out).toContain("<textarea");
    expect(out).toContain("sonnet");
    expect(out).toContain(t("desktop.settings.field.discard"));
    expect(out).toContain(t("desktop.settings.field.save"));
  });

  test("a clean draft cannot be saved or discarded", () => {
    const out = html(propsOf());
    expect(buttonHtml(out, t("desktop.settings.field.save"))).toContain('disabled=""');
    expect(buttonHtml(out, t("desktop.settings.field.discard"))).toContain('disabled=""');
  });

  test("a changed draft can be saved and discarded", () => {
    const out = html(propsOf({ state: stateOf({ draft: '{"model": "haiku"}\n' }) }));
    expect(out).toContain("haiku");
    expect(buttonHtml(out, t("desktop.settings.field.save"))).not.toContain('disabled=""');
    expect(buttonHtml(out, t("desktop.settings.field.discard"))).not.toContain('disabled=""');
  });

  test("a conflict says the file changed elsewhere, offers a reread, and blocks saving", () => {
    const out = html(
      propsOf({
        state: stateOf({ phase: "conflict", draft: '{"model": "haiku"}\n' }),
      }),
    );
    expect(out).toContain(t("desktop.settings.file.conflict"));
    expect(out).toContain(t("desktop.settings.file.conflict.body"));
    expect(buttonHtml(out, t("desktop.settings.file.reread.button"))).not.toContain('disabled=""');
    expect(buttonHtml(out, t("desktop.settings.field.save"))).toContain('disabled=""');
    expect(out).toContain("haiku");
  });

  test("offline locks the text area, saving and the scope choice and keeps the last text", () => {
    const out = html(propsOf({ live: false, state: stateOf({ draft: '{"model": "haiku"}\n' }) }));
    expect(out).toContain(t("desktop.settings.offline"));
    expect(out).toContain("haiku");
    expect(out).toMatch(/<textarea[^>]*disabled=""/);
    expect(buttonHtml(out, t("desktop.settings.field.save"))).toContain('disabled=""');
    expect(buttonHtml(out, t("desktop.settings.file.close.button"))).toContain('disabled=""');
  });

  test("a failed read shows the host sentence with a retry button and no text area", () => {
    const error: CommandError = { kind: "rejected", code: 3108, detail: "값이 맞지 않아요" };
    const out = html(propsOf({ state: stateOf({ phase: "failed", doc: null, draft: "", error }) }));
    expect(out).toContain(errorText(error));
    expect(out).toContain(
      t("desktop.settings.error.rejectedDetail", { detail: "값이 맞지 않아요" }),
    );
    expect(buttonHtml(out, t("desktop.settings.retry.button"))).not.toContain('disabled=""');
    expect(out).not.toContain("<textarea");
  });

  test("a failed save keeps the text and shows the failure, not a conflict", () => {
    const out = html(
      propsOf({
        state: stateOf({ draft: '{"model": "haiku"}\n', error: { kind: "failed" } }),
      }),
    );
    expect(out).toContain(t("desktop.settings.error.failed"));
    expect(out).not.toContain(t("desktop.settings.file.conflict"));
    expect(out).toContain("haiku");
  });

  test("a read-only file says so and locks the text area", () => {
    const out = html(propsOf({ state: stateOf({ doc: { ...DOC, readOnly: true } }) }));
    expect(out).toContain(t("desktop.settings.file.readOnly"));
    expect(out).toMatch(/<textarea[^>]*disabled=""/);
  });

  test("a file that does not exist yet says it will be created on save", () => {
    const out = html(
      propsOf({
        state: stateOf({ doc: { ...DOC, exists: false, text: "", sha256: null }, draft: "" }),
      }),
    );
    expect(out).toContain(t("desktop.settings.file.missing"));
  });

  test("the saved mark shows after a save", () => {
    const out = html(propsOf({ state: stateOf({ saved: true }) }));
    expect(out).toContain(t("desktop.settings.field.saved"));
  });
});

describe("scope choice", () => {
  test("the scope choice is locked offline and while a draft is unsaved, and open otherwise", () => {
    const label = t("desktop.settings.field.scope.label");
    expect(triggerOf(html(propsOf({ live: false })), label)).toContain('disabled=""');
    const dirty = propsOf({ state: stateOf({ draft: '{"model": "haiku"}\n' }) });
    expect(triggerOf(html(dirty), label)).toContain('disabled=""');
    expect(triggerOf(html(propsOf()), label)).not.toContain('disabled=""');
  });
});
