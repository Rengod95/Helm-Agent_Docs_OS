import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { ExportDialogBody } from "../../src/views/thread-export-dialog.tsx";

// 대화 내보내기 대화 상자 본문의 세 상태(대기, 실행 중, 실패)를 서버에서 그린다. 대화 상자 자체는 포털이라 본문만 본다.

const noop = (): void => {};

describe("ExportDialogBody", () => {
  test("idle offers both formats and says secret values are left out", () => {
    const out = renderToString(
      <ExportDialogBody format="markdown" phase="idle" failure={null} onFormat={noop} />,
    );
    expect(out).toContain("Markdown");
    expect(out).toContain("JSON");
    expect(out).toContain("시크릿 값은 넣지 않아요");
    expect(out).not.toContain("대화를 내보내는 중");
    expect(out).not.toContain('role="alert"');
  });

  test("running says it is exporting and shows no failure line", () => {
    const out = renderToString(
      <ExportDialogBody format="json" phase="running" failure={null} onFormat={noop} />,
    );
    expect(out).toContain("대화를 내보내는 중");
    expect(out).not.toContain('role="alert"');
  });

  test("failed shows the sentence for the step that failed in an alert", () => {
    const out = renderToString(
      <ExportDialogBody
        format="markdown"
        phase="failed"
        failure="desktop.threads.export.failed.save"
        onFormat={noop}
      />,
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain("파일을 저장하지 못했어요");
    expect(out).not.toContain("대화를 내보내는 중");
  });
});
