import { CapabilityError } from "@xeon/contracts/capabilities";
import type { CallContext, CallOptions } from "@xeon/contracts/capabilities";
import type { Tree } from "../../src/skills/tree.ts";
import { treeOf } from "../../src/skills/tree.ts";

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
