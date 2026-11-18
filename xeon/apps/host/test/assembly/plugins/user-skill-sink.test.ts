import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { err, ok, parse, type Logger, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, TurnIdSchema } from "@fresnel/contracts/conversation";
import type { ReviewDecision } from "@fresnel/contracts/wire";
import type { UserSkillSubmission } from "@fresnel/cap-knowledge";
import type { AdmitResult, IntakeRequest } from "../../../src/assembly/plugins/intake.ts";
import { createUserSkillSink } from "../../../src/assembly/plugins/user-skill-sink.ts";
import type { PluginPortFailure } from "../../../src/handlers/m5/plugins.ts";

// L2.knowledge §7.5 [제안]: 사용자 범위 스킬 만들기의 검토 싱크(L4). 입구는 스킬 폴더 하나(SKILL.md와 최소 매니페스트)를 받고,
// 사람이 이미 승인한 만들기만 같은 호출에서 공통 묶음에 든 승인으로 바꾼다. 임시 폴더는 입구가 쓴 뒤에 지운다.

const threadParsed = parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ5000001");
if (!threadParsed.ok) throw new Error("invalid test thread id");
const THREAD = threadParsed.value;
const turnParsed = parse(TurnIdSchema, "trn_01ARZ3NDEKTSV4RRFFQ5000007");
if (!turnParsed.ok) throw new Error("invalid test turn id");
const TURN = turnParsed.value;
const SKILL_MD =
  '---\nname: release-notes\ndescription: "Use when writing release notes."\n---\n\n# Notes\n';

const LOG: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => LOG,
};

interface Seen {
  readonly submits: { readonly request: IntakeRequest; readonly files: Record<string, string> }[];
  readonly decides: { readonly itemId: string; readonly decision: ReviewDecision }[];
  readonly events: string[];
}

/** 입구와 승인의 가짜. 입구가 받은 폴더의 내용을 호출 때 읽어 둔다(싱크가 지운 뒤에는 읽을 수 없다) */
function fakes(
  options: {
    readonly submit?: (request: IntakeRequest) => Result<AdmitResult, PluginPortFailure>;
    readonly decide?: () => Result<unknown, PluginPortFailure>;
  } = {},
): {
  readonly seen: Seen;
  readonly intake: {
    submit: (request: IntakeRequest) => Promise<Result<AdmitResult, PluginPortFailure>>;
  };
  readonly decide: (
    itemId: string,
    decision: ReviewDecision,
  ) => Promise<Result<unknown, PluginPortFailure>>;
} {
  const seen: Seen = { submits: [], decides: [], events: [] };
  return {
    seen,
    intake: {
      submit: (request) => {
        const files = Object.fromEntries(
          ["SKILL.md", ".fresnel-plugin/plugin.json"].map((path) => [
            path,
            readFileSync(join(request.dir, path), "utf8"),
          ]),
        );
        seen.submits.push({ request, files });
        seen.events.push("submit");
        return Promise.resolve(
          options.submit?.(request) ?? ok({ draftId: "drf_1", itemId: "rvw_1" }),
        );
      },
    },
    decide: (itemId, decision) => {
      seen.decides.push({ itemId, decision });
      seen.events.push("decide");
      return Promise.resolve(options.decide?.() ?? ok(undefined));
    },
  };
}

function submission(overrides: Partial<UserSkillSubmission> = {}): UserSkillSubmission {
  return {
    name: "release-notes",
    description: "Use when writing release notes.",
    files: [{ path: "SKILL.md", bytes: new TextEncoder().encode(SKILL_MD) }],
    actor: { kind: "agent", sessionId: THREAD, agent: "main" },
    threadId: THREAD,
    turnId: TURN,
    approvedByUser: false,
    reason: undefined,
    ...overrides,
  };
}

test("a draft from the assistant goes to the intake with its conversation turn as evidence and waits for review", async () => {
  const fake = fakes();
  const sink = createUserSkillSink({ intake: fake.intake, decide: fake.decide, log: LOG });
  const outcome = await sink.submit(submission());
  expect(outcome).toEqual({ ok: true, value: { itemId: "rvw_1", approved: false } });
  expect(fake.seen.events).toEqual(["submit"]);
  const [call] = fake.seen.submits;
  expect(call?.request).toMatchObject({
    provenance: "assistant",
    originThreadId: THREAD,
    evidence: [{ kind: "turn", threadId: THREAD, turnId: TURN }],
    purpose: "Use when writing release notes.",
  });
  expect(call?.files["SKILL.md"]).toBe(SKILL_MD);
  expect(JSON.parse(call?.files[".fresnel-plugin/plugin.json"] ?? "null")).toEqual({
    schemaVersion: 2,
    name: "release-notes",
    version: "0.0.0",
    purpose: "Use when writing release notes.",
  });
  // 입구가 쓴 뒤 임시 폴더는 지운다
  expect(existsSync(call?.request.dir ?? "")).toBe(false);
});

test("a create the user already approved is approved into the common set in the same call, after the intake", async () => {
  const fake = fakes();
  const sink = createUserSkillSink({ intake: fake.intake, decide: fake.decide, log: LOG });
  const outcome = await sink.submit(
    submission({
      actor: { kind: "user" },
      threadId: undefined,
      turnId: undefined,
      approvedByUser: true,
    }),
  );
  expect(outcome).toEqual({ ok: true, value: { itemId: "rvw_1", approved: true } });
  expect(fake.seen.events).toEqual(["submit", "decide"]);
  expect(fake.seen.decides).toEqual([
    {
      itemId: "rvw_1",
      decision: { kind: "approve", profileIds: ["common"], libraryOnly: false },
    },
  ]);
  // 사람이 승인한 것은 대화를 출처로 적지 않는다
  expect(fake.seen.submits[0]?.request).toMatchObject({
    provenance: "user_instruction",
    originThreadId: null,
    evidence: [],
  });
  expect(existsSync(fake.seen.submits[0]?.request.dir ?? "")).toBe(false);
});

test("a learning approval without a conversation still becomes an approved draft", async () => {
  const fake = fakes();
  const sink = createUserSkillSink({ intake: fake.intake, decide: fake.decide, log: LOG });
  const outcome = await sink.submit(
    submission({
      actor: { kind: "extension", extension: "learning" },
      threadId: undefined,
      turnId: undefined,
      approvedByUser: true,
    }),
  );
  expect(outcome).toEqual({ ok: true, value: { itemId: "rvw_1", approved: true } });
  expect(fake.seen.submits[0]?.request.provenance).toBe("user_instruction");
});

test("an approval that fails after the draft is in the inbox reports the item id and the failure kind", async () => {
  const fake = fakes({ decide: () => err({ kind: "purpose_required", itemId: "rvw_1" }) });
  const sink = createUserSkillSink({ intake: fake.intake, decide: fake.decide, log: LOG });
  const outcome = await sink.submit(submission({ approvedByUser: true, actor: { kind: "user" } }));
  expect(outcome).toMatchObject({
    ok: false,
    error: {
      kind: "unavailable",
      detail: { reviewItemId: "rvw_1" },
    },
  });
  expect(fake.seen.events).toEqual(["submit", "decide"]);
});

test("an intake refusal maps to the knowledge failure kind and approves nothing", async () => {
  const fake = fakes({ submit: () => err({ kind: "exists", name: "release-notes" }) });
  const sink = createUserSkillSink({ intake: fake.intake, decide: fake.decide, log: LOG });
  const outcome = await sink.submit(submission());
  expect(outcome).toMatchObject({
    ok: false,
    error: { kind: "name_conflict", message: "a plugin named release-notes already exists" },
  });
  expect(fake.seen.events).toEqual(["submit"]);
});

test("a skill name that cannot be a plugin name is refused before anything is written", async () => {
  const fake = fakes();
  const sink = createUserSkillSink({ intake: fake.intake, decide: fake.decide, log: LOG });
  const outcome = await sink.submit(submission({ name: "a" }));
  expect(outcome).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  expect(fake.seen.events).toEqual([]);
});
