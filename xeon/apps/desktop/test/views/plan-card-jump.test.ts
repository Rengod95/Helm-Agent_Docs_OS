import { describe, expect, test } from "bun:test";
import {
  jumpToPlanCard,
  type PlanCardElement,
  type PlanCardRoot,
} from "../../src/views/plan-card-jump.ts";

// "계획 보기": 대화의 계획 카드(승인 카드의 plan 종류)를 찾아 스크롤하고 초점을 준다. 카드가 없으면 false다.

function fakeCard(log: string[]): { readonly root: PlanCardRoot; readonly selectors: string[] } {
  const selectors: string[] = [];
  const item: PlanCardElement = {
    closest: () => null,
    scrollIntoView: (options) => {
      log.push(`scroll:${options.block}`);
    },
    focus: () => {
      log.push("focus:item");
    },
  };
  const head: PlanCardElement = {
    closest: (selector) => {
      selectors.push(selector);
      return item;
    },
    scrollIntoView: () => {
      log.push("scroll:head");
    },
    focus: () => {
      log.push("focus:head");
    },
  };
  return {
    selectors,
    root: {
      querySelector: (selector) => {
        selectors.push(selector);
        return head;
      },
    },
  };
}

describe("jumpToPlanCard", () => {
  test("with a plan card on screen the card item is scrolled to the middle and the card head gets the focus", () => {
    const log: string[] = [];
    const { root, selectors } = fakeCard(log);
    expect(jumpToPlanCard(root)).toBe(true);
    expect(log).toEqual(["scroll:center", "focus:head"]);
    expect(selectors).toEqual([
      '[data-slot="approval-card-item"] [data-approval-kind="plan"]',
      '[data-slot="approval-card-item"]',
    ]);
  });

  test("without a plan card nothing is scrolled and the answer is false", () => {
    expect(jumpToPlanCard({ querySelector: () => null })).toBe(false);
  });
});
