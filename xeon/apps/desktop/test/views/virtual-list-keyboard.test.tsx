import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { VirtualList } from "../../src/views/virtual-list.tsx";

// scD 1-3: 기록 스크롤 영역은 Tab으로 들어가고 이름이 있는 영역이다. PageUp/PageDown/Home/End는 초점 있는 스크롤 영역에 브라우저가 준다.
describe("VirtualList scroll region", () => {
  test("is a named, tabbable region", () => {
    const html = renderToString(
      <VirtualList
        rows={[{ key: "a" }, { key: "b" }]}
        followTail
        label="대화 기록"
        renderRow={(row) => <p>{row.key}</p>}
      />,
    );
    expect(html).toContain('class="scroller"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="대화 기록"');
  });
});
