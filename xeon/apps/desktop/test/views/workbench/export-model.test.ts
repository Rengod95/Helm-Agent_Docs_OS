import { expect, test } from "bun:test";
import {
  exportFailureDetail,
  exportOutOf,
  stampOf,
} from "../../../src/views/workbench/export-model.ts";

const AT = new Date("2026-11-07T08:09:10.000Z");

test("the stamp keeps only characters a folder name can hold", () => {
  expect(stampOf(AT)).toBe("20261107-080910");
});

test("the package folder lies under the config folder, never inside the installed extension", () => {
  expect(
    exportOutOf(
      {
        name: "lens",
        version: "1.2.0",
        location: "/Users/a/Library/fresnel/config/extensions/lens",
      },
      AT,
    ),
  ).toBe("/Users/a/Library/fresnel/config/exports/lens-1.2.0-20261107-080910");
  expect(
    exportOutOf(
      { name: "lens", version: "1.2.0", location: "C:\\fresnel\\config\\extensions\\lens" },
      AT,
    ),
  ).toBe("C:\\fresnel\\config\\exports\\lens-1.2.0-20261107-080910");
});

test("an installed copy in the reviewed store exports next to the store, never inside it", () => {
  expect(
    exportOutOf(
      {
        name: "kit",
        version: "0.2.0",
        location: "/Users/a/Library/fresnel/data/plugin-store/reviewed/kit/c8b04a14/tree",
      },
      AT,
    ),
  ).toBe("/Users/a/Library/fresnel/data/exports/kit-0.2.0-20261107-080910");
  expect(
    exportOutOf(
      {
        name: "kit",
        version: "0.2.0",
        location: "C:\\fresnel\\data\\plugin-store\\reviewed\\proj\\kit\\c8b04a14\\tree",
      },
      AT,
    ),
  ).toBe("C:\\fresnel\\data\\exports\\kit-0.2.0-20261107-080910");
});

test("a location without two parent folders cannot be exported", () => {
  expect(exportOutOf({ name: "lens", version: "1.0.0", location: "builtin" }, AT)).toBeNull();
  expect(
    exportOutOf({ name: "lens", version: "1.0.0", location: "/extensions/lens" }, AT),
  ).toBeNull();
});

test("the failure detail is the engine's issue sentence only when it rejected the input", () => {
  expect(
    exportFailureDetail({
      kind: "rejected",
      code: -32602,
      issue: "invalid_input: validation failed: AU-001",
    }),
  ).toBe("invalid_input: validation failed: AU-001");
  expect(exportFailureDetail({ kind: "rejected", code: -32602 })).toBeNull();
  expect(exportFailureDetail({ kind: "offline" })).toBeNull();
});
