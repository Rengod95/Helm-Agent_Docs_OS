import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { CardDependency, CardDependencies } from "@fresnel/contracts/extensions";
import type { DependencyInfo } from "@fresnel/contracts/services";
import { renderToString } from "react-dom/server";
import type { DependencyRefusalView } from "../../../src/views/commands.ts";
import {
  DependencyRefusal,
  dependencyIssueLinesOf,
} from "../../../src/views/craft/deps/dependency-refusal.tsx";
import type { DepsData, DepsLoad } from "../../../src/views/craft/deps/deps-source.ts";
import { DepsView } from "../../../src/views/craft/deps/deps-view.tsx";
import { entry } from "../workbench/support.tsx";

// 의존 탭의 정적 마크업과 거절 목록. 추가 단추, 종류 글, 문제 글, 줄 식별자, 잠긴 원본의 읽기 전용 표시,
// 바뀐 원본의 "리뷰로 보내기" 알림, 거절 줄의 항목 식별자를 값으로 본다. 효과는 돌지 않는다.

type Ready = Extract<DepsLoad, { readonly status: "ready" }>;

const EMPTY_CARD: CardDependencies = { dependsOn: [], dependents: [] };

function dep(from: string, target: string, over: Partial<CardDependency> = {}): CardDependency {
  return { from, target, kind: "hard", range: null, problem: null, ...over };
}

function declared(
  from: string,
  target: string,
  over: Partial<DependencyInfo> = {},
): DependencyInfo {
  return { from, target, kind: "hard", range: null, ...over };
}

function ready(over: Partial<Ready> = {}): DepsLoad {
  return {
    status: "ready",
    card: EMPTY_CARD,
    source: [],
    access: { kind: "editable", dir: "/src/kit" },
    matchesReviewed: true,
    pending: null,
    ...over,
  };
}

function dataOf(load: DepsLoad, over: Partial<DepsData> = {}): DepsData {
  return {
    load,
    name: "kit",
    members: ["guard"],
    entries: [entry("kit"), entry("notes"), entry("web", { displayName: "웹 검색" })],
    editedSinceSend: false,
    edit: () => Promise.resolve({ ok: true }),
    send: () => Promise.resolve({ ok: true, itemId: "i1" }),
    openReview: () => undefined,
    ...over,
  };
}

function render(load: DepsLoad, over: Partial<DepsData> = {}): string {
  return renderToString(<DepsView data={dataOf(load, over)} />);
}

/** 속성 값을 읽는다. 서버 렌더는 `>`를 `&gt;`로 쓰므로 되돌려 줄 식별자(`kit->notes`)와 견준다 */
function attrs(html: string, name: string): readonly string[] {
  return [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) =>
    (m[1] ?? "").replaceAll("&gt;", ">").replaceAll("&amp;", "&"),
  );
}

describe("기대는 줄과 추가 단추(고칠 수 있을 때)", () => {
  test("고칠 수 있으면 추가 단추가 있고, 줄에 종류와 설치본 기준 문제가 보이고 줄 식별자는 기대는 쪽->대상이다", () => {
    const html = render(
      ready({
        card: { dependsOn: [dep("kit", "notes", { problem: "target_missing" })], dependents: [] },
        source: [declared("kit", "notes")],
      }),
    );
    expect(html).toContain(t("desktop.craft.deps.add"));
    expect(html).toContain(t("desktop.craft.deps.kind.hard"));
    expect(html).toContain(t("desktop.craft.deps.problem.targetMissing"));
    expect(attrs(html, "data-dependency-row")).toEqual(["kit->notes"]);
  });
});

describe("잠긴 원본", () => {
  test("원본 폴더가 없으면 읽기 전용 표시와 까닭을 보이고, 추가 단추와 지우기 단추가 없다", () => {
    const html = render(
      ready({
        access: { kind: "locked", reason: "noSource" },
        card: { dependsOn: [dep("kit", "notes")], dependents: [] },
        source: null,
      }),
    );
    expect(html).toContain(t("desktop.craft.members.readOnly"));
    expect(html).toContain(t("desktop.craft.deps.locked.noSource"));
    expect(html).not.toContain(t("desktop.craft.deps.add"));
    expect(html).not.toContain(t("desktop.craft.deps.remove", { name: "notes" }));
    expect(attrs(html, "data-dependency-row")).toEqual(["kit->notes"]);
  });
});

describe("빈 두 구역", () => {
  test("기대는 것도 기대는 쪽도 없으면 두 구역 모두 빈 말을 보인다", () => {
    const html = render(ready());
    expect(html).toContain(t("desktop.craft.deps.dependsOn.empty"));
    expect(html).toContain(t("desktop.craft.deps.dependents.empty"));
    expect(attrs(html, "data-dependency-row")).toEqual([]);
  });
});

describe("이 플러그인에 기대는 쪽", () => {
  test("기대는 쪽 줄은 그 플러그인의 보이는 이름을 앞에 두고, 종류 글과 범위를 보인다", () => {
    const html = render(
      ready({
        card: {
          dependsOn: [],
          dependents: [dep("web", "kit", { kind: "soft", range: "^1.0.0" })],
        },
      }),
    );
    expect(attrs(html, "data-dependency-row")).toEqual(["web->kit"]);
    expect(html).toContain("웹 검색");
    expect(html).toContain(t("desktop.craft.deps.kind.soft"));
    expect(html).toContain("^1.0.0");
    expect(html).not.toContain(t("desktop.craft.deps.dependents.empty"));
  });
});

describe("리뷰로 보내기 알림", () => {
  test("고칠 수 있고 승인본과 다르면 바뀌었다는 알림과 보내기 단추가 보이고, 같으면 없다", () => {
    expect(render(ready({ matchesReviewed: false }))).toContain(
      t("desktop.craft.deps.send.changed"),
    );
    expect(render(ready({ matchesReviewed: true }))).not.toContain(
      t("desktop.craft.deps.send.changed"),
    );
  });

  test("잠긴 원본은 승인본과 달라도 알림을 두지 않는다", () => {
    const html = render(
      ready({
        matchesReviewed: false,
        access: { kind: "locked", reason: "builtin" },
        source: null,
      }),
    );
    expect(html).not.toContain(t("desktop.craft.deps.send.changed"));
  });
});

describe("거절 목록(의존 때문에 막힌 일)", () => {
  const REFUSAL: DependencyRefusalView = {
    reason: "required_by",
    plugin: "web",
    items: [
      {
        from: "notes",
        target: "web",
        kind: "hard",
        range: null,
        problem: "depended_on",
        found: null,
      },
    ],
  };

  test("이유 제목, 항목 말과 항목 식별자(문제 코드)를 보인다", () => {
    const html = renderToString(<DependencyRefusal refusal={REFUSAL} />);
    expect(html).toContain(t("desktop.craft.deps.refusal.requiredBy"));
    expect(html).toContain(t("desktop.craft.deps.item.dependedOn"));
    expect(attrs(html, "data-dependency-item")).toEqual(["depended_on"]);
  });

  test("프로필 검사의 의존 이슈는 심각도로 종류를 가르고, 의존 이슈가 아니거나 이름이 없으면 줄을 만들지 않는다", () => {
    expect(
      dependencyIssueLinesOf([
        { code: "dependency_missing", severity: "error", plugin: "kit", other: "notes" },
        { code: "dependency_range", severity: "warning", plugin: "kit", other: "web" },
        { code: "plugin_unknown", severity: "error", plugin: "kit", other: "x" },
        { code: "dependency_disabled", severity: "error", plugin: null, other: "web" },
        { code: "dependency_missing", severity: "error", plugin: "kit", other: null },
      ]),
    ).toEqual([
      {
        key: "kit->notes:dependency_missing",
        from: "kit",
        target: "notes",
        kind: "hard",
        text: t("desktop.craft.deps.issue.missing"),
        code: "dependency_missing",
      },
      {
        key: "kit->web:dependency_range",
        from: "kit",
        target: "web",
        kind: "soft",
        text: t("desktop.craft.deps.issue.range"),
        code: "dependency_range",
      },
    ]);
  });
});
