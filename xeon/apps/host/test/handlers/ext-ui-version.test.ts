import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { WireError, type ExtUiEntry, type ExtVersionEntry } from "@fresnel/contracts/wire";
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

test("ext.rollback returns the port's result as the wire result", async () => {
  const host = createFakeHost({
    extUi: portWith({
      rollback: () => Promise.resolve(ok({ appliesAt: "restart", stateCleared: true })),
    }),
  });
  const { connection } = host.connect();
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    expect(
      await connection.request("ext.rollback", {
        name: "helm",
        version: "0.1.0",
        clearState: true,
      }),
    ).toEqual({ appliesAt: "restart", stateCleared: true });
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

test("an unknown version is -32602 at /version", async () => {
  const host = createFakeHost({
    extUi: portWith({
      rollback: () => Promise.resolve(err({ kind: "unknown_version", version: "0.9.0" })),
    }),
  });
  const { connection } = host.connect();
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const caught = await rejectionOf(
      connection.request("ext.rollback", { name: "helm", version: "0.9.0" }),
    );
    expect(wireOf(caught)).toEqual({
      code: -32602,
      message: "jsonrpc.invalidParams",
      data: {
        kind: "jsonrpc.invalidParams",
        retryable: false,
        details: { issues: [{ path: "/version", message: "unknown_version: 0.9.0" }] },
      },
    });
  } finally {
    await connection.close();
  }
});

test("a state schema mismatch is -32602 at /clearState and names both schema numbers", async () => {
  const host = createFakeHost({
    extUi: portWith({
      rollback: () =>
        Promise.resolve(
          err({ kind: "state_schema_mismatch", targetSchemaVersion: 1, currentSchemaVersion: 2 }),
        ),
    }),
  });
  const { connection } = host.connect();
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const caught = await rejectionOf(
      connection.request("ext.rollback", { name: "helm", version: "0.1.0" }),
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
              path: "/clearState",
              message: "state_schema_mismatch: target 1, current 2",
            },
          ],
        },
      },
    });
  } finally {
    await connection.close();
  }
});

test("a history that is not kept for the extension is -32602 at /name with the reason", async () => {
  const host = createFakeHost({
    extUi: portWith({
      rollback: () =>
        Promise.resolve(
          err({ kind: "history_unavailable", reason: "builtin extension has no version history" }),
        ),
    }),
  });
  const { connection } = host.connect();
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const caught = await rejectionOf(
      connection.request("ext.rollback", { name: "core-tools", version: "0.1.0" }),
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
              message: "history_unavailable: builtin extension has no version history",
            },
          ],
        },
      },
    });
  } finally {
    await connection.close();
  }
});

test("a rollback that stopped midway is an internal error that carries the reason", async () => {
  const reason = "swap_failed at place (restored true, reenabled false)";
  const host = createFakeHost({
    extUi: portWith({
      rollback: () => Promise.resolve(err({ kind: "rollback_failed", reason })),
    }),
  });
  const { connection } = host.connect();
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const caught = await rejectionOf(
      connection.request("ext.rollback", { name: "helm", version: "0.1.0" }),
    );
    expect(wireOf(caught)).toEqual({
      code: -32603,
      message: `rollback_failed: ${reason}`,
      data: { kind: "internal", retryable: true },
    });
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

test("host.hello features list the three filled methods; ext.ui.post and ext.ui.requestApproval stay notImplemented", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  try {
    const hello = await connection.request("host.hello", HELLO_PARAMS);
    const featured = hello.features.map((feature) => feature.name);
    for (const name of ["ext.versions", "ext.rollback", "ext.ui.list"]) {
      expect(featured).toContain(name);
    }
    expect(featured).not.toContain("ext.ui.post");
    expect(featured).not.toContain("ext.ui.requestApproval");
    const caught = await rejectionOf(
      connection.request("ext.ui.post", { extension: "helm", ui: "panel", name: "open" }),
    );
    expect(wireOf(caught)).toMatchObject({
      code: -32601,
      data: { details: { method: "ext.ui.post" } },
    });
  } finally {
    await connection.close();
  }
});
