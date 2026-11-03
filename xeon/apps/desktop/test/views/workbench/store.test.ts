import { describe, expect, test } from "bun:test";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";

const e = (name: string, status: ExtListEntry["status"]): ExtListEntry => ({
  name,
  displayName: name,
  layer: "L2",
  isGroup: false,
  version: "1.0.0",
  location: "/x",
  requestedGrade: "user",
  effectiveGrade: "user",
  tier: null,
  status,
  plugins: [{ registrationId: `${name}#root`, layer: "L2", status, inGroup: false }],
  diagnostics: [],
  autoDisabled: false,
  safeModeExcluded: null,
  hookCount: 0,
});

describe("크래프트 스토어", () => {
  test("고름과 자세히 보기는 목록 갱신에서 사라진 확장이면 풀린다", () => {
    const store = createWorkbenchStore();
    store.actions.listLoaded([e("a", "enabled"), e("b", "enabled")]);
    store.actions.openDetail("b");
    store.actions.listLoaded([e("a", "enabled")]);
    expect(store.actions.snapshot()).toMatchObject({ selected: null, detail: null, list: "ready" });
  });

  test("끄기 대기는 목록이 목표 상태를 보이면 걷힌다", () => {
    const store = createWorkbenchStore();
    store.actions.listLoaded([e("a", "enabled")]);
    store.actions.markPending("a", false);
    store.actions.listLoaded([e("a", "enabled")]);
    expect(store.actions.snapshot().pending).toEqual({ a: false });
    store.actions.listLoaded([e("a", "disabled")]);
    expect(store.actions.snapshot().pending).toEqual({});
  });

  test("15-3: 빌더 요청이 훅 이름을 담는다", () => {
    const store = createWorkbenchStore();
    store.actions.requestBuilder("tool.call.before");
    expect(store.actions.snapshot().builder).toEqual({ hook: "tool.call.before" });
    store.actions.closeBuilder();
    expect(store.actions.snapshot().builder).toBeNull();
  });

  test("보기를 바꾸면 자세히 보기가 닫힌다", () => {
    const store = createWorkbenchStore();
    store.actions.listLoaded([e("a", "enabled")]);
    store.actions.openDetail("a");
    store.actions.setView("strata");
    expect(store.actions.snapshot()).toMatchObject({ view: "strata", detail: null });
  });
});
