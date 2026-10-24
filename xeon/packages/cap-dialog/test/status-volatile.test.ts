import { describe, expect, test } from "bun:test";
import type { StatusItem } from "@xeon/contracts/capabilities";
import { DialogStatus } from "@xeon/contracts/capabilities";
import { DIALOG_EVENT_CATALOG } from "@xeon/contracts/records";
import { STATUS_BATCH_MS, createStatusService } from "../src/status/service.ts";
import { segmentMatches, selectSegments } from "../src/status/store.ts";
import { callOptions, harness, newThread } from "./support/harness.ts";

function setup(layers: Parameters<typeof harness>[0] = {}) {
  const h = harness(layers);
  return { h, ...createStatusService(h.deps) };
}

const phase: StatusItem = { id: "helm.phase", text: "2/3단계", tone: "busy" };

describe("상태 이벤트 휘발성", () => {
  test("setItem 뒤 휘발 이벤트가 나가고 list가 현재 스냅숏을 돌려준다", async () => {
    const { h, api } = setup();
    const thread = newThread();
    await api.setItem(phase, callOptions(thread));
    // 묶음 창이 닫히기 전에는 이벤트가 없다
    expect(h.status.published).toHaveLength(0);
    await h.timers.advance(STATUS_BATCH_MS);
    expect(h.status.published).toEqual([{ threadId: thread, items: [phase] }]);
    expect(await api.list({}, callOptions(thread))).toEqual({ items: [phase] });
  });

  test("100 ms 안 변경 셋은 이벤트 하나이고 마지막 상태를 싣는다", async () => {
    const { h, api } = setup();
    const thread = newThread();
    const options = callOptions(thread);
    await api.setItem({ id: "helm.phase", text: "1/3단계" }, options);
    await h.timers.advance(40);
    await api.setItem({ id: "helm.phase", text: "2/3단계" }, options);
    await api.setItem({ id: "helm.lens", text: "렌즈 3" }, options);
    await h.timers.advance(60);
    expect(h.status.published).toHaveLength(1);
    // id 바이트 순: helm.lens, helm.phase
    expect(h.status.published[0]?.items.map((item) => item.text)).toEqual(["렌즈 3", "2/3단계"]);
    await api.setItem({ id: "helm.phase", text: "3/3단계" }, options);
    await h.timers.advance(STATUS_BATCH_MS);
    expect(h.status.published).toHaveLength(2);
  });

  test("clearItem은 지우고 같은 방식으로 발행한다", async () => {
    const { h, api } = setup();
    const thread = newThread();
    const options = callOptions(thread);
    await api.setItem(phase, options);
    await h.timers.advance(STATUS_BATCH_MS);
    await api.clearItem({ id: "helm.phase" }, options);
    await h.timers.advance(STATUS_BATCH_MS);
    expect(h.status.published.at(-1)).toEqual({ threadId: thread, items: [] });
    expect(await api.list({}, options)).toEqual({ items: [] });
  });

  test("스레드마다 따로 쌓인다", async () => {
    const { api } = setup();
    const one = newThread();
    const two = newThread();
    await api.setItem(phase, callOptions(one));
    expect((await api.list({}, callOptions(two))).items).toEqual([]);
  });

  test("표시 순서는 order, 같으면 id 바이트 순이다", async () => {
    const { api } = setup();
    const options = callOptions(newThread());
    await api.setItem({ id: "z.last", text: "z" }, options);
    await api.setItem({ id: "a.late", text: "a", order: 900 }, options);
    await api.setItem({ id: "m.mid", text: "m" }, options);
    await api.setItem({ id: "b.early", text: "b", order: 10 }, options);
    expect((await api.list({}, options)).items.map((item) => item.id)).toEqual([
      "b.early",
      "m.mid",
      "z.last",
      "a.late",
    ]);
  });

  test("휘발 이벤트는 32개까지 싣고 list에는 전부 남는다", async () => {
    const { h, api } = setup();
    const thread = newThread();
    const options = callOptions(thread);
    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        api.setItem({ id: `g.s${String(index).padStart(2, "0")}`, text: `${index}` }, options),
      ),
    );
    await h.timers.advance(STATUS_BATCH_MS);
    expect(h.status.published[0]?.items).toHaveLength(32);
    expect((await api.list({}, options)).items).toHaveLength(40);
  });

  test("스레드 문맥이 없으면 invalid_input이다", async () => {
    const { api } = setup();
    let failed: unknown;
    try {
      await api.setItem(phase, {});
    } catch (caught) {
      failed = caught;
    }
    expect(failed).toMatchObject({ data: { code: "invalid_input" } });
  });

  test("카탈로그에서 dialog.status는 휘발이다", () => {
    const entry = DIALOG_EVENT_CATALOG.find((candidate) => candidate.kind === "dialog.status");
    expect(entry?.durable).toBe(false);
    expect(DialogStatus.tools).toEqual([]);
  });
});

describe("표시할 세그먼트 설정", () => {
  const items: StatusItem[] = [
    { id: "core.turn", text: "t" },
    { id: "core.usage", text: "u" },
    { id: "helm.phase", text: "p" },
    { id: "other.x", text: "x" },
  ];

  test("정확한 id, 접두 패턴, * 하나", () => {
    expect(segmentMatches("core.turn", "core.turn")).toBe(true);
    expect(segmentMatches("core.turn", "core.tools")).toBe(false);
    expect(segmentMatches("helm.*", "helm.phase")).toBe(true);
    expect(segmentMatches("helm.*", "other.x")).toBe(false);
    expect(segmentMatches("*", "anything.here")).toBe(true);
  });

  test("기본값은 내장 셋과 나머지 전부를 보인다", () => {
    expect(selectSegments(items, ["core.turn", "core.tools", "core.usage", "*"])).toHaveLength(4);
  });

  test("목록에 없는 항목은 보이지 않는다", async () => {
    const { h, api } = setup({
      layers: [{ scope: "user", values: new Map([["l2.dialog.status.segments", ["helm.*"]]]) }],
    });
    const thread = newThread();
    const options = callOptions(thread);
    await Promise.all(items.map((item) => api.setItem(item, options)));
    await h.timers.advance(STATUS_BATCH_MS);
    expect((await api.list({}, options)).items.map((item) => item.id)).toEqual(["helm.phase"]);
    expect(h.status.published[0]?.items.map((item) => item.id)).toEqual(["helm.phase"]);
  });
});
