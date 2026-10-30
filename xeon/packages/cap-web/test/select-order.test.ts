import { describe, expect, test } from "bun:test";
import type { ProviderCandidate } from "@xeon/contracts/capabilities";
import { planSelection, type SelectionInput } from "../src/select/order.ts";

// 자동 선택 순서 하나(L2.web.spec §4.8.2, D-M3-23 행 1). 검색과 브라우저가 같이 쓴다.

const DETECTED: ProviderCandidate = { id: "web-detected", origin: "detected" };
const BUILTIN: ProviderCandidate = { id: "local-browser", origin: "builtin" };
const PLUGIN_X: ProviderCandidate = { id: "plugin:web-x", origin: "plugin" };
const PLUGIN_A: ProviderCandidate = { id: "plugin:web-a", origin: "plugin" };
const ALL: readonly ProviderCandidate[] = [PLUGIN_X, BUILTIN, DETECTED, PLUGIN_A];

interface Row {
  readonly name: string;
  readonly candidates: readonly ProviderCandidate[];
  readonly call: string | undefined;
  readonly setting: string;
  readonly order: readonly string[];
  readonly selectedBy: "call" | "setting" | "auto";
  readonly planned: readonly string[];
}

const ROWS: readonly Row[] = [
  {
    name: "a call argument wins over the setting and the order list",
    candidates: ALL,
    call: "plugin:web-x",
    setting: "local-browser",
    order: ["web-detected"],
    selectedBy: "call",
    planned: ["plugin:web-x"],
  },
  {
    name: "an unknown call argument selects nothing",
    candidates: ALL,
    call: "ghost",
    setting: "auto",
    order: [],
    selectedBy: "call",
    planned: [],
  },
  {
    name: "a setting other than auto selects only that provider",
    candidates: ALL,
    call: undefined,
    setting: "local-browser",
    order: ["plugin:web-x"],
    selectedBy: "setting",
    planned: ["local-browser"],
  },
  {
    name: "an unknown setting selects nothing",
    candidates: ALL,
    call: undefined,
    setting: "ghost",
    order: [],
    selectedBy: "setting",
    planned: [],
  },
  {
    name: "auto with an empty order: detected, then builtin, then plugins in byte order",
    candidates: ALL,
    call: undefined,
    setting: "auto",
    order: [],
    selectedBy: "auto",
    planned: ["web-detected", "local-browser", "plugin:web-a", "plugin:web-x"],
  },
  {
    name: "a plugin the user dragged to the top goes first",
    candidates: ALL,
    call: undefined,
    setting: "auto",
    order: ["plugin:web-x"],
    selectedBy: "auto",
    planned: ["plugin:web-x", "web-detected", "local-browser", "plugin:web-a"],
  },
  {
    name: "a builtin tool can be dragged ahead of a plugin",
    candidates: ALL,
    call: undefined,
    setting: "auto",
    order: ["local-browser", "plugin:web-x"],
    selectedBy: "auto",
    planned: ["local-browser", "plugin:web-x", "web-detected", "plugin:web-a"],
  },
  {
    name: "a detected tool listed after a plugin keeps the listed order",
    candidates: ALL,
    call: undefined,
    setting: "auto",
    order: ["plugin:web-a", "web-detected"],
    selectedBy: "auto",
    planned: ["plugin:web-a", "web-detected", "local-browser", "plugin:web-x"],
  },
  {
    name: "ids that are not registered are skipped",
    candidates: ALL,
    call: undefined,
    setting: "auto",
    order: ["ghost", "plugin:web-a", "plugin:not-installed"],
    selectedBy: "auto",
    planned: ["plugin:web-a", "web-detected", "local-browser", "plugin:web-x"],
  },
  {
    name: "a duplicate id in the order list counts once",
    candidates: ALL,
    call: undefined,
    setting: "auto",
    order: ["plugin:web-x", "plugin:web-x", "local-browser"],
    selectedBy: "auto",
    planned: ["plugin:web-x", "local-browser", "web-detected", "plugin:web-a"],
  },
  {
    name: "no candidates selects nothing in auto",
    candidates: [],
    call: undefined,
    setting: "auto",
    order: ["plugin:web-x"],
    selectedBy: "auto",
    planned: [],
  },
  {
    name: "no candidates selects nothing for a call argument",
    candidates: [],
    call: "local-browser",
    setting: "auto",
    order: [],
    selectedBy: "call",
    planned: [],
  },
];

function inputOf(row: Row): SelectionInput {
  return {
    candidates: row.candidates,
    ...(row.call === undefined ? {} : { callProvider: row.call }),
    settingProvider: row.setting,
    order: row.order,
  };
}

describe("planSelection", () => {
  test("value table: selection kind and attempt order", () => {
    const actual = ROWS.map((row) => {
      const plan = planSelection(inputOf(row));
      return { name: row.name, selectedBy: plan.selectedBy, order: plan.order };
    });
    expect(actual).toEqual(
      ROWS.map((row) => ({ name: row.name, selectedBy: row.selectedBy, order: row.planned })),
    );
  });
});
