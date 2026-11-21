import { describe, expect, test } from "bun:test";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";
import type { WorkspaceDeps } from "../src/deps.ts";
import { createProtectApi, type ProtectPathsStore } from "../src/protect/api.ts";
import { createFilesApi } from "../src/service.ts";
import { rejection } from "./support/assertions.ts";
import { depsFor, fakeSandbox } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

// [제안, AGE-63] 대화에서 `sandbox_protect`로 더한 경로는 같은 대화의 다음 파일 도구 호출부터 읽기와 쓰기가 막힌다.
// 설정 저장소 대역에 쓴 값을 샌드박스의 보호 목록이 읽고, 파일 도구는 호출마다 그 목록을 본다(L0.sandbox.spec §3.3.1).

/** 샌드박스 대역의 비교 키: 이 시험은 절대 경로만 쓴다 */
function absoluteKey(value: string): string | undefined {
  return value.startsWith("/") ? value : undefined;
}

describe("sandbox_protect then the file tools (same thread, next call)", () => {
  test("a folder protected by the tool is refused for read and write on the next file call; other files stay readable", async () => {
    const env = memoryEnv({ cwd: "/work" });
    env.mkdir("/work");
    env.put("/work/vault/secret.txt", "secret\n");
    env.put("/work/open.txt", "open\n");

    // 설정 저장소 대역: 쓴 값이 샌드박스의 사용자 항목이 된다
    const values: string[] = [];
    const store: ProtectPathsStore = {
      current: () => [...values],
      add: (more) => {
        values.push(...more);
        return Promise.resolve({ ok: true, value: [...values] });
      },
    };
    const entries = (): readonly ProtectedPathEntry[] =>
      values.flatMap((value): ProtectedPathEntry[] => {
        const key = absoluteKey(value);
        return key === undefined
          ? []
          : [{ path: key, match: "prefix", access: "read_write", reason: "user_extra" }];
      });
    const sandbox = {
      ...fakeSandbox(),
      protectedPathKey: absoluteKey,
      protectedPaths: entries,
      suggestedProtectedPaths: () => [],
    };
    const base = depsFor(env, { sandbox });
    const deps: WorkspaceDeps = {
      ...base,
      roots: { ...base.roots, protectedPaths: () => entries() },
    };
    const files = createFilesApi(deps);
    const protect = createProtectApi({ sandbox, store });

    expect(await files.read({ path: "vault/secret.txt" })).toMatchObject({
      kind: "text",
      text: "secret\n",
    });

    const out = await protect.protect({ paths: ["/work/vault"] });
    expect(out.added).toEqual(["/work/vault"]);

    const read = await rejection(files.read({ path: "vault/secret.txt" }));
    expect(read.data.code).toBe("denied");
    expect(read.data.detail).toMatchObject({ reason: "protected_path", protectedBy: "user_extra" });
    const write = await rejection(files.write({ path: "vault/new.txt", content: "x" }));
    expect(write.data.code).toBe("denied");
    expect(write.data.detail).toMatchObject({
      reason: "protected_path",
      protectedBy: "user_extra",
    });

    expect(await files.read({ path: "open.txt" })).toMatchObject({ kind: "text", text: "open\n" });
  });
});
