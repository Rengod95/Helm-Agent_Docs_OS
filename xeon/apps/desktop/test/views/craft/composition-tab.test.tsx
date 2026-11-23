import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  blockRowsOf,
  INITIAL_WORKBENCH,
  isDetailTab,
  listLoaded,
  type BlockRow,
  type DetailTab,
} from "@fresnel/client/workbench";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type { ExtListEntry, WireManifestIssue } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import {
  groupEdgesOf,
  GroupCanvas,
  outputGroupsOf,
} from "../../../src/views/craft/composition/composition-canvas.tsx";
import { CheckBanner } from "../../../src/views/craft/composition/composition-check.tsx";
import { CompositionTab } from "../../../src/views/craft/composition/composition-tab.tsx";
import { ExtDetail, visibleTabOf } from "../../../src/views/workbench/ext-detail.tsx";
import { entry, inContexts } from "../workbench/support.tsx";

// 구성 탭의 정적 마크업과 상세 탭 입구. 블록 이름, 캔버스, 빈 상태, 검사 띠 글, 블록 이슈 줄,
// Drive 플러그인에만 생기는 구성 탭 단추와 다른 확장에서 남은 값의 개요 돌려주기를 값으로 본다. 효과는 돌지 않는다.

/** 구성을 선언한 설치본(Drive 플러그인 하나와 구성원 하나) */
const COMPOSITION: CompositionDecl = {
  blocks: [
    { id: "detect", stage: "detect", op: "on", title: "신호 감지", hooks: ["tool.call.before"] },
    { id: "drive", stage: "machine", op: "drive", plugin: "lead" },
  ],
};

const MANIFEST: Readonly<Record<string, unknown>> = {
  plugins: [{ id: "lead", layer: "L2", title: "리드", hooks: [], drives: true }],
  orchestration: { composition: COMPOSITION },
};

/** 구성을 선언하지 않은 설치본 */
const BARE: Readonly<Record<string, unknown>> = {
  plugins: [{ id: "lead", layer: "L2", hooks: [], drives: true }],
};

function tabHtml(manifest: Readonly<Record<string, unknown>> | null, failed = false): string {
  return renderToString(
    inContexts(
      <CompositionTab name="kit" manifest={manifest} failed={failed} />,
      createWorkbenchStore(),
    ),
  );
}

function attrs(html: string, name: string): readonly string[] {
  return [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1] ?? "");
}

/** 태그를 뺀 글 */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, "");

describe("구성 탭 본문", () => {
  test("선언이 있으면 블록 이름과 캔버스를 그리고, 구성원 블록에는 구성원 이름을 붙인다", () => {
    const html = tabHtml(MANIFEST);
    expect(html).toContain("신호 감지");
    expect(html).toContain("drive");
    expect(html).toContain(`aria-label="${t("desktop.craft.composition.blocks")}"`);
    expect(attrs(html, "data-block-member")).toEqual(["lead"]);
    expect(html).toContain(t("desktop.craft.composition.block.member", { name: "리드" }));
    // 훅 이름은 블록 노드에 그리지 않는다(시안)
    expect(html).not.toContain("tool.call.before");
    // 검사는 읽는 중이라 띠와 이슈 줄이 없다
    expect(html).not.toContain('role="alert"');
  });

  test("구성 선언이 없으면 빈 상태 제목과 안내를 보이고 캔버스는 없다", () => {
    const html = tabHtml(BARE);
    expect(textOf(html)).toContain(t("desktop.craft.composition.none.title"));
    expect(textOf(html)).toContain(t("desktop.craft.composition.none.body"));
    expect(html).not.toContain(`aria-label="${t("desktop.craft.composition.blocks")}"`);
  });

  test("매니페스트를 아직 못 읽었으면 읽는 중 글과 Skeleton을 보인다", () => {
    const html = tabHtml(null);
    expect(html).toContain(t("desktop.craft.composition.loading"));
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain(t("desktop.craft.composition.none.title"));
  });

  test("매니페스트 읽기가 실패하면 읽는 중 대신 실패 한 줄을 보인다", () => {
    const html = tabHtml(null, true);
    expect(html).toContain(t("desktop.workbench.detail.load.failed"));
    expect(html).not.toContain(t("desktop.craft.composition.loading"));
  });

  test("읽기 전용이다: 입력 칸이 없다(캔버스의 줌 단추만 있다)", () => {
    const html = tabHtml(MANIFEST);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
  });
});

describe("블록의 구성원 이름", () => {
  test("구성원의 블록은 구성원 제목이, 제목이 없으면 id가, 뿌리 블록은 아무것도 서지 않는다", () => {
    const html = renderToString(
      <GroupCanvas
        rows={blockRowsOf(
          {
            blocks: [
              { id: "plan", stage: "plan", op: "post", plugin: "lead" },
              { id: "watch", stage: "plan", op: "post", plugin: "tap" },
              { id: "root-step", stage: "plan", op: "post" },
            ],
          },
          [
            { id: "lead", title: "Plan lead" },
            { id: "tap", title: null },
          ],
        )}
        issuesByBlock={new Map()}
      />,
    );
    expect(attrs(html, "data-block-member")).toEqual(["lead", "tap"]);
    expect(html).toContain(t("desktop.craft.composition.block.member", { name: "Plan lead" }));
    expect(html).toContain(t("desktop.craft.composition.block.member", { name: "tap" }));
  });
});

describe("검사 띠", () => {
  test("막힌 곳이 있으면 개수로 보인다", () => {
    const html = renderToString(
      <CheckBanner
        check={{
          kind: "done",
          issues: [{ severity: "error", code: "drive_duplicate", path: "blocks[1]", message: "x" }],
        }}
      />,
    );
    expect(textOf(html)).toContain("검사에서 막힌 곳이 1개 있어요.");
  });

  test("검사를 못 하면 경고 한 줄이다", () => {
    const html = renderToString(<CheckBanner check={{ kind: "failed" }} />);
    expect(textOf(html)).toContain("구성 검사를 하지 못했어요.");
  });

  test("경고만 있으면 경고 개수로 보인다", () => {
    const html = renderToString(
      <CheckBanner
        check={{
          kind: "done",
          issues: [
            { severity: "warning", code: "w1", path: "blocks[0]", message: "a" },
            { severity: "warning", code: "w2", path: "blocks[1]", message: "b" },
          ],
        }}
      />,
    );
    expect(textOf(html)).toContain("경고 2개");
  });

  test("이슈가 있으면 해당 블록에 코드와 문장을 보인다", () => {
    const issue: WireManifestIssue = {
      severity: "error",
      code: "drive_duplicate",
      path: "blocks[1]",
      message: "drive는 플러그인마다 하나예요",
    };
    const html = renderToString(
      <GroupCanvas
        rows={blockRowsOf(COMPOSITION, [])}
        issuesByBlock={new Map([["drive", [issue]]])}
      />,
    );
    expect(html).toContain("drive_duplicate");
    expect(html).toContain("drive는 플러그인마다 하나예요");
    expect(html.match(/role="alert"/g)?.length).toBe(1);
  });
});

const rows: readonly BlockRow[] = [
  {
    id: "a",
    title: "A",
    stage: "s",
    op: "on",
    plugin: null,
    memberTitle: null,
    summary: null,
    hooks: [],
    consumes: ["cap.x"],
    produces: [
      { kind: "record", recordKind: "note" },
      { kind: "state", recordKind: null },
    ],
  },
  {
    id: "b",
    title: "B",
    stage: "s",
    op: "post",
    plugin: null,
    memberTitle: null,
    summary: null,
    hooks: [],
    consumes: [],
    produces: [{ kind: "record", recordKind: "note" }],
  },
];

describe("구성 캔버스 모델", () => {
  test("오른쪽 열은 같은 기록 종류를 한 포트로 모으고 기록, 입력 큐, 상태 문서 순이다", () => {
    expect(outputGroupsOf(rows).map((g) => [g.kind, g.ports.map((p) => p.key)])).toEqual([
      ["record", ["record:note"]],
      ["state", ["state:"]],
    ]);
  });
  test("선은 고른 블록의 것만 그린다", () => {
    expect(groupEdgesOf(rows, null)).toEqual([]);
    expect(groupEdgesOf(rows, "a")).toEqual([
      { from: "a:out:record:note", to: "out:record:note" },
      { from: "a:out:state:", to: "out:state:" },
    ]);
  });
});

/** 상세를 그린다. 엔진은 끊긴 거울이라 구성 탭은 읽는 중으로 보인다 */
function detailOf(row: ExtListEntry, tab: DetailTab): string {
  const state = listLoaded(INITIAL_WORKBENCH, [row]);
  return renderToString(
    inContexts(
      <ExtDetail
        state={state}
        entry={row}
        tab={tab}
        onTab={() => undefined}
        onBack={() => undefined}
        onToggle={() => undefined}
        onKeepOn={() => undefined}
        onKeepOff={() => undefined}
        onRemove={() => undefined}
      />,
      createWorkbenchStore(() => state),
    ),
  );
}

/** 탭 단추의 글과 고른 상태, 그린 순서대로 */
function triggersOf(html: string): { text: string; selected: boolean }[] {
  return [...html.matchAll(/<button[^>]*role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => ({
    text: textOf(m[1] ?? ""),
    selected: m[0].includes('aria-selected="true"'),
  }));
}

const DRIVE = entry("kit", { isOrchestration: true, layer: "L2" });
const PLAIN = entry("web");
const COMPOSITION_LABEL = t("desktop.craft.composition.tab");

describe("상세의 구성 탭 입구", () => {
  test("Drive 플러그인에는 구성 탭 단추가 있고, 다른 플러그인에는 없다", () => {
    const drive = triggersOf(detailOf(DRIVE, "overview")).map((tab) => tab.text);
    const plain = triggersOf(detailOf(PLAIN, "overview")).map((tab) => tab.text);
    expect(drive).toContain(COMPOSITION_LABEL);
    expect(plain).not.toContain(COMPOSITION_LABEL);
    // 의존 바로 뒤에 선다
    const dependencies = t("desktop.craft.deps.tab");
    expect(drive.indexOf(COMPOSITION_LABEL)).toBe(drive.indexOf(dependencies) + 1);
  });

  test("Drive 플러그인에서 구성 탭을 고르면 그 탭이 선택되고 읽는 중 글을 보인다", () => {
    const html = detailOf(DRIVE, "composition");
    const selected = triggersOf(html).filter((tab) => tab.selected);
    expect(selected.map((tab) => tab.text)).toEqual([COMPOSITION_LABEL]);
    expect(html).toContain(t("desktop.craft.composition.loading"));
  });

  test("다른 플러그인에 남은 구성 탭 값이면 개요를 고른 채로 그린다", () => {
    const html = detailOf(PLAIN, "composition");
    const selected = triggersOf(html).filter((tab) => tab.selected);
    expect(selected.map((tab) => tab.text)).toEqual([t("desktop.workbench.detail.tab.overview")]);
    expect(html).not.toContain(t("desktop.craft.composition.loading"));
  });

  test("고른 탭 돌려주기는 Drive 플러그인에서만 구성을 남긴다", () => {
    expect(visibleTabOf("composition", DRIVE)).toBe("composition");
    expect(visibleTabOf("composition", PLAIN)).toBe("overview");
    expect(visibleTabOf("hooks", PLAIN)).toBe("hooks");
  });

  test("구성 탭은 DETAIL_TABS의 탭 이름이다", () => {
    expect(isDetailTab("composition")).toBe(true);
  });
});
