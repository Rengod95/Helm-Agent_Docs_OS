import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import {
  affectedKeys,
  invalidationConcerns,
  type SettingsInvalidation,
} from "../../src/settings/index.ts";

// 변경 알림의 대상 판정(invalidation.ts). 알림 값은 없고, 대화와 상관있는지와 다시 읽을 키만 정한다.

function threadOf(name: string): ThreadId {
  const parsed = parse(ThreadIdSchema, `thr_01HZX0000000000000000000${name}`);
  if (!parsed.ok) throw new Error("test thread id must parse");
  return parsed.value;
}

const THREAD_A = threadOf("AA");
const THREAD_B = threadOf("BB");

function notice(
  scopes: SettingsInvalidation["scopes"],
  threadId: ThreadId | null,
  keys: readonly string[] = ["l1.models.default"],
): SettingsInvalidation {
  return { keys: [...keys], scopes: [...scopes], threadId };
}

describe("invalidationConcerns: the open conversation", () => {
  test("a user, project, local, or managed change concerns the conversation with or without a thread", () => {
    expect(invalidationConcerns(notice(["user"], null), null)).toBe(true);
    expect(invalidationConcerns(notice(["project"], null), THREAD_A)).toBe(true);
    expect(invalidationConcerns(notice(["local"], null), null)).toBe(true);
    expect(invalidationConcerns(notice(["managed"], null), THREAD_B)).toBe(true);
  });

  test("a launch change of another thread does not concern the open conversation", () => {
    expect(invalidationConcerns(notice(["launch"], THREAD_B), THREAD_A)).toBe(false);
  });

  test("a launch change of the open thread concerns it", () => {
    expect(invalidationConcerns(notice(["launch"], THREAD_A), THREAD_A)).toBe(true);
  });

  test("a launch change with no open thread does not concern anything", () => {
    expect(invalidationConcerns(notice(["launch"], THREAD_B), null)).toBe(false);
  });

  test("a launch change with no thread id is read again, since its thread is unknown", () => {
    expect(invalidationConcerns(notice(["launch"], null), THREAD_A)).toBe(true);
    expect(invalidationConcerns(notice(["launch"], null), null)).toBe(true);
  });

  test("a notice with a global scope and a launch scope of another thread still concerns the conversation", () => {
    expect(invalidationConcerns(notice(["launch", "user"], THREAD_B), THREAD_A)).toBe(true);
  });
});

describe("affectedKeys: which keys to read again", () => {
  const catalog = new Map([
    ["l1.models.zeta", 1],
    ["l1.models.alpha", 2],
  ]);

  test("listed keys are read as given", () => {
    expect(affectedKeys(["l1.models.zeta"], catalog)).toEqual(["l1.models.zeta"]);
  });

  test("empty keys mean every catalog key, sorted", () => {
    expect(affectedKeys([], catalog)).toEqual(["l1.models.alpha", "l1.models.zeta"]);
  });
});
