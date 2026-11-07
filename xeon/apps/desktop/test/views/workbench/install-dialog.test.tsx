import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import {
  InstallHookList,
  InstallReasonList,
} from "../../../src/views/workbench/install-dialog.tsx";

// 설치 거절 사유 목록(실패 문장 아래): 사유마다 한 문장과 알면 자리, 사유가 없으면 아무것도 그리지 않는다(서버 렌더).

describe("설치 거절 사유 목록", () => {
  test("사유마다 한 문장을 쓰고, 필드와 줄을 알면 자리를 덧붙인다", () => {
    const html = renderToString(
      <InstallReasonList
        reasons={[
          { key: "unknown_key", field: "plugins/0/hoks", line: 12 },
          { key: "missing_field", field: "plugins/0/hooks" },
          { key: "no_manifest" },
          { key: "other" },
        ]}
      />,
    );
    expect(html).toContain(t("desktop.install.reason.unknownKey"));
    expect(html).toContain(
      t("desktop.install.reason.place.fieldLine", { field: "plugins/0/hoks", line: 12 }),
    );
    expect(html).toContain(t("desktop.install.reason.missingField"));
    expect(html).toContain(t("desktop.install.reason.place.field", { field: "plugins/0/hooks" }));
    expect(html).toContain(t("desktop.install.reason.noManifest"));
    expect(html).toContain(t("desktop.install.reason.other"));
    expect(html.match(/<li>/g)).toHaveLength(4);
  });

  test("사유가 없으면 아무것도 그리지 않는다", () => {
    expect(renderToString(<InstallReasonList reasons={[]} />)).toBe("");
  });
});

describe("설치 확인의 훅 목록", () => {
  test("훅마다 사건 이름과 할 수 있는 일을 한 줄로 보이고 도구를 막는 훅만 표시한다", () => {
    const html = renderToString(
      <InstallHookList
        hooks={[
          { id: "tool.call.before", power: "block", blocksTools: true },
          { id: "tool.result", power: "modify", blocksTools: false },
          { id: "boundary.settle.after", power: "observe", blocksTools: false },
          { id: "weird.hook", power: "unknown", blocksTools: false },
        ]}
      />,
    );
    expect(html).toContain("도구 실행 전 · 막을 수 있어요");
    expect(html).toContain("도구 결과를 받을 때 · 고칠 수 있어요");
    expect(html).toContain("턴이 마무리된 뒤 · 보기만 해요");
    expect(html).toContain("weird.hook · 알 수 없는 훅이에요");
    expect(html.match(/data-blocks-tools="true"/g)).toHaveLength(1);
  });
});
