import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  locateTemplateDirs,
  packExtension,
  scaffoldExtension,
  type TemplateDirs,
} from "../src/index.ts";

// 검토본 저장소의 설치본은 읽기 전용이다(파일 0444, 폴더 0555). 그 폴더를 묶어도 복사본은 쓸 수 있어야 하고, 매니페스트와 번들을 덮어쓸 수 있어야 한다(AGE-76 verFix).

const templates: TemplateDirs | null = locateTemplateDirs({});
let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pack-readonly-"));
});

afterAll(async () => {
  await makeWritable(root);
  await rm(root, { recursive: true, force: true });
});

/** 폴더 밑의 모든 항목에 모드를 건다(폴더는 `dirMode`, 파일은 `fileMode`) */
async function setModes(dir: string, dirMode: number, fileMode: number): Promise<void> {
  const listed = await readdir(dir, { recursive: true });
  await Promise.all(
    listed.map(async (rel) => {
      const path = join(dir, rel);
      await chmod(path, (await stat(path)).isDirectory() ? dirMode : fileMode);
    }),
  );
  await chmod(dir, dirMode);
}

async function makeWritable(dir: string): Promise<void> {
  await chmod(dir, 0o755).catch(() => undefined);
  await setModes(dir, 0o755, 0o644).catch(() => undefined);
}

test("a read-only installed folder packs into a writable folder whose manifest points at the bundle", async () => {
  if (templates === null) throw new Error("the plugin templates are missing in the source tree");
  const dir = join(root, "packro");
  const made = await scaffoldExtension(
    {
      kind: "single-plugin",
      name: "packro",
      dir,
      mode: "app",
      purpose: "Keeps a short list.",
      description: "Keeps a short list that the user and the agent can both add to.",
    },
    { templates },
  );
  expect(made.ok ? null : made.error).toBeNull();
  await setModes(dir, 0o555, 0o444);

  const out = join(root, "out");
  const packed = await packExtension({ dir, out });
  expect(packed.ok).toBe(true);
  if (!packed.ok) return;
  const manifest = JSON.parse(await readFile(join(out, ".fresnel-plugin", "plugin.json"), "utf8"));
  expect(manifest.entry).toBe("./dist/index.js");
  expect(((await stat(join(out, "dist", "index.js"))).mode & 0o200) !== 0).toBe(true);
  expect(((await stat(join(out, ".fresnel-plugin", "plugin.json"))).mode & 0o200) !== 0).toBe(true);
});
