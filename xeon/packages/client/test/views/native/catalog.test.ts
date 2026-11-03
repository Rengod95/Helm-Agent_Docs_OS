import { describe, expect, test } from "bun:test";
import { validateUiTree } from "@fresnel/contracts/extensions";
import {
  FORBIDDEN_PROP_NAMES,
  WIDGET_CATALOG_VERSION,
  WIDGET_NAMES,
  WIDGET_SPECS,
  isForbiddenPropName,
  isWidgetName,
} from "../../../src/views/native/catalog.ts";
import { checkTree } from "../../../src/views/native/check.ts";
import { helmViewFiles, readHelmJson } from "./fixtures.ts";

describe("widget catalog v1", () => {
  test("version and the widget names, in catalog order", () => {
    expect(WIDGET_CATALOG_VERSION).toEqual("1.0.0");
    expect(WIDGET_NAMES).toEqual([
      "Stack",
      "Row",
      "Section",
      "Tabs",
      "Split",
      "Text",
      "Heading",
      "Markdown",
      "Code",
      "List",
      "Table",
      "ListDescription",
      "Badge",
      "Chip",
      "Progress",
      "Meter",
      "Stepper",
      "ActivityTree",
      "Timeline",
      "Sparkline",
      "Alert",
      "EmptyState",
      "Skeleton",
      "Button",
      "Switch",
      "Select",
      "TextField",
      "NumberField",
      "SegmentedControl",
      "Form",
      "ThreadLink",
      "TurnLink",
      "ViewLink",
      "ApprovalLink",
    ]);
  });

  test("every name has a spec and there are no extra specs", () => {
    expect(Object.keys(WIDGET_SPECS).toSorted()).toEqual([...WIDGET_NAMES].toSorted());
  });

  test("isWidgetName accepts catalog names only", () => {
    expect(isWidgetName("Stack")).toEqual(true);
    expect(isWidgetName("stack")).toEqual(false);
    expect(isWidgetName("Div")).toEqual(false);
    expect(isWidgetName("__proto__")).toEqual(false);
  });

  test("specs of representative widgets", () => {
    expect(WIDGET_SPECS.Stack).toEqual({
      props: { gap: { kind: "enum", values: ["none", "sm", "md", "lg"] } },
      binds: [],
      children: "any",
    });
    expect(WIDGET_SPECS.Stepper).toEqual({ props: {}, binds: ["current"], children: "any" });
    expect(WIDGET_SPECS.Meter).toEqual({
      props: {
        label: { kind: "string" },
        max: { kind: "number" },
        value: { kind: "number" },
      },
      binds: ["value"],
      children: "none",
    });
    expect(WIDGET_SPECS.Button.children).toEqual("none");
  });

  test("no widget prop is a forbidden name", () => {
    const names = Object.values(WIDGET_SPECS).flatMap((spec) => Object.keys(spec.props));
    expect(names.filter((name) => isForbiddenPropName(name))).toEqual([]);
  });
});

describe("forbidden prop names", () => {
  test("styling, markup and handler names are forbidden in any letter case", () => {
    expect(FORBIDDEN_PROP_NAMES).toContain("style");
    expect(isForbiddenPropName("style")).toEqual(true);
    expect(isForbiddenPropName("className")).toEqual(true);
    expect(isForbiddenPropName("CLASSNAME")).toEqual(true);
    expect(isForbiddenPropName("dangerouslySetInnerHTML")).toEqual(true);
    expect(isForbiddenPropName("href")).toEqual(true);
    expect(isForbiddenPropName("onClick")).toEqual(true);
  });

  test("tone, size and the other catalog props are not forbidden", () => {
    expect(isForbiddenPropName("tone")).toEqual(false);
    expect(isForbiddenPropName("size")).toEqual(false);
    expect(isForbiddenPropName("gap")).toEqual(false);
    expect(isForbiddenPropName("text")).toEqual(false);
  });
});

describe("group-helm view trees", () => {
  test("the group-helm view files are the five known trees", () => {
    expect(helmViewFiles()).toEqual([
      "helm-finished.view.json",
      "helm-inquiry.view.json",
      "helm-panel.view.json",
      "helm-phase.view.json",
      "helm-suggested.view.json",
    ]);
  });

  for (const file of helmViewFiles()) {
    test(`${file} passes validateUiTree and checkTree with no issues`, () => {
      const checked = validateUiTree(readHelmJson(file));
      expect(checked.ok).toEqual(true);
      const issues = checked.ok ? checkTree(checked.tree).issues : undefined;
      expect(issues).toEqual([]);
    });
  }
});
