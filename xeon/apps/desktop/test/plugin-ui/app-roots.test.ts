import { describe, expect, test } from "bun:test";
import {
  APP_ROOT_ERROR_KINDS,
  appRootInputs,
  syncAppRoots,
  type AppRootsInvoke,
} from "../../src/plugin-ui/app-roots.ts";
import { APP_DECL, APP_ROOT, appEntryOf, uiEntryOf } from "./support.ts";

/** Tauri는 Rust가 준 값(대개 문자열)으로 거절한다. 이유는 `unknown`으로 받아 그 값을 그대로 흉내 낸다 */
function rejectingWith(reason: unknown): ReturnType<typeof recorder> {
  return recorder(async () => {
    throw reason;
  });
}

function recorder(reply: () => Promise<unknown>): {
  readonly invoke: AppRootsInvoke;
  readonly calls: { readonly command: string; readonly args: unknown }[];
} {
  const calls: { command: string; args: unknown }[] = [];
  const invoke: AppRootsInvoke = (command, args) => {
    calls.push({ command, args });
    return reply();
  };
  return { invoke, calls };
}

describe("appRootInputs", () => {
  test("only ok app entries outside the builtin tier become roots", () => {
    const entries = [
      uiEntryOf({ id: "native" }),
      appEntryOf({ id: "app-user", trust: "user" }),
      appEntryOf({ id: "app-builtin", trust: "builtin" }),
      appEntryOf({ id: "app-invalid", state: "invalid" }),
      appEntryOf({ id: "app-disabled", state: "disabled" }),
      uiEntryOf({ id: "app-no-root", mode: "app", app: APP_DECL }),
      uiEntryOf({ id: "app-no-decl", mode: "app", appRoot: APP_ROOT }),
    ];
    expect(appRootInputs(entries)).toEqual([
      {
        extension: "helm",
        version: "0.1.0",
        root: "/home/u/.fresnel/extensions/helm/ui/graph",
        entry: "index.html",
        trust: "user",
      },
    ]);
  });

  test("the trust tier maps one to one for user, project and managed", () => {
    const roots = appRootInputs([
      appEntryOf({ id: "a", trust: "user" }),
      appEntryOf({ id: "b", trust: "project" }),
      appEntryOf({ id: "c", trust: "managed" }),
    ]);
    expect(roots.map((root) => root.trust)).toEqual(["user", "project", "managed"]);
  });

  test("the root and entry come from the entry's appRoot and app declaration, in input order", () => {
    const roots = appRootInputs([
      appEntryOf({ id: "z", extension: "zeta", trust: "project", appRoot: "/r/zeta" }),
      appEntryOf({ id: "a", extension: "alpha", trust: "user", appRoot: "/r/alpha" }),
    ]);
    expect(roots.map((root) => [root.extension, root.root])).toEqual([
      ["zeta", "/r/zeta"],
      ["alpha", "/r/alpha"],
    ]);
  });
});

describe("syncAppRoots", () => {
  test("calls app_roots_set exactly once with the filtered list and succeeds", async () => {
    const fake = recorder(() => Promise.resolve(null));
    const result = await syncAppRoots(fake.invoke, [uiEntryOf(), appEntryOf({ trust: "project" })]);
    expect(result).toEqual({ ok: true, value: null });
    expect(fake.calls).toEqual([
      {
        command: "app_roots_set",
        args: {
          entries: [
            {
              extension: "helm",
              version: "0.1.0",
              root: "/home/u/.fresnel/extensions/helm/ui/graph",
              entry: "index.html",
              trust: "project",
            },
          ],
        },
      },
    ]);
  });

  test("an empty list still calls the command, so a cleared list replaces the old one", async () => {
    const fake = recorder(() => Promise.resolve(null));
    expect(await syncAppRoots(fake.invoke, [])).toEqual({ ok: true, value: null });
    expect(fake.calls).toEqual([{ command: "app_roots_set", args: { entries: [] } }]);
  });

  test("each known rejection string becomes its kind", async () => {
    const kinds = [
      "too_many",
      "bad_name",
      "bad_version",
      "bad_entry",
      "not_absolute",
      "not_a_directory",
      "too_broad",
      "outside_install",
    ] as const;
    // 목록은 Rust `RootsError`의 거부 이름과 같아야 한다(view_scheme.rs)
    expect([...APP_ROOT_ERROR_KINDS]).toEqual([...kinds]);
    const results = await Promise.all(
      kinds.map((kind) => syncAppRoots(rejectingWith(kind).invoke, [appEntryOf()])),
    );
    expect(results).toEqual(kinds.map((kind) => ({ ok: false, error: { kind } })));
  });

  test("an unknown rejection text is mapped to unknown and its words are not kept", async () => {
    const result = await syncAppRoots(
      rejectingWith("failed to parse C:\\Users\\secret/path").invoke,
      [appEntryOf()],
    );
    expect(result).toEqual({ ok: false, error: { kind: "unknown" } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("a thrown Error or a non-string rejection is unknown and never throws", async () => {
    const thrown = recorder(() => Promise.reject(new Error("ipc gone")));
    expect(await syncAppRoots(thrown.invoke, [])).toEqual({
      ok: false,
      error: { kind: "unknown" },
    });
    const object = rejectingWith({ kind: "outside_install" });
    expect(await syncAppRoots(object.invoke, [])).toEqual({
      ok: false,
      error: { kind: "unknown" },
    });
  });
});
