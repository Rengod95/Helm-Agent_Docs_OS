import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { extractArgument, formatOfPath, parseSopsKeys } from "../src/providers/sops-keys.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

async function listing(name: string) {
  const content = await Bun.file(join(FIXTURES, name)).text();
  return parseSopsKeys(content, formatOfPath(name));
}

describe("sops key listing without decrypt (spec §4.6 2번)", () => {
  test("lists keys without decrypt", async () => {
    const yaml = await listing("sample.sops.yaml");
    expect(yaml.ok && yaml.value.keys).toEqual(["GITHUB_TOKEN", "nested.inner.deep_key"]);
    expect(yaml.ok && yaml.value.lastModified).toBe(Date.parse("2026-01-04T10:00:00Z"));

    const json = await listing("sample.sops.json");
    expect(json.ok && json.value.keys).toEqual(["API_KEY", "group.SECRET_ONE"]);
    expect(json.ok && json.value.lastModified).toBe(Date.parse("2026-01-03T00:00:00Z"));

    const env = await listing("sample.sops.env");
    expect(env.ok && env.value.keys).toEqual(["GITHUB_TOKEN"]);
    expect(env.ok && env.value.lastModified).toBe(Date.parse("2026-01-02T00:00:00Z"));
  });

  test("skips the sops block, plain values, arrays and keys with unsafe characters", async () => {
    const yaml = await listing("sample.sops.yaml");
    const keys = yaml.ok ? yaml.value.keys : [];
    expect(keys.some((k) => k.startsWith("sops"))).toBe(false);
    expect(keys).not.toContain("plain_note");
    expect(keys).not.toContain("bad.key");
    expect(keys.some((k) => k.includes("items"))).toBe(false);
  });

  test("reports unparseable files", () => {
    expect(parseSopsKeys("{ not json", "json")).toEqual({
      ok: false,
      error: { kind: "unparseable" },
    });
    expect(parseSopsKeys("- a\n- b\n", "yaml").ok).toBe(false);
    expect(parseSopsKeys("a: [", "yaml").ok).toBe(false);
  });

  test("picks the format from the file name", () => {
    expect(formatOfPath("/x/secrets.json")).toBe("json");
    expect(formatOfPath("/x/.env")).toBe("dotenv");
    expect(formatOfPath("/x/prod.env")).toBe("dotenv");
    expect(formatOfPath("/x/.env.production")).toBe("dotenv");
    expect(formatOfPath("/x/dev.sops.yaml")).toBe("yaml");
    expect(formatOfPath("/x/dev.sops.yml")).toBe("yaml");
  });

  test("extract arguments are built per key path segment and refuse odd characters", () => {
    expect(extractArgument("GITHUB_TOKEN")).toEqual({ ok: true, value: '["GITHUB_TOKEN"]' });
    expect(extractArgument("a.b-c.d_e")).toEqual({ ok: true, value: '["a"]["b-c"]["d_e"]' });
    for (const bad of ['a"]["b', "a b", "", "a..b", "a]"]) {
      expect(extractArgument(bad).ok).toBe(false);
    }
  });
});
