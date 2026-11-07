import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { WorkFolderBandBody } from "../../src/views/work-folder-band.tsx";

// 작업 폴더가 없는 대화의 띠. 그림만 시험한다(상태와 확인은 `command` 시험과 실제 흐름이 본다).

describe("WorkFolderBandBody", () => {
  test("a missing work folder shows the title and the path as a warning band", () => {
    const out = renderToString(<WorkFolderBandBody path="/Users/me/moved/app" />);
    expect(out).toContain("작업 폴더를 찾을 수 없어요");
    expect(out).toContain("/Users/me/moved/app");
    expect(out).toContain('data-tone="warning"');
  });

  test("an existing work folder draws nothing", () => {
    expect(renderToString(<WorkFolderBandBody path={null} />)).toBe("");
  });
});
