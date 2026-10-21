import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  ASSISTANT_EVENT_TYPES,
  AssistantMessageEventSchema,
  CONTENT_BLOCK_TYPES,
  MESSAGE_ROLES,
  MessageSchema,
  STOP_REASONS,
  StopReasonSchema,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Message,
  type StopReason,
} from "../../src/conversation/index.ts";
import type { Equal, Expect } from "../types/expect.ts";
import { assistantStop } from "./fixtures/pi-messages.ts";

// 목록이 pi 유니온과 정확히 같음을 컴파일 시점에 확인한다(양방향).
export type RolesComplete = Expect<Equal<(typeof MESSAGE_ROLES)[number], Message["role"]>>;
export type StopReasonsComplete = Expect<Equal<(typeof STOP_REASONS)[number], StopReason>>;
export type EventTypesComplete = Expect<
  Equal<(typeof ASSISTANT_EVENT_TYPES)[number], AssistantMessageEvent["type"]>
>;
export type BlockTypesComplete = Expect<
  Equal<(typeof CONTENT_BLOCK_TYPES)[number], AssistantMessage["content"][number]["type"] | "image">
>;

describe("discriminant lists", () => {
  test("have the expected sizes", () => {
    expect(MESSAGE_ROLES.length).toBe(4);
    expect(CONTENT_BLOCK_TYPES.length).toBe(4);
    expect(STOP_REASONS.length).toBe(7);
    expect(ASSISTANT_EVENT_TYPES.length).toBe(12);
  });

  test("every stop reason passes the schema, outside values fail", () => {
    for (const reason of STOP_REASONS) expect(parse(StopReasonSchema, reason).ok).toBe(true);
    expect(parse(StopReasonSchema, "other").ok).toBe(false);
  });

  test("every assistant event type passes, outside values fail", () => {
    for (const type of ASSISTANT_EVENT_TYPES) {
      expect(parse(AssistantMessageEventSchema, { type }).ok).toBe(true);
    }
    expect(parse(AssistantMessageEventSchema, { type: "other" }).ok).toBe(false);
  });

  test("a role outside the list fails the message schema", () => {
    for (const role of MESSAGE_ROLES) expect(role.length).toBeGreaterThan(0);
    expect(parse(MessageSchema, { ...assistantStop, role: "developer" }).ok).toBe(false);
  });
});
