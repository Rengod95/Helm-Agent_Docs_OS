import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { WireError, type ExtUiEntry, type ExtVersionEntry } from "@fresnel/contracts/wire";
import type { ExtUiRefusal } from "@fresnel/ext-host";
import type { ExtUiVersionPort } from "../../src/handlers/m4/ext-ui-version.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// T-XV 처리기(HS-108). 포트가 돌려준 값은 와이어 결과로 그대로 나가고, 포트의 실패 값은 정해진 와이어 오류가 된다.
// 시험은 가짜 엔진의 연결로 부른다. 처리기 표를 거치므로 오류는 JSON-RPC 모양 그대로 비교한다.

const VERSION: ExtVersionEntry = {
  version: "0.1.0",
  installedAt: "2026-11-01T00:00:01.000Z",
  source: "bundled",
  manifestHash: "hash",
  stateSchemaVersion: null,
  current: false,
};

const UI_ITEM: ExtUiEntry = {
  extension: "helm",
  version: "0.2.0",
  trust: "user",
  id: "panel",
  placement: "panel",
  mode: "native",
  title: "Helm",
  state: "ok",
  issues: [],
};

function portWith(parts: Partial<ExtUiVersionPort>): ExtUiVersionPort {
  return {
    versions: () => Promise.resolve(ok({ versions: [] })),
    rollback: () => Promise.resolve(ok({ appliesAt: "nextStepBoundary", stateCleared: false })),
    uiList: () => ({ items: [] }),
    uiPost: () => Promise.resolve(ok({ accepted: true })),
    uiRequestApproval: () => Promise.resolve(ok({ approvalId: "evt_1" })),
    ...parts,
  };
}

/** 던져진 값에서 JSON-RPC 오류의 모양만 꺼낸다. WireError가 아니면 시험이 실패한다 */
function wireOf(caught: unknown): { code: number; message: string; data: unknown } {
  if (!(caught instanceof WireError))
    throw new Error(`expected a WireError, got ${String(caught)}`);
  return { code: caught.code, message: caught.message, data: caught.data };
}

test("ext.versions returns the port's list as the wire result", async () => {
  const host = createFakeHost({
    extUi: portWith({ versions: () => Promise.resolve(ok({ versions: [VERSION] })) }),
  });
  const { connection } = host.connect();
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    expect(await connection.request("ext.versions", { name: "helm" })).toEqual({
      versions: [VERSION],
    });
  } finally {
    await connection.close();
  }
});

test("ext.ui.list returns the port's items as the wire result", async () => {
  const host = createFakeHost({ extUi: portWith({ uiList: () => ({ items: [UI_ITEM] }) }) });
  const { connection } = host.connect();
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    expect(await connection.request("ext.ui.list", {})).toEqual({ items: [UI_ITEM] });
  } finally {
    await connection.close();
  }
});

test("an unknown extension is -32602 at /name with the stable kind prefix", async () => {
  const host = createFakeHost({
    extUi: portWith({
      versions: () => Promise.resolve(err({ kind: "unknown_extension", name: "ghost" })),
    }),
  });
  const { connection } = host.connect();
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const caught = await rejectionOf(connection.request("ext.versions", { name: "ghost" }));
    expect(wireOf(caught)).toEqual({
      code: -32602,
      message: "jsonrpc.invalidParams",
      data: {
        kind: "jsonrpc.invalidParams",
        retryable: false,
        details: { issues: [{ path: "/name", message: "unknown_extension: ghost" }] },
      },
    });
  } finally {
    await connection.close();
  }
});

test("ext.rollback is refused with review_required and never reaches the port: a rollback goes through review", async () => {
  const calls: string[] = [];
  const host = createFakeHost({
    extUi: portWith({
      rollback: () => {
        calls.push("rollback");
        return Promise.resolve(ok({ appliesAt: "restart", stateCleared: true }));
      },
    }),
  });
  const { connection } = host.connect();
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const caught = await rejectionOf(
      connection.request("ext.rollback", { name: "helm", version: "0.1.0", clearState: true }),
    );
    expect(wireOf(caught)).toEqual({
      code: -32602,
      message: "jsonrpc.invalidParams",
      data: {
        kind: "jsonrpc.invalidParams",
        retryable: false,
        details: {
          issues: [
            {
              path: "/name",
              message:
                "review_required: rolling back helm to 0.1.0 goes through review; call pluginReview.requestRollback",
            },
          ],
        },
      },
    });
    expect(calls).toEqual([]);
  } finally {
    await connection.close();
  }
});

test("a storage failure is store.io with the OS code in details", async () => {
  const host = createFakeHost({
    extUi: portWith({
      versions: () => Promise.resolve(err({ kind: "io", code: "EACCES" })),
    }),
  });
  const { connection } = host.connect();
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const caught = await rejectionOf(connection.request("ext.versions", { name: "helm" }));
    expect(wireOf(caught)).toEqual({
      code: 5006,
      message: "io: EACCES",
      data: { kind: "store.io", retryable: false, details: { code: "EACCES" } },
    });
  } finally {
    await connection.close();
  }
});

test("host.hello features list all five methods", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  try {
    const hello = await connection.request("host.hello", HELLO_PARAMS);
    const featured = hello.features.map((feature) => feature.name);
    for (const name of [
      "ext.versions",
      "ext.rollback",
      "ext.ui.list",
      "ext.ui.post",
      "ext.ui.requestApproval",
    ]) {
      expect(featured).toContain(name);
    }
  } finally {
    await connection.close();
  }
});

const THREAD = "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const POST = { extension: "helm", ui: "panel", threadId: THREAD, name: "open" };
const ASK = { extension: "helm", ui: "panel", threadId: THREAD, method: "apply" };

test("ext.ui.post and ext.ui.requestApproval return the port's values", async () => {
  const seen: unknown[] = [];
  const host = createFakeHost({
    extUi: portWith({
      uiPost: (params) => {
        seen.push(params);
        return Promise.resolve(ok({ accepted: true }));
      },
      uiRequestApproval: (params) => {
        seen.push(params);
        return Promise.resolve(ok({ approvalId: "evt_9" }));
      },
    }),
  });
  const { connection } = host.connect();
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    expect(await connection.request("ext.ui.post", POST)).toEqual({ accepted: true });
    expect(await connection.request("ext.ui.requestApproval", ASK)).toEqual({
      approvalId: "evt_9",
    });
    expect(seen).toEqual([POST, ASK]);
  } finally {
    await connection.close();
  }
});

const REFUSALS: readonly [ExtUiRefusal, number, string][] = [
  [{ kind: "unknown_thread", threadId: THREAD }, 3001, "thread.notFound"],
  [{ kind: "thread_closed", threadId: THREAD }, 3001, "thread.notFound"],
  [{ kind: "unknown_extension", extension: "helm" }, 3401, "extension.notFound"],
  [{ kind: "extension_off", extension: "helm" }, 10002, "ext.helm.off"],
  [{ kind: "ui_not_declared", ui: "panel" }, -32602, "jsonrpc.invalidParams"],
  [{ kind: "method_not_declared", method: "apply" }, -32602, "jsonrpc.invalidParams"],
  [{ kind: "post_not_allowed", extension: "helm" }, -32602, "jsonrpc.invalidParams"],
  [{ kind: "name_invalid", name: "Bad" }, -32602, "jsonrpc.invalidParams"],
  [{ kind: "payload_invalid" }, -32602, "jsonrpc.invalidParams"],
  [{ kind: "key_reused", requestId: "r" }, -32602, "jsonrpc.invalidParams"],
  [{ kind: "port_unavailable", port: "approvals" }, -32603, "internal"],
  [{ kind: "storage", reason: "io" }, -32603, "internal"],
];
for (const [refusal, code, kind] of REFUSALS) {
  test(`ext.ui.post and ext.ui.requestApproval map ${refusal.kind} to ${kind}`, async () => {
    const host = createFakeHost({
      extUi: portWith({
        uiPost: () => Promise.resolve(err(refusal)),
        uiRequestApproval: () => Promise.resolve(err(refusal)),
      }),
    });
    const { connection } = host.connect();
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const post = wireOf(await rejectionOf(connection.request("ext.ui.post", POST)));
      const ask = wireOf(await rejectionOf(connection.request("ext.ui.requestApproval", ASK)));
      expect(post).toMatchObject({ code, data: { kind } });
      expect(ask).toMatchObject({ code, data: { kind } });
    } finally {
      await connection.close();
    }
  });
}
