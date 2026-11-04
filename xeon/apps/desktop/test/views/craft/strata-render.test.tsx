import { describe, expect, test } from "bun:test";
import {
  FIXTURE_ORDER,
  HOOKS,
  OTHER_HOOKS,
  buildFixture,
  hooksInOrder,
  type CanvasPlugin,
  type CanvasSnapshot,
  type HookOrderPort,
  type OrderWarning,
} from "@fresnel/client/workbench/canvas";
import { t, type MessageId } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { CraftProvider, type CraftSource } from "../../../src/views/craft/craft-context.tsx";
import { HookRow, Strata, type RowDef, type StrataCtx } from "../../../src/views/craft/strata.tsx";
import { litFor } from "../../../src/views/craft/strata-model.ts";
import { describedTextOf, inStore } from "./render-support.tsx";

const unused = (): Promise<never> =>
  Promise.reject(new Error("the render test never calls the port"));

const port: HookOrderPort = {
  get: unused,
  set: unused,
  reset: unused,
  preview: unused,
};

function fakeSource(): CraftSource {
  return {
    snapshot: buildFixture(77),
    order: FIXTURE_ORDER,
    setOn: () => Promise.resolve(),
    orderPort: port,
    openBuilder: () => undefined,
    recentRuns: () => Promise.resolve(null),
    scope: { kind: "global" },
  };
}

function render(): string {
  return renderToString(
    inStore(
      <CraftProvider source={fakeSource()}>
        <Strata />
      </CraftProvider>,
    ),
  );
}

/** 마크업에서 훅 줄의 id를 나타난 순서대로 뽑는다 */
function hookRowIds(html: string): string[] {
  return [...html.matchAll(/data-hook="([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("Strata render", () => {
  test("renders the 13 visible hook rows in HOOKS order, then the 33 others", () => {
    const html = render();
    const ids = hookRowIds(html);
    const detailsAt = html.indexOf("<details");
    expect(detailsAt).toBeGreaterThan(0);
    const visible = hookRowIds(html.slice(0, detailsAt));
    const others = hookRowIds(html.slice(detailsAt));
    expect(visible).toEqual(HOOKS.map((h) => h.id));
    expect(others).toEqual(OTHER_HOOKS.map((o) => o.id));
    expect(ids.length).toBe(46);
    expect(visible.length).toBe(13);
    expect(others.length).toBe(33);
  });

  test("handler pills of a lane follow the applied order (tool.call.before: secret-scan before helm)", () => {
    const html = render();
    const start = html.indexOf('data-hook="tool.call.before"');
    const end = html.indexOf('data-hook="tool.result"', start);
    expect(start).toBeGreaterThan(0);
    const row = html.slice(start, end);
    const first = row.indexOf('data-chip="secret-scan"');
    const second = row.indexOf('data-chip="helm"');
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
  });

  test("a builtin compaction row and the three core steps sit in the flow", () => {
    const html = render();
    expect(html).toContain('data-core="core.context.assemble"');
    expect(html).toContain('data-core="core.model.call"');
    expect(html).toContain('data-core="core.tools.run"');
    // 대화 압축 줄에는 내장 압축 칩이 있다
    const compact = html.indexOf('data-hook="thread.compact.before"');
    const next = html.indexOf('data-hook="request.provider.before"', compact);
    expect(html.slice(compact, next)).toContain("내장 압축");
  });

  test("a block-only row with two handlers is read only: no Alt keys, no grab, no handle, arrows stay", () => {
    const row = rowOf(render(), "tool.call.before");
    expect(row).toContain('data-chip="secret-scan"');
    expect(row).toContain('data-chip="helm"');
    expect(row).not.toContain("aria-keyshortcuts");
    expect(row).not.toContain("cursor:grab");
    expect(row).not.toContain("group-hover/pill:opacity-100");
    expect(row).toContain("›");
  });

  test("a collect row with two handlers is read only too", () => {
    const row = rowOf(render(), "input.agent.before");
    expect(row).toContain('data-chip="helm"');
    expect(row).toContain('data-chip="review/lens"');
    expect(row).not.toContain("aria-keyshortcuts");
    expect(row).not.toContain("group-hover/pill:opacity-100");
  });
});

/** 마크업에서 코어 단계 줄 하나의 조각(다음 훅 줄 앞까지) */
function coreRowOf(html: string, id: string): string {
  const start = html.indexOf(`data-core="${id}"`);
  expect(start).toBeGreaterThan(0);
  const end = html.indexOf("data-hook=", start);
  return html.slice(start, end < 0 ? undefined : end);
}

describe("Strata: 규칙 이름표와 코어 줄의 정보 아이콘", () => {
  test("each rule chip keeps its name and carries its one-line explanation behind the info icon", () => {
    const cases: readonly (readonly [RowDef["fold"], MessageId, MessageId])[] = [
      ["tap", "desktop.craft.strata.fold.tap", "desktop.craft.strata.foldTip.tap"],
      ["first", "desktop.craft.strata.fold.first", "desktop.craft.strata.foldTip.first"],
      ["chain", "desktop.craft.strata.fold.chain", "desktop.craft.strata.foldTip.chain"],
      ["collect", "desktop.craft.strata.fold.collect", "desktop.craft.strata.foldTip.collect"],
    ];
    for (const [fold, label, tip] of cases) {
      const html = rowHtml("tool.call.before", fold, ctxOf(SMALL));
      expect(html).toContain(`>${t(label)}<`);
      expect(describedTextOf(html)).toBe(t(tip));
      expect(html).toContain(`aria-label="${t("desktop.craft.infoTip.label")}"`);
      expect(html).not.toContain('data-slot="popover"');
    }
  });

  test("a core row keeps its 내장 chip and puts the locked or wrap sentence behind the info icon", () => {
    const html = render();
    const locked = coreRowOf(html, "core.tools.run");
    expect(locked).toContain(`>${t("desktop.craft.strata.core.builtin")}<`);
    expect(describedTextOf(locked)).toBe(t("desktop.craft.strata.core.locked.tip"));
    const wrap = coreRowOf(html, "core.model.call");
    expect(wrap).toContain(`>${t("desktop.craft.strata.core.builtin")}<`);
    expect(describedTextOf(wrap)).toBe(t("desktop.craft.strata.core.wrap.tip"));
  });
});

/** 마크업에서 훅 줄 하나의 조각(다음 훅 줄 앞까지) */
function rowOf(html: string, id: string): string {
  const start = html.indexOf(`data-hook="${id}"`);
  expect(start).toBeGreaterThan(0);
  const end = html.indexOf("data-hook=", start + 1);
  return html.slice(start, end < 0 ? undefined : end);
}

function plugin(id: string, name: string, hooks: readonly string[]): CanvasPlugin {
  return { id, name, layer: "L2", origin: "user", hooks, provides: [], pieces: [], on: true };
}

/** 두 핸들러(Allow, Deny)가 같은 훅들을 가진 작은 스냅샷. 이름으로 문구를 정확히 본다 */
const SMALL_HOOKS = [
  "tool.call.before",
  "input.bash.before",
  "input.user.before",
  "input.agent.before",
  "thread.trust.before",
];
const SMALL: CanvasSnapshot = {
  plugins: [plugin("allow", "Allow", SMALL_HOOKS), plugin("deny", "Deny", SMALL_HOOKS)],
  groups: [],
};

function warning(over: Partial<OrderWarning> = {}): OrderWarning {
  return {
    severity: "skip",
    skipped: [],
    guardLosesFirst: [],
    guardMayBeSkipped: [],
    valueChanges: [],
    autoDisable: [],
    ...over,
  };
}

const denySkipped: OrderWarning["skipped"][number] = {
  registrationId: "deny",
  name: "Deny",
  reason: "first_answer",
  by: ["Allow"],
};

/** 줄 하나를 그리는 문맥. 저장과 경고는 시험마다 넣는다 */
function ctxOf(snapshot: CanvasSnapshot, over: Partial<StrataCtx> = {}): StrataCtx {
  const lanes = hooksInOrder(snapshot.plugins, {});
  return {
    snapshot,
    lanes,
    lit: litFor({ k: "agent" }, snapshot, lanes),
    sel: { k: "agent" },
    kind: "all",
    contrib: [],
    pending: new Set(),
    saved: new Set(),
    warnings: {},
    select: () => undefined,
    pickPlugin: () => undefined,
    toggle: () => undefined,
    reorder: () => undefined,
    reset: () => undefined,
    add: () => undefined,
    ...over,
  };
}

function rowHtml(id: string, fold: RowDef["fold"], ctx: StrataCtx): string {
  return renderToString(
    inStore(<HookRow def={{ id, fold, builtin: false }} mono={false} ctx={ctx} />),
  );
}

describe("Strata hook row: the handle, and the one warning line", () => {
  test("a first hook with a value answer and two handlers shows the handle and Alt keys", () => {
    const html = rowHtml("thread.trust.before", "first", ctxOf(SMALL));
    expect(html).toContain('aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"');
    expect(html).toContain("cursor:grab");
    expect(html).toContain("group-hover/pill:opacity-100");
  });

  test("a chain hook with two handlers shows the handle", () => {
    const html = rowHtml("input.user.before", "chain", ctxOf(SMALL));
    expect(html).toContain('aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"');
  });

  test("a value-answer hook with only one handler is read only", () => {
    const one: CanvasSnapshot = { plugins: [plugin("allow", "Allow", SMALL_HOOKS)], groups: [] };
    const html = rowHtml("thread.trust.before", "first", ctxOf(one));
    expect(html).not.toContain("aria-keyshortcuts");
    expect(html).not.toContain("cursor:grab");
    expect(html).not.toContain("group-hover/pill:opacity-100");
  });

  test("a block-only hook with two handlers stays read only even when its order is saved", () => {
    const ctx = ctxOf(SMALL, {
      saved: new Set(["tool.call.before"]),
      warnings: { "tool.call.before": warning({ skipped: [denySkipped] }) },
    });
    const html = rowHtml("tool.call.before", "first", ctx);
    expect(html).not.toContain("aria-keyshortcuts");
    expect(html).not.toContain("cursor:grab");
    expect(html).toContain('role="status"');
  });

  test("a saved order that skips a handler shows one line next to 추가", () => {
    const ctx = ctxOf(SMALL, {
      saved: new Set(["tool.call.before"]),
      warnings: { "tool.call.before": warning({ skipped: [denySkipped] }) },
    });
    const html = rowHtml("tool.call.before", "first", ctx);
    expect(html.split('role="status"')).toHaveLength(2);
    expect(html).toContain("Allow 먼저 끝내면 Deny 건너뛰어요");
    // 줄은 추가 단추 뒤에 놓인다
    expect(html.indexOf("추가")).toBeLessThan(html.indexOf('role="status"'));
  });

  test("several skipped handlers add the count of the rest", () => {
    const more: OrderWarning["skipped"][number] = {
      ...denySkipped,
      registrationId: "log",
      name: "Log",
    };
    const ctx = ctxOf(SMALL, {
      saved: new Set(["tool.call.before"]),
      warnings: { "tool.call.before": warning({ skipped: [denySkipped, more, more] }) },
    });
    expect(rowHtml("tool.call.before", "first", ctx)).toContain(
      "Allow 먼저 끝내면 Deny 건너뛰어요 · 외 2개",
    );
  });

  test("a guard plugin that may be skipped is named as a guard plugin", () => {
    const ctx = ctxOf(SMALL, {
      saved: new Set(["tool.call.before"]),
      warnings: {
        "tool.call.before": warning({ severity: "guard", guardMayBeSkipped: ["Scan"] }),
      },
    });
    expect(rowHtml("tool.call.before", "first", ctx)).toContain(
      "가드 플러그인 Scan: 건너뛰어질 수 있어요",
    );
  });

  test("the default order (nothing saved) shows no line even if a warning is present", () => {
    const ctx = ctxOf(SMALL, {
      warnings: { "tool.call.before": warning({ skipped: [denySkipped] }) },
    });
    expect(rowHtml("tool.call.before", "first", ctx)).not.toContain('role="status"');
  });

  test("a row with one handler shows no line even when saved", () => {
    const one: CanvasSnapshot = { plugins: [plugin("allow", "Allow", SMALL_HOOKS)], groups: [] };
    const ctx = ctxOf(one, {
      saved: new Set(["tool.call.before"]),
      warnings: { "tool.call.before": warning({ skipped: [denySkipped] }) },
    });
    expect(rowHtml("tool.call.before", "first", ctx)).not.toContain('role="status"');
  });
});
