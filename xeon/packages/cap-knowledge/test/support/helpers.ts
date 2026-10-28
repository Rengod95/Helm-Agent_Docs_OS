import { parse } from "@xeon/contracts";
import { CapabilityError } from "@xeon/contracts/capabilities";
import { ThreadIdSchema, type ThreadId } from "@xeon/contracts/conversation";
import type { CallContext, CallOptions } from "@xeon/contracts/capabilities";
import type { Tree } from "../../src/skills/tree.ts";
import { treeOf } from "../../src/skills/tree.ts";
import { idemOf, type Idem } from "../../src/write/idempotency.ts";

/** 거부를 기다려 CapabilityError를 돌려준다. 거부하지 않거나 다른 값으로 거부하면 시험이 실패한다 */
export async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Error("expected the call to reject with a CapabilityError");
}

const encoder = new TextEncoder();

export function treeFrom(files: Readonly<Record<string, string>>): Tree {
  return treeOf(
    Object.entries(files).map(([path, text]) => ({ path, bytes: encoder.encode(text) })),
  );
}

const HOST: CallContext = { caller: { kind: "host" } };
export const MODEL: CallContext = { caller: { kind: "model", agent: "main" } };

export function asHost(options: CallOptions = {}): CallOptions {
  return { ...options, context: HOST };
}

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 시험용 ThreadId. n이 다르면 다른 ID */
export function threadIdOf(n: number = 1): ThreadId {
  const digits: string[] = [];
  let rest = n;
  for (let i = 0; i < 6; i += 1) {
    digits.unshift(ALPHABET[rest % 32] ?? "0");
    rest = Math.floor(rest / 32);
  }
  const parsed = parse(ThreadIdSchema, `thr_01ARZ3NDEKTSV4RRFFQ5${digits.join("")}`);
  if (!parsed.ok) throw new Error("invalid test thread id");
  return parsed.value;
}

/** 시험용 멱등 키. 대화 없이 메서드 `test`와 빈 입력으로 만든다 */
export function idem(raw: string): Idem {
  const made = idemOf(raw, undefined, "test", null);
  if (made === undefined) throw new Error("the idempotency key needs a requestId");
  return made;
}
