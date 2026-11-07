import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import { SecretEntryMetaSchema } from "../../src/capabilities/index.ts";
import {
  SettingsFileProblemSchema,
  WIRE_ERRORS,
  WIRE_METHODS,
} from "../../src/wire-settings/wire/index.ts";
import {
  EffectiveSettingSchema,
  SettingUiSchema,
  SettingsTabSchema,
  resolveSetting,
  toSettingDefWire,
  toValueJsonSchema,
  validateSettingValue,
} from "../../src/wire-settings/settings/index.ts";
import { rawId } from "../helpers/ids.ts";
import { intDef } from "./helpers.ts";

// M3-REQ-15, M3-REQ-17, M3-m2c-02(계약 부분). 값을 왕복해 견주고, 거부 값을 확인한다.
const SHA = "b".repeat(64);
const THREAD = rawId("thr", 1);

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function parsed(schema: Parameters<typeof parse>[0], value: unknown): unknown {
  const result = parse(schema, roundTrip(value));
  return result.ok ? result.value : undefined;
}

describe("settings.readFile and settings.writeFile", () => {
  test("params and results survive a round trip", () => {
    const read = WIRE_METHODS["settings.readFile"];
    const params = { scope: "project", threadId: THREAD };
    expect(parsed(read.params, params)).toEqual(params);
    const result = {
      scope: "project",
      path: "/work/.fresnel/settings.json",
      exists: true,
      readOnly: false,
      text: '{"l1.loop.maxSteps":3}',
      sha256: SHA,
      unknownKeys: ["x.old.key"],
    };
    expect(parsed(read.result, result)).toEqual(result);
    const missing = {
      ...result,
      path: null,
      exists: false,
      text: "",
      sha256: null,
      unknownKeys: [],
    };
    expect(parsed(read.result, missing)).toEqual(missing);

    const write = WIRE_METHODS["settings.writeFile"];
    const wParams = { scope: "user", text: "{}", baseSha256: null };
    expect(parsed(write.params, wParams)).toEqual(wParams);
    const wResult = { path: "/home/u/.fresnel/settings.json", sha256: SHA, unknownKeys: [] };
    expect(parsed(write.result, wResult)).toEqual(wResult);
  });

  test("managed is read-only: writeFile rejects it and a bad hash", () => {
    const write = WIRE_METHODS["settings.writeFile"];
    expect(parse(write.params, { scope: "managed", text: "{}", baseSha256: null }).ok).toBe(false);
    expect(parse(write.params, { scope: "user", text: "{}", baseSha256: "xyz" }).ok).toBe(false);
    expect(parse(write.params, { scope: "user", text: "{}" }).ok).toBe(false);
    expect(parse(WIRE_METHODS["settings.readFile"].params, { scope: "managed" }).ok).toBe(true);
    expect(parse(WIRE_METHODS["settings.readFile"].params, { scope: "launch" }).ok).toBe(false);
  });

  test("file errors carry scope and issues", () => {
    const conflict = WIRE_ERRORS["settings.fileConflict"];
    const invalid = WIRE_ERRORS["settings.fileInvalid"];
    expect(conflict.code).toBe(3107);
    expect(invalid.code).toBe(3108);
    if (conflict.details === undefined || invalid.details === undefined) {
      throw new Error("details expected");
    }
    expect(parse(conflict.details, { scope: "user" }).ok).toBe(true);
    expect(
      parse(invalid.details, { scope: "user", issues: [{ path: "/a", message: "bad" }] }).ok,
    ).toBe(true);
    expect(parse(invalid.details, { scope: "user" }).ok).toBe(false);
  });
});

describe("settings file problems", () => {
  test("a problem names the file and its reason, and its position is optional", () => {
    const broken = { scope: "user", path: "/home/u/settings.json", reason: "not_object" };
    expect(parse(SettingsFileProblemSchema, { ...broken, line: null, column: null }).ok).toBe(true);
    expect(parse(SettingsFileProblemSchema, { ...broken, line: 1, column: 1 }).ok).toBe(true);
    expect(parse(SettingsFileProblemSchema, { ...broken, line: null }).ok).toBe(false);
    expect(parse(SettingsFileProblemSchema, { ...broken, scope: "managed", line: 1 }).ok).toBe(
      false,
    );
  });

  test("store.io details may carry the settings file path and position, not other fields", () => {
    const { details } = WIRE_ERRORS["store.io"];
    if (details === undefined) throw new Error("details expected");
    expect(
      parse(details, {
        code: "settings_file_invalid",
        path: "/w/settings.json",
        line: 1,
        column: 8,
      }).ok,
    ).toBe(true);
    expect(parse(details, { code: "settings_file_invalid" }).ok).toBe(true);
    expect(parse(details, { code: "EACCES", line: 0 }).ok).toBe(false);
    expect(parse(details, { code: "EACCES", text: "{" }).ok).toBe(false);
  });
});

describe("usage.get", () => {
  test("gauges round trip and reject a negative amount", () => {
    const usage = WIRE_METHODS["usage.get"];
    expect(parsed(usage.params, { providerId: "anthropic", threadId: THREAD })).toEqual({
      providerId: "anthropic",
      threadId: THREAD,
    });
    const result = {
      gauges: [
        {
          id: "anthropic:work:day:usd",
          providerId: "anthropic",
          account: "work",
          window: "day",
          unit: "usd",
          used: 1.5,
          limit: null,
          resetsAt: "2026-10-29T00:00:00Z",
        },
      ],
      asOf: "2026-10-28T12:00:00Z",
    };
    expect(parsed(usage.result, result)).toEqual(result);
    const bad = { ...result, gauges: [{ ...result.gauges[0], used: -1 }] };
    expect(parse(usage.result, bad).ok).toBe(false);
  });
});

describe("settings ui and effective value additions", () => {
  test("sandbox tab and editor hint are accepted, unknown ones are rejected", () => {
    expect(parse(SettingsTabSchema, "sandbox").ok).toBe(true);
    const ui = { tab: "sandbox", widget: "list", editor: "sandboxLists", order: 1, label: "x" };
    expect(parsed(SettingUiSchema, ui)).toEqual(ui);
    expect(parse(SettingUiSchema, { ...ui, editor: "other" }).ok).toBe(false);
    const { editor: _editor, ...without } = ui;
    expect(parse(SettingUiSchema, without).ok).toBe(true);
  });

  test("lockReason and problem round trip and a plain setting still parses", () => {
    const { setting } = resolveSetting(intDef(), []);
    expect(parse(EffectiveSettingSchema, roundTrip(setting)).ok).toBe(true);
    const locked = {
      ...setting,
      locked: true,
      lockReason: "managed_policy",
      problem: { kind: "unknownModel", args: { id: "gone-1", count: 2, ok: false, none: null } },
    };
    expect(parsed(EffectiveSettingSchema, locked)).toEqual(locked);
    expect(parse(EffectiveSettingSchema, { ...locked, lockReason: "other" }).ok).toBe(false);
    expect(parse(EffectiveSettingSchema, { ...locked, problem: { kind: "Bad Kind" } }).ok).toBe(
      false,
    );
  });

  test("toValueJsonSchema merges range into the wire type and agrees with the value check", () => {
    const def = intDef({ range: { min: 1, max: 5 } });
    const wire = toSettingDefWire(def);
    const schema = toValueJsonSchema(wire);
    expect(schema["minimum"]).toBe(1);
    expect(schema["maximum"]).toBe(5);
    expect(schema["type"]).toBe("integer");
    const withEnum = toValueJsonSchema({ ...wire, range: { enum: ["a", "b"] } });
    expect(withEnum["enum"]).toEqual(["a", "b"]);
    expect(validateSettingValue(def, 6).ok).toBe(false);
    expect(validateSettingValue(def, 3).ok).toBe(true);
  });
});

describe("secret entry meta (M3-REQ-17)", () => {
  test("beginEntry carries optional value-free meta", () => {
    const params = WIRE_METHODS["secret.beginEntry"].params;
    const meta = {
      desc: "GitHub token",
      scope: "user",
      expiresAt: "2027-01-01",
      use: { modes: ["env"], tools: ["bash:gh"], hosts: [] },
      approval: "per-session",
      ttlSeconds: 600,
      maxUses: 10,
    };
    const full = { name: "github-token", action: "add", meta };
    expect(parsed(params, full)).toEqual(full);
    expect(parsed(params, { name: "github-token", action: "add" })).toEqual({
      name: "github-token",
      action: "add",
    });
    expect(parse(SecretEntryMetaSchema, { ...meta, value: "x" }).ok).toBe(false);
    expect(parse(SecretEntryMetaSchema, { ttlSeconds: 0 }).ok).toBe(false);
  });
});
