import { describe, expect, test } from "bun:test";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import {
  craftDispatch,
  craftStateOf,
  type CraftAction,
  type CraftState,
} from "../../../src/views/craft/craft-context.tsx";

/** 동작을 차례로 스토어에 넣고 캔버스가 읽는 값을 돌려준다 */
function run(actions: readonly CraftAction[]): CraftState {
  const store = createWorkbenchStore();
  for (const action of actions) craftDispatch(store.actions, action);
  return craftStateOf(store.actions.snapshot());
}

describe("craftStateOf: 캔버스가 읽는 값은 스토어에서 그대로 온다", () => {
  test("처음 값은 지도 보기, 에이전트 선택, 패널 닫힘, 거르기 없음이다", () => {
    expect(craftStateOf(createWorkbenchStore().actions.snapshot())).toEqual({
      mode: "orbit",
      sel: { k: "agent" },
      panel: false,
      kind: "all",
      contrib: [],
      detail: null,
      query: "",
    });
  });

  test("mode는 스토어의 view다", () => {
    expect(run([{ t: "mode", mode: "link" }]).mode).toBe("link");
  });
});

describe("craftDispatch: 캔버스 동작을 스토어 동작 하나로 옮긴다", () => {
  test("고른 것은 보기를 바꿔도 남고, 선택 패널은 열린 채 남는다", () => {
    const state = run([
      { t: "selectPlugin", id: "helm" },
      { t: "mode", mode: "strata" },
      { t: "mode", mode: "link" },
    ]);
    expect(state).toMatchObject({ mode: "link", sel: { k: "plugin", id: "helm" }, panel: true });
  });

  test("구성 요소 거르기는 토글하고, clear는 선택과 패널을 닫되 거르기는 남긴다", () => {
    const state = run([
      { t: "contrib", contrib: "hook" },
      { t: "contrib", contrib: "skill" },
      { t: "contrib", contrib: "hook" },
      { t: "selectGroup", id: "helm" },
      { t: "clear" },
    ]);
    expect(state).toMatchObject({ contrib: ["skill"], panel: false, sel: { k: "agent" } });
  });

  test("자세히 보기는 열고 닫아도 고른 것을 바꾸지 않는다", () => {
    const opened = run([
      { t: "selectPlugin", id: "review" },
      { t: "detail", id: "review" },
    ]);
    expect(opened).toMatchObject({ detail: "review", sel: { k: "plugin", id: "review" } });
    const closed = run([
      { t: "selectPlugin", id: "review" },
      { t: "detail", id: "review" },
      { t: "detail", id: null },
    ]);
    expect(closed).toMatchObject({ detail: null, sel: { k: "plugin", id: "review" } });
  });

  test("거르기 종류, 찾기 글, 층 고르기를 스토어에 그대로 넣는다", () => {
    const state = run([
      { t: "kind", kind: "external" },
      { t: "query", query: "웹" },
      { t: "selectOther", sel: { k: "layer", id: "L2" } },
    ]);
    expect(state).toMatchObject({
      kind: "external",
      query: "웹",
      sel: { k: "layer", id: "L2" },
      panel: true,
    });
  });

  test("보기를 바꾸면 자세히 보기가 닫힌다(setView의 규칙을 그대로 따른다)", () => {
    const state = run([
      { t: "detail", id: "review" },
      { t: "mode", mode: "strata" },
    ]);
    expect(state).toMatchObject({ mode: "strata", detail: null });
  });
});
