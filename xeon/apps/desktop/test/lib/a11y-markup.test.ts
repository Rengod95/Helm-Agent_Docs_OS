import { expect, test } from "bun:test";
import { a11yProblems } from "./a11y-markup.ts";

test("a11y-markup.finds-controls-without-a-name", () => {
  const markup = [
    "<button></button>",
    '<button aria-label="닫기"></button>',
    "<button><svg></svg> 저장</button>",
    '<a href="/x"><svg></svg></a>',
    "<a>이동 안 하는 앵커</a>",
    '<input type="text"/>',
    '<input id="n" type="text"/><label for="n">이름</label>',
    '<input type="hidden"/>',
    '<input type="radio" aria-hidden="true" tabindex="-1"/>',
    '<img src="a.png"/>',
    '<img src="a.png" alt=""/>',
    '<div tabindex="0"></div><div tabindex="3"></div>',
  ].join("");
  expect(a11yProblems(markup).map((problem) => problem.rule)).toEqual([
    "button-name",
    "link-name",
    "input-name",
    "image-alt",
    "tabindex-positive",
  ]);
});
