import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import {
  ToolsPortKey,
  type ToolRegisterError,
  type ToolResourceDef,
  type ToolsPort,
} from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import { hostOf, PrimitiveError } from "../../src/primitives/index.ts";
import { createResourcePolicy, NO_RESERVED_NAMES } from "../../src/operations/naming.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

// F.capabilities.spec §10 [결정: 2026-11-03 사용자] X 쪽: 선언한 이름만 대체 등록이 되고 이름 정책을 거치지 않는다.

type Host = Awaited<ReturnType<typeof createTestHost>>;

/** `read`를 내장 도구로 가진 fresnel.tools 대역. 대체 등록은 두 번째부터 replace_conflict다 */
async function withToolsPort(t: Host): Promise<Map<string, ToolResourceDef[]>> {
  const registered = new Map<string, ToolResourceDef[]>();
  const port: ToolsPort = {
    register(_owner, def) {
      const list = registered.get(def.name) ?? [];
      if (def.replaces === undefined && list.length > 0) {
        const error: ToolRegisterError = { kind: "name_conflict", toolName: def.name };
        return err(error);
      }
      if (def.replaces !== undefined && list.some((other) => other.replaces !== undefined)) {
        return err({ kind: "replace_conflict", toolName: def.name, existing: "someone" });
      }
      registered.set(def.name, [...list, def]);
      return ok(() => {
        registered.set(
          def.name,
          (registered.get(def.name) ?? []).filter((other) => other !== def),
        );
      });
    },
  };
  await t.host.registerPlatform({
    name: "test-tools-port",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, port);
    },
  });
  registered.set("read", [
    {
      name: "read",
      description: "built-in",
      parameters: Type.Object({}),
      replay: "safe",
      execute: () => Promise.resolve("builtin"),
    },
  ]);
  return registered;
}

function def(name: string): ToolResourceDef {
  return {
    name,
    description: name,
    parameters: Type.Object({}),
    replay: "safe",
    execute: () => Promise.resolve(name),
  };
}

function codeOf(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof PrimitiveError ? error.code : "other";
  }
  return undefined;
}

test("a declared name reaches the tools port with the claim and keeps its short name", async () => {
  const t = await createTestHost({ resourcePolicy: createResourcePolicy(NO_RESERVED_NAMES) });
  const registered = await withToolsPort(t);
  await t.host.install(
    makeUnit(
      {
        name: "acme-files",
        builtin: false,
        replaces: ["read"],
        trust: { level: "project" },
        loadedTrust: "project",
      },
      (g) => {
        hostOf(g).registerTool({ ...def("read"), risk: "exec" });
      },
    ),
  );
  const added = registered.get("read")?.at(-1);
  expect(added?.name).toBe("read");
  expect(added?.replaces).toEqual({ extension: "acme-files", trust: "project" });
  expect(t.host.resources.list("tool")).toMatchObject([
    { name: "read", exposed: "read", extension: "acme-files" },
  ]);
});

test("the claim carries the loaded trust, not the manifest request, and a unit without one is untrusted", async () => {
  const t = await createTestHost({ resourcePolicy: createResourcePolicy(NO_RESERVED_NAMES) });
  const registered = await withToolsPort(t);
  registered.delete("read");
  await t.host.install(
    makeUnit({ name: "plain-user", builtin: false, replaces: ["ls"], loadedTrust: "user" }, (g) => {
      hostOf(g).registerTool(def("ls"));
    }),
  );
  await t.host.install(
    makeUnit({ name: "core-grep", builtin: true, replaces: ["grep"] }, (g) => {
      hostOf(g).registerTool(def("grep"));
    }),
  );
  // 로더 없이 설치한 외부 단위는 등급을 모르므로 가장 낮은 untrusted다. 요청 값은 이 경로에서 쓰지 않는다
  await t.host.install(
    makeUnit(
      {
        name: "unlabelled",
        builtin: false,
        replaces: ["cat"],
        trust: { level: "user" },
        loadIndex: 2,
      },
      (g) => {
        hostOf(g).registerTool(def("cat"));
      },
    ),
  );
  expect(registered.get("ls")?.[0]?.replaces).toEqual({ extension: "plain-user", trust: "user" });
  expect(registered.get("grep")?.[0]?.replaces).toEqual({
    extension: "core-grep",
    trust: "builtin",
  });
  expect(registered.get("cat")?.[0]?.replaces).toEqual({
    extension: "unlabelled",
    trust: "untrusted",
  });
});

test("the same name without a manifest declaration is not a replacement and the built-in stays", async () => {
  const t = await createTestHost({ resourcePolicy: createResourcePolicy(NO_RESERVED_NAMES) });
  const registered = await withToolsPort(t);
  const codes: (string | undefined)[] = [];
  await t.host.install(
    makeUnit({ name: "careless", builtin: false, replaces: ["ls"] }, (g) => {
      // `read`는 선언에 없다
      codes.push(codeOf(() => hostOf(g).registerTool(def("read"))));
    }),
  );
  expect(codes).toEqual(["resource_conflict"]);
  expect(registered.get("read")?.map((entry) => entry.description)).toEqual(["built-in"]);
  expect(registered.get("read")?.some((entry) => entry.replaces !== undefined)).toBe(false);
});

test("a second extension replacing the same tool is a resource_conflict and the first stays", async () => {
  const t = await createTestHost({ resourcePolicy: createResourcePolicy(NO_RESERVED_NAMES) });
  const registered = await withToolsPort(t);
  const codes: (string | undefined)[] = [];
  await t.host.install(
    makeUnit({ name: "first-files", builtin: false, replaces: ["read"] }, (g) => {
      codes.push(codeOf(() => hostOf(g).registerTool(def("read"))));
    }),
  );
  await t.host.install(
    makeUnit({ name: "second-files", builtin: false, replaces: ["read"], loadIndex: 1 }, (g) => {
      codes.push(codeOf(() => hostOf(g).registerTool(def("read"))));
    }),
  );
  expect(codes).toEqual([undefined, "resource_conflict"]);
  expect(t.host.resources.list("tool").map((record) => record.extension)).toEqual(["first-files"]);
  expect(registered.get("read")?.filter((entry) => entry.replaces !== undefined)).toHaveLength(1);
});

test("a replacement does not rename or capture other extensions' tools of the same name", async () => {
  const t = await createTestHost({ resourcePolicy: createResourcePolicy(NO_RESERVED_NAMES) });
  await withToolsPort(t);
  await t.host.install(
    makeUnit({ name: "other-ext", builtin: false }, (g) => {
      hostOf(g).registerTool(def("lookup"));
    }),
  );
  await t.host.install(
    makeUnit({ name: "acme-files", builtin: false, replaces: ["read"], loadIndex: 1 }, (g) => {
      hostOf(g).registerTool(def("read"));
    }),
  );
  expect(
    t.host.resources
      .list("tool")
      .map((record) => `${record.extension}:${record.exposed}`)
      .toSorted(),
  ).toEqual(["acme-files:read", "other-ext:lookup"]);
});
