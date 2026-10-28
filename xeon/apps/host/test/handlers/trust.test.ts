import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { WireError, type WireParams, type WireResult } from "@xeon/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// trust.get, trust.decide(F wire §3.3.1, HS-58). 가짜 엔진 위의 실제 처리기다. 실제 신뢰 저장소 위의 시험은
// test/assembly/trust.test.ts와 test/int/trust.int.test.ts다.

const STATUS: WireResult<"trust.get"> = {
  projectRoot: "/work/app",
  required: true,
  verdict: "undecided",
  via: "headless",
  resources: [".mcp.json"],
  options: [
    { choice: { kind: "folder", verdict: "allow" }, label: "trust-folder", savedPath: "/work/app" },
    { choice: { kind: "session", verdict: "allow" }, label: "trust-session", savedPath: null },
  ],
};

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

test("trust.get returns what the port found and passes the workspace on", async () => {
  const asked: string[] = [];
  const host = createFakeHost({
    overrides: {
      trust: {
        get: (workspace) => {
          asked.push(workspace);
          return Promise.resolve(ok(STATUS));
        },
      },
    },
  });
  const connection = await open(host);
  expect(await connection.request("trust.get", { workspace: "/work/app" })).toEqual(STATUS);
  expect(asked).toEqual(["/work/app"]);
  await connection.close();
});

test("trust.decide passes the choice on and returns the status after the decision", async () => {
  const decided: WireParams<"trust.decide">[] = [];
  const after: WireResult<"trust.decide"> = { ...STATUS, verdict: "allow", via: "store" };
  const host = createFakeHost({
    overrides: {
      trust: {
        decide: (workspace, choice) => {
          decided.push({ workspace, choice });
          return Promise.resolve(ok(after));
        },
      },
    },
  });
  const connection = await open(host);
  const params: WireParams<"trust.decide"> = {
    workspace: "/work/app",
    choice: { kind: "folder", verdict: "allow" },
  };
  expect(await connection.request("trust.decide", params)).toEqual(after);
  expect(decided).toEqual([params]);
  await connection.close();
});

test("trust failures become wire errors: bad workspace and bad choice are invalid params, a failed store is store.io", async () => {
  const host = createFakeHost({
    overrides: {
      trust: {
        get: () => Promise.resolve(err({ kind: "workspace_not_absolute" })),
        decide: (_workspace, choice) =>
          Promise.resolve(
            choice.kind === "parent"
              ? err({ kind: "invalid_choice" })
              : err({ kind: "store_failed", reason: "corrupt" }),
          ),
      },
    },
  });
  const connection = await open(host);
  const relative = await wireErrorOf(connection.request("trust.get", { workspace: "app" }));
  expect(relative.data.kind).toBe("jsonrpc.invalidParams");
  expect(relative.data.details).toEqual({
    issues: [{ path: "workspace", message: "workspace must be an absolute path" }],
  });
  const unknown = await wireErrorOf(
    connection.request("trust.decide", {
      workspace: "/work/app",
      choice: { kind: "parent", verdict: "allow" },
    }),
  );
  expect(unknown.data.kind).toBe("jsonrpc.invalidParams");
  expect(JSON.stringify(unknown.data.details)).toContain("choice");
  const broken = await wireErrorOf(
    connection.request("trust.decide", {
      workspace: "/work/app",
      choice: { kind: "folder", verdict: "deny" },
    }),
  );
  expect(broken.data.kind).toBe("store.io");
  expect(broken.data.details).toEqual({ code: "trust_store" });
  await connection.close();
});
