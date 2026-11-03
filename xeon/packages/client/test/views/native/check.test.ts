import { describe, expect, test } from "bun:test";
import type { UiNode } from "@fresnel/contracts/extensions";
import { checkTree, type TreeIssue } from "../../../src/views/native/check.ts";

/** 이슈를 코드, 경로, 문장으로 적는다. 비교가 한눈에 보이도록 */
function summary(issues: readonly TreeIssue[]): readonly (readonly [string, string])[] {
  return issues.map((issue): readonly [string, string] => [issue.code, issue.path]);
}

describe("checkTree", () => {
  test("a valid tree has no issues", () => {
    const tree: UiNode = {
      type: "Stack",
      props: { gap: "md" },
      children: [
        { type: "Heading", props: { text: "Title", level: 2 } },
        { type: "Text", bind: { text: { path: "/body", format: "number" } } },
        { type: "Badge", props: { text: "ok", tone: "success" } },
      ],
    };
    expect(checkTree(tree)).toEqual({ issues: [] });
  });

  test("an unknown widget is one issue at its type, and its valid children are not reported", () => {
    const tree: UiNode = { type: "Gizmo", children: [{ type: "Text", props: { text: "x" } }] };
    expect(summary(checkTree(tree).issues)).toEqual([["unknown_widget", "/type"]]);
    expect(checkTree({ type: "Gizmo" }).issues.map((issue) => issue.message)).toEqual([
      '"Gizmo" is not in widget catalog 1.0.0',
    ]);
  });

  test("a forbidden prop on a known widget is reported with its pointer", () => {
    const tree: UiNode = { type: "Stack", props: { style: "color: red" } };
    const issues = checkTree(tree).issues;
    expect(summary(issues)).toEqual([["forbidden_prop", "/props/style"]]);
    expect(issues.map((issue) => issue.message)).toEqual([
      '"style" is a forbidden name: styling, markup and handlers are not part of the tree',
    ]);
  });

  test("a forbidden prop on an unknown widget is reported in addition to the unknown widget", () => {
    const tree: UiNode = { type: "Gizmo", props: { className: "a" } };
    expect(summary(checkTree(tree).issues)).toEqual([
      ["unknown_widget", "/type"],
      ["forbidden_prop", "/props/className"],
    ]);
  });

  test("a forbidden bind key is reported", () => {
    const tree: UiNode = { type: "Text", bind: { href: { path: "/url" } } };
    expect(summary(checkTree(tree).issues)).toEqual([["forbidden_prop", "/bind/href"]]);
  });

  test("a prop the widget does not have is prop_not_allowed", () => {
    const tree: UiNode = { type: "Stack", props: { title: "x" } };
    expect(summary(checkTree(tree).issues)).toEqual([["prop_not_allowed", "/props/title"]]);
  });

  test("an enum prop outside its values is prop_type, and the message lists the values only", () => {
    const tree: UiNode = {
      type: "Stack",
      props: { gap: "a very long value that must not be echoed back" },
    };
    const issues = checkTree(tree).issues;
    expect(summary(issues)).toEqual([["prop_type", "/props/gap"]]);
    expect(issues.map((issue) => issue.message)).toEqual([
      'prop "gap" must be one of none, sm, md, lg',
    ]);
  });

  test("a number prop given a string, and a null prop, are prop_type", () => {
    const level: UiNode = { type: "Heading", props: { text: "t", level: "2" } };
    expect(summary(checkTree(level).issues)).toEqual([["prop_type", "/props/level"]]);
    const nothing: UiNode = { type: "Text", props: { text: null } };
    expect(summary(checkTree(nothing).issues)).toEqual([["prop_type", "/props/text"]]);
  });

  test("a bind key that is neither a prop nor in binds is bind_not_allowed", () => {
    const tree: UiNode = { type: "Text", bind: { gap: { path: "/x" } } };
    expect(summary(checkTree(tree).issues)).toEqual([["bind_not_allowed", "/bind/gap"]]);
  });

  test("a bind key in binds, and a bind key that is a prop name, are allowed", () => {
    const stepper: UiNode = { type: "Stepper", bind: { current: { path: "/status/phase" } } };
    expect(checkTree(stepper)).toEqual({ issues: [] });
    const text: UiNode = { type: "Text", bind: { text: { path: "/t" } } };
    expect(checkTree(text)).toEqual({ issues: [] });
  });

  test("a widget with no children accepts none", () => {
    const tree: UiNode = { type: "Text", children: [{ type: "Stack" }] };
    expect(summary(checkTree(tree).issues)).toEqual([["children_not_allowed", "/children"]]);
    const empty: UiNode = { type: "Text", children: [] };
    expect(checkTree(empty)).toEqual({ issues: [] });
  });

  test("issues in nested children carry the full JSON Pointer", () => {
    const tree: UiNode = {
      type: "Stack",
      children: [{ type: "Row", children: [{ type: "Badge", props: { tone: "loud" } }] }],
    };
    expect(summary(checkTree(tree).issues)).toEqual([
      ["prop_type", "/children/0/children/0/props/tone"],
    ]);
  });

  test("a prop key with a slash is escaped in the pointer", () => {
    const tree: UiNode = { type: "Stack", props: { "a/b": "x" } };
    expect(summary(checkTree(tree).issues)).toEqual([["prop_not_allowed", "/props/a~1b"]]);
  });

  test("an each name that an enclosing each already uses is each_scope", () => {
    const tree: UiNode = {
      type: "Stack",
      each: { path: "/a", as: "x" },
      children: [{ type: "Row", each: { path: "/b", as: "x" } }],
    };
    expect(summary(checkTree(tree).issues)).toEqual([["each_scope", "/children/0/each/as"]]);
  });

  test("a bind or when path that starts with an enclosing each name is fine", () => {
    const tree: UiNode = {
      type: "Stack",
      each: { path: "/items", as: "lens" },
      children: [
        {
          type: "Text",
          bind: { text: { path: "/lens/title" } },
          when: { path: "/lens/status", op: "eq", value: "run" },
        },
      ],
    };
    expect(checkTree(tree)).toEqual({ issues: [] });
  });
});
