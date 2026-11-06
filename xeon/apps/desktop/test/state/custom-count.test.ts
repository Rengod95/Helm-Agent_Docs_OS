import { expect, test } from "bun:test";
import type { ItemRecord } from "@fresnel/contracts/conversation";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { selectCustomCount } from "../../src/state/engine/selectors.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import type { MirrorInput } from "../../src/state/engine/input.ts";
import { HELM_CHANGE_KINDS } from "../../src/views/plugin/helm-results-model.ts";
import { itm, summary, thr, userItem } from "./helpers.ts";

// 확장 화면이 "탐구가 바뀌었다"를 아는 길: 열린 대화에 쌓인 확장 기록 가운데 주어진 종류의 수.

const T = thr(1);

function custom(n: number, customType: string): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "custom",
    message: {
      role: "custom",
      customType,
      content: "[helm]",
      display: true,
      details: {},
      timestamp: 0,
    },
  };
}

function mirrorOf(items: readonly ItemRecord[], opened: boolean): EngineMirror {
  const inputs: readonly MirrorInput[] = [
    { type: "threads", threads: [summary(T, { status: "idle" })] },
    ...(opened
      ? [
          { type: "transcript_opening", threadId: T } satisfies MirrorInput,
          { type: "transcript", threadId: T, asOfSeq: 1, items } satisfies MirrorInput,
        ]
      : []),
  ];
  let state = INITIAL_MIRROR;
  for (const input of inputs) state = reduceMirror(state, input).state;
  return state;
}

test("counts only the listed custom kinds in the open transcript", () => {
  const items = [
    userItem(1),
    custom(2, "grp.helm.notice.status"),
    custom(3, "grp.helm.notice.suggested"),
    custom(4, "grp.helm.notice.status"),
    custom(5, "other.notice.status"),
  ];
  expect(selectCustomCount(mirrorOf(items, true), HELM_CHANGE_KINDS)).toBe(2);
  expect(selectCustomCount(mirrorOf(items.slice(0, 3), true), HELM_CHANGE_KINDS)).toBe(1);
});

test("is zero when no transcript is open or it holds no such record", () => {
  expect(selectCustomCount(mirrorOf([], false), HELM_CHANGE_KINDS)).toBe(0);
  expect(selectCustomCount(mirrorOf([userItem(1)], true), HELM_CHANGE_KINDS)).toBe(0);
});
