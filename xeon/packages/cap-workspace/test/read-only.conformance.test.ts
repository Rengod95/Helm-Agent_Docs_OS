import { describe, expect, test } from "bun:test";
import { WorkspaceFiles, WorkspaceImages, WorkspaceShell } from "@xeon/contracts/capabilities";
import { createFilesApi, createWorkspaceService } from "../src/service.ts";
import { depsFor } from "./support/fakes.ts";
import { memoryBlobs, pngBytes } from "./support/images.ts";
import { memoryEnv } from "./support/memory-env.ts";

// M3-REQ-88·89, ADR-0015 §3.6: readOnly 메서드는 작업 공간 파일에 효과를 남기지 않는다.
// workspace에는 멱등 쓰기가 없다. 선언 없는 메서드(files.write·edit, images.register, shell.run)는 replay unsafe다.

function classes(
  def: typeof WorkspaceFiles | typeof WorkspaceImages | typeof WorkspaceShell,
): readonly string[] {
  return Object.entries(def.service.methods).map(([name, method]) => {
    const effect =
      method.readOnly === true ? "readOnly" : method.idempotent === true ? "idempotent" : "none";
    return `${def.id}.${name} ${effect} ${method.replay ?? "unsafe"}`;
  });
}

describe("workspace readOnly conformance", () => {
  test("the declared classes are the reads and the undeclared writes", () => {
    expect(
      [WorkspaceFiles, WorkspaceImages, WorkspaceShell].flatMap((def) => classes(def)),
    ).toEqual([
      "workspace.files.read readOnly safe",
      "workspace.files.write none unsafe",
      "workspace.files.edit none unsafe",
      "workspace.files.list readOnly safe",
      "workspace.files.grep readOnly safe",
      "workspace.files.find readOnly safe",
      "workspace.images.load readOnly safe",
      "workspace.images.resize readOnly safe",
      "workspace.images.register none unsafe",
      "workspace.shell.run none unsafe",
    ]);
  });

  test("read, list and images.load leave every file as it was", async () => {
    const env = memoryEnv({ cwd: "/work" });
    env.mkdir("/work");
    env.put("/work/a.txt", "alpha\nbeta\n");
    env.put("/work/pics/a.png", pngBytes(4, 3, 64));
    const blobs = memoryBlobs();
    const deps = depsFor(env, { blobs });
    const files = createFilesApi(deps);
    const service = createWorkspaceService(deps);
    const snapshot = async (): Promise<unknown> => {
      const text = await files.read({ path: "a.txt" });
      const listing = await files.list({});
      const pics = await files.list({ path: "pics" });
      return [text, listing, pics];
    };
    const before = await snapshot();
    const callsBefore = env.calls.length;

    await files.read({ path: "a.txt" });
    await files.list({});
    await service.images.load({ path: "pics/a.png" });
    await files.read({ path: "a.txt" });
    await files.list({});
    await service.images.load({ path: "pics/a.png" });

    expect(await snapshot()).toEqual(before);
    expect(env.calls.length).toBe(callsBefore);
  });
});
