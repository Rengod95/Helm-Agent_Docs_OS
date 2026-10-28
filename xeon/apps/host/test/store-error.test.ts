import { expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { LifecycleError } from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import {
  keyReusedBug,
  wireErrorOfCreate,
  wireErrorOfLease,
  wireErrorOfLifecycle,
  wireErrorOfStore,
} from "../src/store-error.ts";

// key_reused를 Bug로 판정하는 자리는 keyReusedBug 하나다. 수명 주기와 생성이 같은 값을 돌려준다.

const REUSED = { kind: "key_reused", requestKey: "evt_1" } as const;

function bugOf(value: unknown): Bug {
  if (!(value instanceof Bug)) throw new Error("expected a Bug");
  return value;
}

test("keyReusedBug names the call and carries the store error as the cause", () => {
  const bug = keyReusedBug(REUSED, "settings.write");
  expect(bug.message).toBe("settings.write: the host builds a fresh request key per call");
  expect(bug.cause).toEqual(REUSED);
});

test("a key_reused from a lifecycle call or from create is the same Bug", () => {
  const lifecycle = bugOf(wireErrorOfLifecycle(REUSED, "thread.fork"));
  const create = bugOf(wireErrorOfCreate(REUSED, "thread.create"));
  expect(lifecycle.message).toBe("thread.fork: the host builds a fresh request key per call");
  expect(lifecycle.cause).toEqual(REUSED);
  expect(create.message).toBe("thread.create: the host builds a fresh request key per call");
  expect(create.cause).toEqual(REUSED);
});

test("the other lifecycle variants that create cannot produce stay Bugs with their own message", () => {
  const impossible: LifecycleError = { kind: "has_forks", forks: [] };
  expect(bugOf(wireErrorOfCreate(impossible, "thread.create")).message).toBe(
    "thread.create: lifecycle error has_forks cannot come from create",
  );
});

function wireOf(value: unknown): { readonly kind: string; readonly details: unknown } {
  if (value instanceof Bug) throw new Error("expected a wire error");
  if (typeof value !== "object" || value === null || !("data" in value)) {
    throw new Error("expected a wire error");
  }
  const data: unknown = value.data;
  if (typeof data !== "object" || data === null || !("kind" in data) || !("details" in data)) {
    throw new Error("expected wire error data");
  }
  const { kind, details } = data;
  if (typeof kind !== "string") throw new Error("expected a kind");
  return { kind, details };
}

test("a stored row that does not match the schema is store.corrupt with the place, not store.io", () => {
  const error = wireOf(wireErrorOfStore({ kind: "row_invalid", where: "events.envelope" }, "x"));
  expect(error).toEqual({ kind: "store.corrupt", details: { where: "events.envelope" } });
  const lease = wireOf(wireErrorOfLease({ kind: "row_invalid", where: "sys_leases.holder" }, "x"));
  expect(lease).toEqual({ kind: "store.corrupt", details: { where: "sys_leases.holder" } });
});

test("a long place name is cut to the wire limit of 128 characters", () => {
  const error = wireOf(wireErrorOfStore({ kind: "row_invalid", where: "w".repeat(300) }, "x"));
  expect(error.details).toEqual({ where: "w".repeat(128) });
});

test("a write to a closed thread is thread.closed with the thread id, not thread.notFound", () => {
  const thread = fixedIdFactory(740).next("thr");
  const error = wireOf(wireErrorOfLifecycle({ kind: "thread_closed", threadId: thread }, "x"));
  expect(error).toEqual({ kind: "thread.closed", details: { threadId: thread } });
});
