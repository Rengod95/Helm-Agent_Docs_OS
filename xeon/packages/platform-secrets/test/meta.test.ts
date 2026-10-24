import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { createMetaStore } from "../src/meta.ts";
import { rawMeta } from "./support/meta.ts";
import { nameOf } from "./support/names.ts";
import { tempDir, type TempDir } from "./support/os.ts";

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

async function metaDir(): Promise<TempDir> {
  const dir = await tempDir();
  dirs.push(dir);
  return dir;
}

const YAML_META = `name: github-token
desc: GitHub personal token for tests
provider: sops
ref: dev/GITHUB_TOKEN
scope: user
expiresAt: 2026-12-31
use:
  modes: [env, runtime-http]
  tools: ["bash:gh", "http.request"]
  hosts: [api.github.com]
  commands: ["gh api *"]
approval: per-use
ttlSeconds: 600
maxUses: 20
`;

describe("meta files (spec §3.2)", () => {
  test("reads a YAML meta file", async () => {
    const dir = await metaDir();
    await writeFile(dir.join("github-token.yaml"), YAML_META);
    const store = createMetaStore(dir.path);
    const entry = await store.get(nameOf("github-token"));
    expect(entry?.kind).toBe("ok");
    if (entry?.kind === "ok") {
      expect(entry.meta.expiresAt).toBe("2026-12-31");
      expect(entry.meta.use.commands).toEqual(["gh api *"]);
      expect(entry.meta.approval).toBe("per-use");
      expect(entry.meta.use.origins).toBeUndefined();
    }
    expect(await store.get(nameOf("absent-one"))).toBeNull();
  });

  test("validates schema and isolates invalid file", async () => {
    const dir = await metaDir();
    await writeFile(dir.join("github-token.yaml"), YAML_META);
    await writeFile(dir.join("bad-schema.yaml"), "name: bad-schema\ndesc: x\n");
    await writeFile(dir.join("broken-yaml.yaml"), "name: [unclosed\n");
    await writeFile(
      dir.join("renamed-one.yaml"),
      JSON.stringify(rawMeta({ name: "something-else" })),
    );
    await writeFile(dir.join("Bad_Name.yaml"), YAML_META);
    await writeFile(dir.join("notes.txt"), "ignored");
    await writeFile(
      dir.join("extra-field.yaml"),
      JSON.stringify({ ...rawMeta({ name: "extra-field" }), surprise: 1 }),
    );

    const entries = await createMetaStore(dir.path).list();
    const byName = new Map(
      entries.map((e) => [e.kind === "ok" ? e.name : e.error.name, e] as const),
    );
    expect([...byName.keys()].toSorted()).toEqual([
      "Bad_Name",
      "bad-schema",
      "broken-yaml",
      "extra-field",
      "github-token",
      "renamed-one",
    ]);
    expect(byName.get("github-token")?.kind).toBe("ok");
    for (const bad of ["Bad_Name", "bad-schema", "broken-yaml", "extra-field", "renamed-one"]) {
      const entry = byName.get(bad);
      expect(entry?.kind).toBe("invalid");
      if (entry?.kind === "invalid") {
        expect(entry.error.kind).toBe("meta_invalid");
        expect(entry.error.path).toBe(dir.join(`${bad}.yaml`));
        expect(entry.error.errors.length).toBeGreaterThan(0);
      }
    }
  });

  test("a missing directory is an empty list", async () => {
    const dir = await metaDir();
    expect(await createMetaStore(dir.join("nope")).list()).toEqual([]);
  });

  test("error details never include file contents", async () => {
    const dir = await metaDir();
    await mkdir(dir.path, { recursive: true });
    await writeFile(dir.join("leaky-one.yaml"), "name: leaky-one\nsecretish: hunter2hunter2\n");
    const [entry] = await createMetaStore(dir.path).list();
    expect(JSON.stringify(entry)).not.toContain("hunter2hunter2");
  });
});
