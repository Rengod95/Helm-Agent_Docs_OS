// 버전 탭 그림(AGE-76, §6.24.1): 이력 줄(고르는 단추), 고른 판에서 바뀐 것, 되돌리기 단추와 까닭, 빈 이력, 읽기 실패.
// 그림은 `VersionsPanel`이 읽은 값대로 그린다(renderToString). 효과는 돌지 않으므로 읽기와 명령은 여기서 보지 않는다.
import { describe, expect, test } from "bun:test";
import { activeLocale, t } from "@fresnel/client/i18n";
import { err } from "@fresnel/contracts";
import type { PluginHistoryEntry, ReviewItem } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { sampleItems } from "../../../src/views/craft/review/testing/review-samples.ts";
import type { ReviewData } from "../../../src/views/craft/review/review-source.ts";
import type { DetailRead, HistoryRead } from "../../../src/views/workbench/versions-model.ts";
import { installedAtText, VersionsPanel } from "../../../src/views/workbench/versions-tab.tsx";

type Props = Parameters<typeof VersionsPanel>[0];

const noop = (): void => undefined;
const FILES: Pick<ReviewData, "file"> = {
  file: () => Promise.resolve(err({ kind: "unsupported" })),
};

/** 태그를 뺀 글. 속성의 따옴표 실체(`&#x27;`)는 원래 글자로 되돌린다 */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'");

/** 글이 몇 번 나오는가 */
const countOf = (text: string, word: string): number => text.split(word).length - 1;

function hash(c: string): string {
  return `sha256:${c.repeat(64)}`;
}

function entry(over: Partial<PluginHistoryEntry>): PluginHistoryEntry {
  return {
    at: "2026-11-22T09:00:00.000Z",
    event: "edit",
    version: "0.2.0",
    contentHash: hash("b"),
    baseHash: null,
    itemId: null,
    actor: "user",
    summary: "검색을 더함",
    current: false,
    kept: true,
    ...over,
  };
}

/** 최신이 앞: 0.3.0(지금, 되돌리기 줄), 0.2.0(고치기, 변경 내용 있음), 0.1.0(가져옴, 내용 없음) */
const ENTRIES: readonly PluginHistoryEntry[] = [
  entry({
    at: "2026-11-24T09:00:00.000Z",
    event: "rollback",
    version: "0.3.0",
    contentHash: hash("c"),
    current: true,
    summary: null,
  }),
  entry({ itemId: "rvw_sample_fetch" }),
  entry({
    at: "2026-11-20T09:00:00.000Z",
    event: "create",
    version: "0.1.0",
    contentHash: hash("a"),
    actor: "migration",
    summary: null,
    kept: false,
  }),
];

const READY: HistoryRead = { kind: "ready", entries: ENTRIES, blocked: null, pending: null };

function sampleOf(itemId: string): ReviewItem {
  const found = sampleItems().find((item) => item.itemId === itemId);
  if (found === undefined) throw new Error(`sample ${itemId} missing`);
  return found;
}

function render(over: Partial<Props>): string {
  const props: Props = {
    installed: "0.3.0",
    read: READY,
    locked: false,
    selected: 0,
    detail: { kind: "none" },
    files: FILES,
    onPick: noop,
    onRollback: noop,
    onOpenReview: noop,
    ...over,
  };
  return renderToString(<VersionsPanel {...props} />);
}

describe("버전 탭 그림: 이력", () => {
  test("이력 줄마다 버전과 사건 글과 요약을 보인다", () => {
    const text = textOf(render({}));
    expect(text).toContain("0.3.0");
    expect(text).toContain("0.2.0");
    expect(text).toContain("0.1.0");
    expect(text).toContain(t("desktop.workbench.history.event.edit"));
    expect(text).toContain(t("desktop.workbench.history.event.create"));
    expect(text).toContain("검색을 더함");
  });

  test("지금 꼬리표는 지금 줄 하나에만 있다", () => {
    const text = textOf(render({}));
    expect(countOf(text, t("desktop.workbench.versions.current"))).toBe(1);
  });

  test("고른 줄은 aria-current로 표시되고, 처음에는 맨 앞(최신) 줄이다", () => {
    const html = render({});
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const from = html.indexOf('aria-current="page"');
    const body = html.slice(html.indexOf(">", from) + 1);
    expect(textOf(body).startsWith("0.3.0")).toBe(true);
  });

  test("대기 중인 되돌리기 줄은 목록 맨 위에 대상 버전과 리뷰 대기 꼬리표와 리뷰에서 보기 단추를 둔다", () => {
    const html = render({
      read: {
        ...READY,
        pending: { itemId: "rvw_rollback", to: "0.1.0" },
      },
    });
    const text = textOf(html);
    expect(text).toContain(t("desktop.workbench.history.pending"));
    expect(text).toContain(t("desktop.workbench.history.openReview"));
    expect(text.indexOf(t("desktop.workbench.history.pending"))).toBeLessThan(
      text.indexOf("0.2.0"),
    );
  });

  test("이력이 비면 빈 글과 지금 버전 한 줄만 있고 단추는 없다", () => {
    const html = render({ read: { kind: "ready", entries: [], blocked: null, pending: null } });
    const text = textOf(html);
    expect(text).toContain(t("desktop.workbench.history.empty"));
    expect(text).toContain("0.3.0");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<ol");
  });

  test("이력을 모르는 엔진은 기록 없음 글을 보인다", () => {
    const html = render({ read: { kind: "unsupported" } });
    expect(textOf(html)).toContain(t("desktop.workbench.versions.noHistory"));
    expect(html).not.toContain("<button");
  });

  test("읽기 실패는 기존 한 줄 실패 글이다", () => {
    const html = render({ read: { kind: "error" } });
    expect(textOf(html)).toContain(t("desktop.workbench.detail.load.failed"));
    expect(html).not.toContain("<button");
  });
});

describe("버전 탭 그림: 되돌리기 단추와 까닭", () => {
  test("지금 판을 고르면 단추가 disabled이고 지금 판이라는 까닭이 있다", () => {
    const html = render({ selected: 0 });
    expect(html).toContain('disabled=""');
    expect(textOf(html)).toContain(t("desktop.workbench.history.stop.current"));
  });

  test("되돌릴 수 있는 줄은 단추가 켜져 있고 까닭 글이 없다", () => {
    const html = render({ selected: 1 });
    expect(html).not.toContain('disabled=""');
    expect(textOf(html)).not.toContain(t("desktop.workbench.history.stop.current"));
    expect(textOf(html)).not.toContain(t("desktop.workbench.history.stop.notKept"));
  });

  test("막힌 플러그인은 단추가 disabled이고 막는 까닭 글이 있다", () => {
    const html = render({ selected: 1, read: { ...READY, blocked: "builtin" } });
    expect(html).toContain('disabled=""');
    expect(textOf(html)).toContain(t("desktop.workbench.history.stop.builtin"));
  });

  test("탭이 잠겨 있으면 관리자 잠금과 같은 까닭이다", () => {
    const html = render({ selected: 1, locked: true });
    expect(html).toContain('disabled=""');
    expect(textOf(html)).toContain(t("desktop.workbench.history.stop.managed"));
  });

  test("내용이 남지 않은 줄은 disabled이고 남지 않았다는 까닭이 있다", () => {
    const html = render({ selected: 2 });
    expect(html).toContain('disabled=""');
    expect(textOf(html)).toContain(t("desktop.workbench.history.stop.notKept"));
  });
});

describe("버전 탭 그림: 고른 줄의 변경 내용", () => {
  test("항목을 읽었으면 하는 일의 차이 머리를 보인다", () => {
    const html = render({
      selected: 1,
      detail: { kind: "ready", item: sampleOf("rvw_sample_fetch") },
    });
    expect(textOf(html)).toContain(t("desktop.craft.review.does.changes"));
  });

  test("차이가 없는 항목은 하는 일은 그대로라고 말한다", () => {
    const item = sampleOf("rvw_sample_fetch");
    const html = render({
      selected: 1,
      detail: {
        kind: "ready",
        item: {
          ...item,
          diff: {
            added: [],
            removed: [],
            changed: [],
            enforcementChange: null,
            costDelta: { always: null, onDemand: null },
          },
        },
      },
    });
    expect(textOf(html)).toContain(t("desktop.workbench.history.noChanges"));
  });

  test("항목 id가 없는 줄은 변경 내용이 남아 있지 않다고 말한다", () => {
    const html = render({ selected: 0, detail: { kind: "none" } });
    expect(textOf(html)).toContain(t("desktop.workbench.history.noItem"));
  });

  test("읽기 실패는 기존 한 줄 실패 글이다", () => {
    const detail: DetailRead = { kind: "failed" };
    const html = render({ selected: 1, detail });
    expect(textOf(html)).toContain(t("desktop.workbench.detail.load.failed"));
  });
});

describe("설치 시각 글", () => {
  test("ISO 시각은 로케일의 날짜와 시간 형식이 되고 원문 ISO는 보이지 않는다", () => {
    const text = installedAtText("2026-11-06T22:50:31.319Z");
    expect(text).toBe(
      new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(
        new Date("2026-11-06T22:50:31.319Z"),
      ),
    );
    expect(text).not.toContain("T22:50");
    expect(text).not.toContain(".319Z");
  });

  test("읽을 수 없는 값은 그대로 둔다", () => {
    expect(installedAtText("t3")).toBe("t3");
  });
});
