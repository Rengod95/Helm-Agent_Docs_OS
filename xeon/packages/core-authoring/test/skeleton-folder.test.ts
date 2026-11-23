import { afterAll, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@fresnel/contracts";
import type { DevkitError } from "@fresnel/contracts/services";
import { isSkeletonFolder, locateTemplateDirs, scaffoldExtension } from "../src/index.ts";

// 뼈대만 있는 폴더를 가려낸다(U-05). 뼈대는 검사를 통과하므로 `authoring_trial`이 이 판정으로 막는다.

const templates = locateTemplateDirs({}, undefined);
if (templates === null) throw new Error("core-authoring templates are missing");
const root = await mkdtemp(join(tmpdir(), "core-authoring-skeleton-"));
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function must<T>(result: Result<T, DevkitError>): T {
  if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

test("a folder left as the hook skeleton is a skeleton", async () => {
  const dir = join(root, "left-hook");
  must(await scaffoldExtension({ kind: "single-plugin", name: "left-hook", dir }, { templates }));
  expect(
    must(await isSkeletonFolder({ kind: "single-plugin", name: "left-hook", dir }, { templates })),
  ).toBe(true);
});

test("the purpose and the description do not count: a skeleton written with them is still a skeleton", async () => {
  const dir = join(root, "left-app");
  must(
    await scaffoldExtension(
      {
        kind: "single-plugin",
        name: "left-app",
        dir,
        mode: "app",
        purpose: "Keeps a short list.",
        description: "Keeps a short list.",
      },
      { templates },
    ),
  );
  expect(
    must(await isSkeletonFolder({ kind: "single-plugin", name: "left-app", dir }, { templates })),
  ).toBe(true);
});

test("one edited file makes the folder not a skeleton, and the edit is kept", async () => {
  const dir = join(root, "edited");
  const made = must(
    await scaffoldExtension(
      { kind: "single-plugin", name: "edited", dir, mode: "hook" },
      { templates },
    ),
  );
  const source = made.files.find((file) => file.startsWith("src/"));
  if (source === undefined) throw new Error("the hook skeleton has no source file");
  writeFileSync(join(dir, source), "// the requested feature\n");
  expect(
    must(await isSkeletonFolder({ kind: "single-plugin", name: "edited", dir }, { templates })),
  ).toBe(false);
});

test("an empty folder and a missing folder are not skeletons", async () => {
  const empty = join(root, "empty");
  await mkdir(empty);
  const emptyFound = must(
    await isSkeletonFolder({ kind: "single-plugin", name: "empty", dir: empty }, { templates }),
  );
  expect(emptyFound).toBe(false);
  const missingFound = must(
    await isSkeletonFolder(
      { kind: "single-plugin", name: "missing", dir: join(root, "missing") },
      { templates },
    ),
  );
  expect(missingFound).toBe(false);
});

test("a relative folder is refused as invalid input", async () => {
  const refused = await isSkeletonFolder(
    { kind: "single-plugin", name: "rel", dir: "relative/folder" },
    { templates },
  );
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect(refused.error.kind).toBe("invalid_input");
});
