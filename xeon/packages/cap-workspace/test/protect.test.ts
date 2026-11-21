import { describe, expect, test } from "bun:test";
import { posix } from "node:path";
import { err, ok, type Result } from "@fresnel/contracts";
import { CapabilityError } from "@fresnel/contracts/capabilities";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";
import {
  createProtectApi,
  UNAVAILABLE_PROTECT_STORE,
  type ProtectApiDeps,
  type ProtectPathsStore,
  type ProtectPathsWriteFailure,
  type ProtectSandbox,
} from "../src/protect/api.ts";
import { rejection } from "./support/assertions.ts";

// [제안, AGE-63] 기능 `workspace.protection`의 구현 단위 시험. 샌드박스와 설정 저장소는 대역이다(홈은 /home/u).

const HOME = "/home/u";

/** 샌드박스 대역의 비교 키 규칙: `~`는 홈, 절대 경로는 그대로(실제 경로 풀이는 L0 시험이 본다), 그 밖은 없다 */
function keyOf(value: string): string | undefined {
  if (value === "~") return HOME;
  if (value.startsWith("~/"))
    return posix.normalize(`${HOME}/${value.slice(2)}`).replace(/\/$/, "");
  if (!value.startsWith("/")) return undefined;
  const normalized = posix.normalize(value);
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

/** 사용자 범위 extra에 든 값이 샌드박스에서 보이는 항목 하나 */
function userEntry(path: string): ProtectedPathEntry {
  return { path, match: "prefix", access: "read_write", reason: "user_extra" };
}

function fakeSandbox(entries: readonly ProtectedPathEntry[] = []): ProtectSandbox {
  return {
    protectedPathKey: keyOf,
    protectedPaths: () => entries,
    suggestedProtectedPaths: () => [
      { path: "~/.ssh", label: "SSH keys", key: `${HOME}/.ssh` },
      { path: "~/vault", label: "Vault", key: `${HOME}/vault` },
    ],
  };
}

interface MemoryStore extends ProtectPathsStore {
  /** `add`가 받은 값 묶음을 호출 순서대로 */
  readonly calls: string[][];
  readonly values: string[];
}

function memoryStore(
  initial: readonly string[] = [],
  failure?: ProtectPathsWriteFailure,
): MemoryStore {
  const values = [...initial];
  const calls: string[][] = [];
  return {
    values,
    calls,
    current: () => [...values],
    add: (more): Promise<Result<readonly string[], ProtectPathsWriteFailure>> => {
      calls.push([...more]);
      if (failure !== undefined) return Promise.resolve(err(failure));
      values.push(...more);
      return Promise.resolve(ok([...values]));
    },
  };
}

function apiOf(store: ProtectPathsStore, entries: readonly ProtectedPathEntry[] = []) {
  const deps: ProtectApiDeps = { sandbox: fakeSandbox(entries), store };
  return createProtectApi(deps);
}

describe("sandbox_protect: adding paths", () => {
  test("adds the paths in their stored form and returns the full list and the timing", async () => {
    const store = memoryStore(["~/old"]);
    const api = apiOf(store);
    const out = await api.protect({ paths: ["~/vault/", "/abs/x"] });
    expect(out).toEqual({
      added: ["~/vault", "/abs/x"],
      alreadyProtected: [],
      protected: ["~/old", "~/vault", "/abs/x"],
      effective: "next_shell_or_file_call",
    });
    expect(store.calls).toEqual([["~/vault", "/abs/x"]]);
  });

  test("a path already protected is kept as it is, under any spelling that resolves to the same path", async () => {
    const store = memoryStore(["~/vault"]);
    const api = apiOf(store);
    const out = await api.protect({ paths: ["~/vault/", `${HOME}/vault`] });
    expect(out).toEqual({
      added: [],
      alreadyProtected: ["~/vault", `${HOME}/vault`],
      protected: ["~/vault"],
      effective: "next_shell_or_file_call",
    });
    // 더할 것이 없으면 설정 저장소를 부르지 않는다
    expect(store.calls).toEqual([]);
  });

  test("calling again with the same path keeps one entry", async () => {
    const store = memoryStore();
    const api = apiOf(store);
    await api.protect({ paths: ["~/vault"] });
    const second = await api.protect({ paths: ["~/vault"] });
    expect(second.added).toEqual([]);
    expect(second.alreadyProtected).toEqual(["~/vault"]);
    expect(store.values).toEqual(["~/vault"]);
    expect(store.calls).toHaveLength(1);
  });

  test("a path repeated in one call is added once", async () => {
    const store = memoryStore();
    const out = await apiOf(store).protect({ paths: ["/a/b", "/a/b/"] });
    expect(out.added).toEqual(["/a/b"]);
    expect(out.alreadyProtected).toEqual(["/a/b"]);
    expect(store.values).toEqual(["/a/b"]);
  });
});

describe("sandbox_protect: refused input writes nothing", () => {
  const cases: readonly { readonly path: string; readonly reason: string }[] = [
    { path: "relative/x", reason: "relative" },
    { path: "./x", reason: "relative" },
    { path: "~user/x", reason: "relative" },
    { path: "/", reason: "root" },
    { path: "//", reason: "root" },
    { path: "~", reason: "home" },
    { path: "~/", reason: "home" },
    { path: "/home", reason: "contains_home" },
  ];

  for (const { path, reason } of cases) {
    test(`${JSON.stringify(path)} is refused as ${reason}, and the valid path in the same call is not written`, async () => {
      const store = memoryStore();
      const error = await rejection(apiOf(store).protect({ paths: ["/ok/fine", path] }));
      expect(error).toBeInstanceOf(CapabilityError);
      expect(error.data.code).toBe("invalid_input");
      expect(error.data.detail).toEqual({ issues: [{ index: 1, reason }] });
      expect(store.calls).toEqual([]);
      expect(store.values).toEqual([]);
    });
  }

  test("every bad path is reported with its position, and the message names no path", async () => {
    const error = await rejection(apiOf(memoryStore()).protect({ paths: ["x", "/", "/ok"] }));
    expect(error.data.detail).toEqual({
      issues: [
        { index: 0, reason: "relative" },
        { index: 1, reason: "root" },
      ],
    });
    expect(error.data.message).not.toContain("/ok");
    expect(error.data.message).not.toContain("x,");
  });
});

describe("sandbox_protect: writing failures", () => {
  test("no settings store is unavailable and nothing is protected", async () => {
    const error = await rejection(apiOf(UNAVAILABLE_PROTECT_STORE).protect({ paths: ["~/vault"] }));
    expect(error.data.code).toBe("unavailable");
  });

  test("a managed lock is reported as locked", async () => {
    const error = await rejection(
      apiOf(memoryStore([], { kind: "locked" })).protect({ paths: ["~/vault"] }),
    );
    expect(error.data.code).toBe("locked");
    expect(error.data.retryable).toBe(false);
  });

  test("a value the setting check refuses is invalid input", async () => {
    const error = await rejection(
      apiOf(memoryStore([], { kind: "invalid_value" })).protect({ paths: ["~/vault"] }),
    );
    expect(error.data.code).toBe("invalid_input");
  });

  test("a failed file write carries only the failure code", async () => {
    const error = await rejection(
      apiOf(memoryStore([], { kind: "store_failed", code: "EACCES" })).protect({
        paths: ["~/vault"],
      }),
    );
    expect(error.data.code).toBe("store_failed");
    expect(error.data.detail).toEqual({ code: "EACCES" });
  });

  test("without a sandbox both methods are unavailable", async () => {
    const api = createProtectApi({ sandbox: undefined, store: memoryStore() });
    expect((await rejection(api.protect({ paths: ["~/vault"] }))).data.code).toBe("unavailable");
    expect((await rejection(api.list({}))).data.code).toBe("unavailable");
  });

  test("an aborted call does not write", async () => {
    const store = memoryStore();
    const controller = new AbortController();
    controller.abort();
    const error = await rejection(
      apiOf(store).protect({ paths: ["~/vault"] }, { signal: controller.signal }),
    );
    expect(error.data.code).toBe("aborted");
    expect(store.calls).toEqual([]);
  });
});

describe("sandbox_protected: the list", () => {
  test("blocked holds the user's paths and Fresnel's own fixed read-and-write paths, and suggestions say which are in extra", async () => {
    const entries: ProtectedPathEntry[] = [
      { path: `${HOME}/vault`, match: "prefix", access: "read_write", reason: "user_extra" },
      {
        path: `${HOME}/.local/share/fresnel`,
        match: "prefix",
        access: "read_write",
        reason: "fresnel_data",
      },
      { path: `${HOME}/.config/sops`, match: "prefix", access: "read_write", reason: "secret_key" },
      // 쓰기만 막힌 기본 자격 폴더와 Fresnel 설정 폴더는 blocked에 없다
      { path: `${HOME}/.ssh`, match: "prefix", access: "write", reason: "credentials" },
      {
        path: `${HOME}/.config/fresnel`,
        match: "prefix",
        access: "write",
        reason: "fresnel_config",
      },
    ];
    const list = await apiOf(memoryStore(), entries).list({});
    expect(list.blocked).toEqual([
      { path: "~/vault", origin: "user" },
      { path: "~/.local/share/fresnel", origin: "fixed" },
      { path: "~/.config/sops", origin: "fixed" },
    ]);
    expect(list.suggested).toEqual([
      { path: "~/.ssh", label: "SSH keys", blocked: false },
      { path: "~/vault", label: "Vault", blocked: true },
    ]);
  });

  test("a path added by sandbox_protect shows as blocked in the list (the sandbox reports it as a user entry)", async () => {
    const store = memoryStore();
    const api = apiOf(store);
    await api.protect({ paths: ["~/vault"] });
    const entries = store.values.map((value) => userEntry(`${HOME}/${value.slice(2)}`));
    const list = await apiOf(store, entries).list({});
    expect(list.blocked).toEqual([{ path: "~/vault", origin: "user" }]);
    expect(list.suggested.find((row) => row.path === "~/vault")?.blocked).toBe(true);
  });
});
