import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { ToolsPortKey, type ToolResourceDef, type ToolsPort } from "@xeon/contracts/extensions";
import { Type } from "typebox";
import {
  createResourcePolicy,
  NO_RESERVED_NAMES,
  qualifiedName,
  resolveNames,
  type NamedResourceKind,
  type ReservedNames,
  type ResolvedName,
  type ResourceClaim,
} from "../../src/operations/index.ts";
import { hostOf, PrimitiveError } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

const RESERVED: ReservedNames = {
  ...NO_RESERVED_NAMES,
  tool: new Set(["read", "bash"]),
  command: new Set(["help"]),
};

function claim(
  owner: string,
  name: string,
  options: { readonly kind?: NamedResourceKind; readonly builtin?: boolean } = {},
): ResourceClaim {
  return { kind: options.kind ?? "tool", owner, name, builtin: options.builtin ?? false };
}

function show(r: ResolvedName): string {
  return `${r.claim.kind}:${r.claim.owner}:${r.claim.name}=${r.exposed}${r.reason === undefined ? "" : `#${r.reason}`}`;
}

/** 모든 순열 */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, index) => {
    const others = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const rest of permutations(others)) out.push([item, ...rest]);
  });
  return out;
}

function table(claims: readonly ResourceClaim[]): string[] {
  return resolveNames(claims, RESERVED).map(show).toSorted();
}

test("naming: qualified names", () => {
  expect(qualifiedName("tool", "notes", "pin")).toBe("notes__pin");
  expect(qualifiedName("command", "notes", "pin")).toBe("notes:pin");
  expect(qualifiedName("shortcut", "notes", "ctrl+p")).toBe("notes:ctrl+p");
  expect(qualifiedName("flag", "notes", "dry")).toBe("notes:dry");
});

test("naming: conflicts expose qualified names regardless of order", () => {
  const claims = [
    claim("ext-a", "pin"),
    claim("ext-b", "pin"),
    claim("ext-c", "unique"),
    claim("ext-a", "pin", { kind: "command" }),
  ];
  const expected = table(claims);
  expect(expected).toEqual([
    "command:ext-a:pin=pin",
    "tool:ext-a:pin=ext-a__pin#conflict",
    "tool:ext-b:pin=ext-b__pin#conflict",
    "tool:ext-c:unique=unique",
  ]);
  for (const order of permutations(claims)) expect(table(order)).toEqual(expected);
});

test("naming: reserved and builtin names stay short only for builtin packages", () => {
  const claims = [
    claim("ext-a", "read"),
    claim("core-tools", "bash", { builtin: true }),
    claim("ext-b", "bash"),
    claim("ext-c", "help", { kind: "command" }),
    claim("ext-d", "fetch", { builtin: true }),
    claim("ext-e", "fetch"),
  ];
  expect(table(claims)).toEqual([
    "command:ext-c:help=ext-c:help#reserved",
    "tool:core-tools:bash=bash",
    "tool:ext-a:read=ext-a__read#reserved",
    "tool:ext-b:bash=ext-b__bash#reserved",
    "tool:ext-d:fetch=fetch",
    "tool:ext-e:fetch=ext-e__fetch#reserved",
  ]);
  // 내장 둘이 같은 이름을 쓰면 둘 다 정식 이름이다
  expect(
    table([claim("core-a", "dup", { builtin: true }), claim("core-b", "dup", { builtin: true })]),
  ).toEqual(["tool:core-a:dup=core-a__dup#conflict", "tool:core-b:dup=core-b__dup#conflict"]);
});

test("naming: a tool whose qualified name exceeds 64 characters is too_long", () => {
  const long = "x".repeat(60);
  expect(table([claim("ext-a", long)])).toEqual([`tool:ext-a:${long}=ext-a__${long}#too_long`]);
  expect(table([claim("ext-a", long, { kind: "command" })])).toEqual([
    `command:ext-a:${long}=${long}`,
  ]);
});

function record(extension: string, kind: "tool" | "provider", name: string) {
  return { kind, name, exposed: name, scopeId: extension, extension, builtin: false, def: null };
}

test("naming: the pair policy renames the incoming side and rejects what it cannot name", () => {
  const policy = createResourcePolicy(RESERVED);
  expect(policy.resolve(record("b", "tool", "pin"), record("a", "tool", "pin"))).toEqual({
    action: "rename",
    name: "b__pin",
  });
  expect(policy.resolve(record("a", "tool", "pin"), record("a", "tool", "pin"))).toEqual({
    action: "reject",
  });
  expect(policy.resolve(record("b", "provider", "x"), record("a", "provider", "x"))).toEqual({
    action: "reject",
  });
});

async function harnessWithTools() {
  const harness = await createOperationsHarness({ reservedNames: RESERVED });
  const tools = new Map<string, ToolResourceDef>();
  const log: string[] = [];
  const port: ToolsPort = {
    register(owner, def) {
      if (tools.has(def.name)) return err({ kind: "name_conflict", toolName: def.name });
      tools.set(def.name, def);
      log.push(`+${def.name}@${owner}`);
      return ok(() => {
        tools.delete(def.name);
        log.push(`-${def.name}`);
      });
    },
  };
  await harness.t.host.registerPlatform({
    name: "test-tools",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, port);
    },
  });
  await harness.t.host.openThread(harness.t.newThread());
  return { ...harness, tools, log };
}

function tool(name: string): ToolResourceDef {
  return {
    name,
    description: name,
    parameters: Type.Object({}),
    replay: "safe",
    execute: () => Promise.resolve(name),
  };
}

test("naming: registry exposes both names of a clash whatever the install order, and the survivor regains the short name", async () => {
  await eachInOrder(
    [
      ["nm-a", "nm-b"],
      ["nm-b", "nm-a"],
    ] as const,
    async (order) => {
      const { t, tools } = await harnessWithTools();
      await eachInOrder(order.entries(), async ([index, name]) => {
        await t.host.install(
          makeUnit({ name, loadIndex: index, builtin: false }, (g) => {
            hostOf(g).registerTool(tool("pin"));
            hostOf(g).registerCommand("pin", { handler: () => Promise.resolve() });
          }),
        );
        return "continue";
      });
      expect([...tools.keys()].toSorted()).toEqual(["nm-a__pin", "nm-b__pin"]);
      expect(
        t.host.resources
          .list("command")
          .map((r) => r.exposed)
          .toSorted(),
      ).toEqual(["nm-a:pin", "nm-b:pin"]);

      // 한쪽을 끄면 남은 쪽이 짧은 이름을 받는다
      t.host.scope("nm-a")?.disable();
      await t.settled();
      expect([...tools.keys()]).toEqual(["pin"]);
      expect(t.host.resources.list("command").map((r) => r.exposed)).toEqual(["pin"]);
      return "continue";
    },
  );
});

test("naming: an external tool cannot take a reserved name and a too long tool is rejected", async () => {
  const { t, tools } = await harnessWithTools();
  const codes: (string | undefined)[] = [];
  await t.host.install(
    makeUnit({ name: "nm-ext", builtin: false }, (g) => {
      hostOf(g).registerTool(tool("read"));
      try {
        hostOf(g).registerTool(tool("y".repeat(58)));
        codes.push(undefined);
      } catch (error) {
        codes.push(error instanceof PrimitiveError ? error.code : "other");
      }
    }),
  );
  expect([...tools.keys()]).toEqual(["nm-ext__read"]);
  expect(codes).toEqual(["resource_name_invalid"]);
});

test("naming: a builtin tool keeps the short name and an external one that clashes is qualified", async () => {
  const { t, tools, log } = await harnessWithTools();
  await t.host.install(
    makeUnit({ name: "nm-ext2", loadIndex: 1, builtin: false }, (g) => {
      hostOf(g).registerTool(tool("search"));
    }),
  );
  expect([...tools.keys()]).toEqual(["search"]);
  await t.host.install(
    makeUnit({ name: "core-search", loadIndex: 0, builtin: true }, (g) => {
      hostOf(g).registerTool(tool("search"));
    }),
  );
  // 내장이 들어오면 먼저 들어온 외부 도구가 정식 이름으로 다시 등록된다
  expect([...tools.keys()].toSorted()).toEqual(["nm-ext2__search", "search"]);
  expect(log).toEqual([
    "+search@nm-ext2",
    "-search",
    "+nm-ext2__search@nm-ext2",
    "+search@core-search",
  ]);
});
