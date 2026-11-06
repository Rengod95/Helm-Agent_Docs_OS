import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { SettingTagList } from "../../src/views/pages/settings/settings-tag-list.tsx";

// 목록 칸의 서버 렌더. 열거형 목록은 값이 아니라 `settings.<키>.option.<값>` 카탈로그의 라벨이 보인다. 문장은 ko 카탈로그 값과 비교한다.

const NOOP = (): void => {};
const OPTIONS = ["model", "thinking", "tokens", "cost", "cwd", "session", "transport"];

function html(value: readonly string[], options: readonly string[] | null): string {
  return renderToString(
    <SettingTagList
      settingKey="l4.cli.statusLine"
      label="CLI 상태 줄 항목"
      value={value}
      options={options}
      disabled={false}
      invalid={false}
      onChange={NOOP}
    />,
  );
}

describe("SettingTagList", () => {
  test("열거형 목록은 선택지마다 라벨 칩이고 켠 것만 눌림이다", () => {
    const out = html(["model", "cwd", "session"], OPTIONS);
    for (const label of ["모델", "추론", "토큰", "비용", "작업 폴더", "대화", "연결 방식"]) {
      expect(out).toContain(label);
    }
    expect(out.match(/aria-pressed="true"/g)?.length).toBe(3);
    expect(out.match(/aria-pressed="false"/g)?.length).toBe(4);
    expect(out).not.toContain(">cwd<");
  });

  test("자유 입력 목록은 입력 칸이다", () => {
    const out = html(["alpha"], null);
    expect(out).toContain("alpha");
    expect(out).toContain('data-slot="tag-input"');
  });
});
