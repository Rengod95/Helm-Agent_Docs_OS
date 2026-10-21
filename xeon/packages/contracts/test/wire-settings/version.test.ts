import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  FeatureInfoSchema,
  WIRE_METHODS,
  WIRE_PROTOCOL_VERSION,
  isCompatible,
} from "../../src/wire-settings/wire/index.ts";
import { SEMVER_PATTERN } from "../../src/capabilities/index.ts";

describe("isCompatible", () => {
  test("0.x needs the same minor version", () => {
    expect(isCompatible("0.1.0", "0.1.5")).toBe(true);
    expect(isCompatible("0.1.0", "0.2.0")).toBe(false);
    expect(isCompatible("0.2.0", "0.1.0")).toBe(false);
  });

  test("1.x and later compare only the major version", () => {
    expect(isCompatible("1.0.0", "1.9.3")).toBe(true);
    expect(isCompatible("1.9.0", "1.0.0")).toBe(true);
    expect(isCompatible("1.0.0", "2.0.0")).toBe(false);
    expect(isCompatible("2.1.0", "1.1.0")).toBe(false);
  });

  test("pre-release suffixes do not change the comparison", () => {
    expect(isCompatible("1.0.0-rc.1", "1.2.0")).toBe(true);
    expect(isCompatible("0.1.0-beta", "0.1.0")).toBe(true);
  });

  test("malformed versions are never compatible", () => {
    for (const bad of ["", "1", "1.0", "v1.0.0", "01.0.0", "1.0.0.0", "x.y.z"]) {
      expect(isCompatible(bad, "1.0.0")).toBe(false);
      expect(isCompatible("1.0.0", bad)).toBe(false);
    }
  });

  test("the protocol version is a valid semver and compatible with itself", () => {
    expect(new RegExp(SEMVER_PATTERN).test(WIRE_PROTOCOL_VERSION)).toBe(true);
    expect(isCompatible(WIRE_PROTOCOL_VERSION, WIRE_PROTOCOL_VERSION)).toBe(true);
  });
});

describe("FeatureInfo", () => {
  test("accepts the lifecycle fields", () => {
    const info = {
      name: "thread.fork",
      status: "deprecated",
      since: "0.1.0",
      deprecatedIn: "0.3.0",
      removeAfter: "2027-10-21",
      replacedBy: "thread.branch",
    };
    expect(parse(FeatureInfoSchema, info).ok).toBe(true);
    expect(parse(FeatureInfoSchema, { ...info, status: "gone" }).ok).toBe(false);
    expect(parse(FeatureInfoSchema, { ...info, since: "0.1" }).ok).toBe(false);
  });

  test("every registered method starts active at the protocol version", () => {
    for (const [name, spec] of Object.entries(WIRE_METHODS)) {
      expect({ name, status: spec.status, since: spec.since }).toEqual({
        name,
        status: "active",
        since: "0.1.0",
      });
    }
  });
});
