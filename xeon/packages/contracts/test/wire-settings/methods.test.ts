import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import { APPROVAL_NOT_APPLIED_REASONS, type BinaryName } from "../../src/services/index.ts";
import {
  WIRE_CLIENT_NOTIFICATIONS,
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
  WIRE_PROTOCOL_VERSION,
} from "../../src/wire-settings/wire/index.ts";
import { rawId } from "../helpers/ids.ts";
import { userText } from "../conversation/fixtures/pi-messages.ts";
import { PAYLOAD_FIXTURES } from "../records/fixtures/payloads.ts";

const STORE = "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const THREAD = rawId("thr", 1);

const names = Object.keys(WIRE_METHODS);

/** thread.read 결과 원소로 쓰는 user item */
function readItem(n: number): Record<string, unknown> {
  return {
    itemId: rawId("itm", n),
    status: "completed",
    kind: "user",
    message: userText,
    requestId: null,
  };
}

describe("WIRE_METHODS", () => {
  test("has the 48 methods of the spec table with their stages", () => {
    expect(names).toHaveLength(48);
    const stageOf = Object.fromEntries(Object.entries(WIRE_METHODS).map(([n, s]) => [n, s.stage]));
    const m1 = Object.keys(stageOf).filter((n) => stageOf[n] === "M1");
    expect(m1.toSorted()).toEqual(
      ["events.subscribe", "host.hello", "settings.get", "thread.create", "turn.start"].toSorted(),
    );
    expect(names.filter((n) => stageOf[n] === "M2")).toHaveLength(30);
    expect(names.filter((n) => stageOf[n] === "M3")).toEqual([
      "settings.readFile",
      "settings.writeFile",
      "usage.get",
      "status.list",
      "attachments.add",
      "notify.list",
      "web.providers",
      "proposal.list",
      "proposal.decide",
      "schedule.create",
      "schedule.list",
      "schedule.cancel",
      "schedule.fire",
    ]);
  });

  test("every row carries both schemas, since and status", () => {
    for (const spec of Object.values(WIRE_METHODS)) {
      expect(spec.params).toBeDefined();
      expect(spec.result).toBeDefined();
      expect(spec.since).toBe("0.1.0");
      expect(spec.status).toBe("active");
    }
  });

  test("notification tables", () => {
    expect(Object.keys(WIRE_NOTIFICATIONS)).toEqual([
      "events.batch",
      "events.ended",
      "stream.chunk",
      "settings.invalidated",
      "notify.delivered",
    ]);
    expect(Object.keys(WIRE_CLIENT_NOTIFICATIONS)).toEqual([
      "$/cancelRequest",
      "$/connectionReset",
    ]);
    expect(WIRE_CLIENT_NOTIFICATIONS["$/cancelRequest"].stage).toBe("M1");
    expect(WIRE_NOTIFICATIONS["settings.invalidated"].stage).toBe("M2");
  });

  test("settings.invalidated carries no value and names the scopes that changed", () => {
    const { params } = WIRE_NOTIFICATIONS["settings.invalidated"];
    const valid = { keys: ["l1.loop.maxSteps"], scopes: ["user", "project"], threadId: null };
    expect(parse(params, valid).ok).toBe(true);
    expect(parse(params, { keys: [], scopes: ["session"], threadId: THREAD }).ok).toBe(true);
    // 값 필드와 알 수 없는 범위, 빈 범위 목록, 중복 범위는 거부한다
    expect(parse(params, { ...valid, value: 1 }).ok).toBe(false);
    expect(parse(params, { ...valid, scopes: ["global"] }).ok).toBe(false);
    expect(parse(params, { ...valid, scopes: [] }).ok).toBe(false);
    expect(parse(params, { ...valid, scopes: ["user", "user"] }).ok).toBe(false);
    expect(parse(params, { ...valid, keys: ["not a key"] }).ok).toBe(false);
    expect(parse(params, { keys: [], scopes: ["user"] }).ok).toBe(false);
  });
});

describe("M1 method schemas", () => {
  test("host.hello", () => {
    const { params, result } = WIRE_METHODS["host.hello"];
    const hello = {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      client: { name: "xeon-cli", version: "0.0.0", kind: "cli" },
    };
    expect(parse(params, hello).ok).toBe(true);
    expect(
      parse(params, { ...hello, experimental: ["thread.fork"], auth: { token: "t" } }).ok,
    ).toBe(true);
    expect(parse(params, { ...hello, client: { ...hello.client, kind: "tv" } }).ok).toBe(false);
    expect(parse(params, { ...hello, protocolVersion: "1" }).ok).toBe(false);
    const answer = {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      server: { name: "xeon-host", version: "0.0.0" },
      storeId: STORE,
      transport: "in-process",
      features: [{ name: "turn.start", status: "active", since: "0.1.0" }],
      experimental: [],
    };
    expect(parse(result, answer).ok).toBe(true);
    expect(parse(result, { ...answer, transport: "pigeon" }).ok).toBe(false);
  });

  test("thread.create", () => {
    const { params, result } = WIRE_METHODS["thread.create"];
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { workspace: "/work", title: "t" }).ok).toBe(true);
    expect(parse(params, { title: "" }).ok).toBe(false);
    expect(parse(result, { threadId: THREAD, position: { storeId: STORE, seq: 1 } }).ok).toBe(true);
  });

  test("turn.start", () => {
    const { params, result } = WIRE_METHODS["turn.start"];
    expect(parse(params, { threadId: THREAD, input: "hi" }).ok).toBe(true);
    expect(
      parse(params, {
        threadId: THREAD,
        input: [
          { type: "text", text: "see" },
          { type: "image", data: "aGk=", mimeType: "image/png" },
        ],
        requestId: "req-1",
      }).ok,
    ).toBe(true);
    expect(parse(params, { threadId: THREAD }).ok).toBe(false);
    expect(parse(params, { threadId: "thr_x", input: "hi" }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, input: "hi", requestId: "" }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, input: "hi", requestId: "x".repeat(65) }).ok).toBe(
      false,
    );
    expect(parse(params, { threadId: THREAD, input: 5 }).ok).toBe(false);
    expect(parse(result, { turnId: rawId("trn", 1) }).ok).toBe(true);
  });

  test("events.subscribe", () => {
    const { params, result } = WIRE_METHODS["events.subscribe"];
    expect(parse(params, { from: "head" }).ok).toBe(true);
    expect(
      parse(params, { from: { storeId: STORE, seq: 0 }, filter: { kindPrefixes: ["item."] } }).ok,
    ).toBe(true);
    expect(parse(params, { from: 0 }).ok).toBe(false);
    expect(
      parse(result, { sub: "s1", start: 0, headSeq: 3, storeId: STORE, mode: "replaying" }).ok,
    ).toBe(true);
  });

  test("settings.get", () => {
    const { params, result } = WIRE_METHODS["settings.get"];
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { keys: ["l1.loop.maxSteps"], threadId: THREAD }).ok).toBe(true);
    expect(parse(params, { keys: ["nope"] }).ok).toBe(false);
    const effective = {
      key: "l1.loop.maxSteps",
      value: 5,
      source: { scope: "default" },
      locked: false,
      shadowed: [],
      runtimeChange: "live",
      pendingUntil: null,
      deprecated: false,
    };
    expect(parse(result, { settings: [effective] }).ok).toBe(true);
    expect(parse(result, { settings: [{ ...effective, locked: "no" }] }).ok).toBe(false);
  });
});

describe("M2 method schemas are written out", () => {
  test("settings.set and settings.reset share a result", () => {
    expect(WIRE_METHODS["settings.set"].result).toBe(WIRE_METHODS["settings.reset"].result);
    const set = WIRE_METHODS["settings.set"].params;
    expect(parse(set, { key: "l1.loop.maxSteps", value: null, scope: "user" }).ok).toBe(true);
    expect(parse(set, { key: "l1.loop.maxSteps", value: 1, scope: "everywhere" }).ok).toBe(false);
    const reset = WIRE_METHODS["settings.reset"].params;
    expect(parse(reset, { key: "l1.loop.maxSteps", scope: "session", threadId: THREAD }).ok).toBe(
      true,
    );
    expect(parse(reset, { key: "l1.loop.maxSteps", scope: "session", value: 1 }).ok).toBe(false);
  });

  test("thread.close and thread.delete share params and have an empty result", () => {
    const close = WIRE_METHODS["thread.close"];
    expect(close.params).toBe(WIRE_METHODS["thread.delete"].params);
    expect(parse(close.result, {}).ok).toBe(true);
    expect(parse(close.result, { extra: 1 }).ok).toBe(false);
  });

  test("approval.respond", () => {
    const { params } = WIRE_METHODS["approval.respond"];
    expect(
      parse(params, { approvalId: rawId("evt", 1), decision: "allow", remember: "thread" }).ok,
    ).toBe(true);
    expect(
      parse(params, {
        approvalId: rawId("evt", 1),
        decision: "answer",
        answer: { q1: { selected: ["a"], text: "x" } },
      }).ok,
    ).toBe(true);
    // 질문 응답은 질문 id → { selected, text? }다. 문자열 하나나 AskAnswer 배열 모양은 받지 않는다
    expect(
      parse(params, { approvalId: rawId("evt", 1), decision: "answer", answer: { q1: "x" } }).ok,
    ).toBe(false);
    expect(parse(params, { approvalId: rawId("evt", 1), decision: "maybe" }).ok).toBe(false);
  });

  test("approval.respond result carries the reason a response was not applied", () => {
    const { result } = WIRE_METHODS["approval.respond"];
    expect(parse(result, { applied: true }).ok).toBe(true);
    expect(parse(result, { applied: false, reason: "already_resolved" }).ok).toBe(true);
    expect(
      parse(result, { applied: false, reason: "answer_invalid", detail: "decision is wrong" }).ok,
    ).toBe(true);
    expect(parse(result, { applied: false, reason: "nope" }).ok).toBe(false);
    expect(parse(result, { applied: false, extra: 1 }).ok).toBe(false);
    expect(
      parse(result, { applied: false, reason: "answer_invalid", detail: "x".repeat(513) }).ok,
    ).toBe(false);
    // 서비스의 이유 목록과 wire 스키마가 같은 값을 쓴다
    expect([...APPROVAL_NOT_APPLIED_REASONS]).toEqual([
      "answer_invalid",
      "already_resolved",
      "unknown_approval",
      "commit_failed",
    ]);
    for (const reason of APPROVAL_NOT_APPLIED_REASONS) {
      expect(parse(result, { applied: false, reason }).ok).toBe(true);
    }
  });

  test("thread.read returns items with the position they reflect", () => {
    const { params, result } = WIRE_METHODS["thread.read"];
    expect(parse(params, { threadId: THREAD }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, limit: 500, before: rawId("itm", 9) }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, limit: 0 }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, limit: 501 }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, before: "nope" }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, mode: "write" }).ok).toBe(false);
    const item = {
      itemId: rawId("itm", 1),
      status: "completed",
      kind: "user",
      message: userText,
      requestId: null,
    };
    const position = { storeId: STORE, seq: 12 };
    expect(parse(result, { threadId: THREAD, items: [item], position, hasMore: false }).ok).toBe(
      true,
    );
    expect(parse(result, { threadId: THREAD, items: [], position, hasMore: true }).ok).toBe(true);
    // position과 hasMore는 빠질 수 없다. 빠지면 UI가 이어 붙일 자리를 모른다
    expect(parse(result, { threadId: THREAD, items: [item], hasMore: false }).ok).toBe(false);
    expect(parse(result, { threadId: THREAD, items: [item], position }).ok).toBe(false);
    expect(
      parse(result, { threadId: THREAD, items: [item], position: { seq: 12 }, hasMore: false }).ok,
    ).toBe(false);
    expect(
      parse(result, {
        threadId: THREAD,
        items: [{ ...item, kind: "assistant" }],
        position,
        hasMore: false,
      }).ok,
    ).toBe(false);
  });

  test("thread.read never returns more items than its limit allows", () => {
    // 한 번에 받을 수 있는 최대 item 수는 요청 limit의 상한과 같다(한 페이지가 프레임 한도 안에서 limit 이하로 오는 근거)
    const { result } = WIRE_METHODS["thread.read"];
    const position = { storeId: STORE, seq: 12 };
    const page = (count: number) => ({
      threadId: THREAD,
      items: Array.from({ length: count }, (_, i) => readItem(i + 1)),
      position,
      hasMore: true,
    });
    expect(parse(result, page(500)).ok).toBe(true);
    expect(parse(result, page(501)).ok).toBe(false);
  });

  test("approval.list returns approval.requested payloads with the position they reflect", () => {
    const { params, result } = WIRE_METHODS["approval.list"];
    expect(parse(params, { threadId: THREAD }).ok).toBe(true);
    expect(parse(params, {}).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, extra: 1 }).ok).toBe(false);
    const request = PAYLOAD_FIXTURES["approval.requested"];
    const position = { storeId: STORE, seq: 30 };
    const entry = { approvalId: rawId("evt", 7), seq: 21, request };
    expect(parse(result, { approvals: [entry], position }).ok).toBe(true);
    expect(parse(result, { approvals: [], position }).ok).toBe(true);
    expect(parse(result, { approvals: [entry] }).ok).toBe(false);
    expect(parse(result, { approvals: [{ ...entry, seq: -1 }], position }).ok).toBe(false);
    expect(parse(result, { approvals: [{ ...entry, request: {} }], position }).ok).toBe(false);
    expect(
      parse(result, { approvals: [{ approvalId: entry.approvalId, request }], position }).ok,
    ).toBe(false);
  });

  test("thread.rename takes a 1..200 character title and answers with the position it reached", () => {
    const { params, result } = WIRE_METHODS["thread.rename"];
    expect(parse(params, { threadId: THREAD, title: "계획 회의" }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, title: "x".repeat(200) }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, title: "x".repeat(201) }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, title: "" }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, title: null }).ok).toBe(false);
    expect(parse(params, { title: "a" }).ok).toBe(false);
    // thread.list의 title 상한과 같다: 바꾼 제목은 목록 원소에 그대로 들어간다
    const summaryTitle =
      WIRE_METHODS["thread.list"].result.properties.threads.items.properties.title;
    expect(parse(summaryTitle, "x".repeat(200)).ok).toBe(true);
    expect(parse(result, { position: { storeId: STORE, seq: 3 } }).ok).toBe(true);
    expect(parse(result, {}).ok).toBe(false);
  });

  test("thread.compact takes the thread and an optional guidance and answers compacted or skipped", () => {
    const { params, result } = WIRE_METHODS["thread.compact"];
    expect(WIRE_METHODS["thread.compact"].stage).toBe("M2");
    expect(parse(params, { threadId: THREAD }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, instructions: "결정 사항을 남긴다" }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, instructions: "x".repeat(20_000) }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, instructions: "x".repeat(20_001) }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, instructions: "" }).ok).toBe(false);
    expect(parse(params, { instructions: "a" }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, reason: "manual" }).ok).toBe(false);

    const eventId = rawId("evt", 7);
    const position = { storeId: STORE, seq: 12 };
    const compacted = {
      status: "compacted",
      eventId,
      tokensBefore: 91_234,
      fromExtension: null,
      position,
    };
    const parsed = parse(result, compacted);
    const value: unknown = parsed.ok ? parsed.value : undefined;
    expect(value).toEqual(compacted);
    expect(parse(result, { ...compacted, fromExtension: "summarizer" }).ok).toBe(true);
    expect(parse(result, { ...compacted, tokensBefore: -1 }).ok).toBe(false);
    expect(parse(result, { ...compacted, eventId: "not-an-event" }).ok).toBe(false);
    expect(parse(result, { ...compacted, position: undefined }).ok).toBe(false);
    expect(parse(result, { ...compacted, extra: 1 }).ok).toBe(false);
    for (const why of ["nothing_to_summarize", "last_entry_is_compaction", "disabled"]) {
      expect(parse(result, { status: "skipped", why }).ok).toBe(true);
    }
    expect(parse(result, { status: "skipped", why: "tired" }).ok).toBe(false);
    expect(parse(result, { status: "skipped" }).ok).toBe(false);
    // 확장이 막은 컴팩션은 결과가 아니라 오류다
    expect(parse(result, { status: "cancelled", by: "ext", reason: "no" }).ok).toBe(false);
  });

  test("turn.resume takes only the thread and answers with the three ResumeResult shapes", () => {
    const { params, result } = WIRE_METHODS["turn.resume"];
    expect(parse(params, { threadId: THREAD }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, turnId: rawId("trn", 1) }).ok).toBe(false);
    expect(parse(params, {}).ok).toBe(false);
    const turnId = rawId("trn", 1);
    expect(parse(result, { status: "resumed", turnId, from: "tools" }).ok).toBe(true);
    expect(parse(result, { status: "resumed", turnId, from: "await_input" }).ok).toBe(true);
    expect(parse(result, { status: "resumed", turnId, from: "lunch" }).ok).toBe(false);
    expect(parse(result, { status: "resumed", turnId }).ok).toBe(false);
    expect(parse(result, { status: "closed", turnId, reason: "abort_requested" }).ok).toBe(true);
    expect(parse(result, { status: "closed", turnId, reason: "owner_cancelled" }).ok).toBe(true);
    expect(parse(result, { status: "closed", turnId, reason: "bored" }).ok).toBe(false);
    expect(parse(result, { status: "nothing" }).ok).toBe(true);
    expect(parse(result, { status: "nothing", turnId }).ok).toBe(false);
  });

  test("command.list and command.run carry the dialog.commands shapes over the wire", () => {
    const list = WIRE_METHODS["command.list"];
    expect(parse(list.params, {}).ok).toBe(true);
    expect(parse(list.params, { prefix: "pl", includeHidden: true }).ok).toBe(true);
    expect(parse(list.params, { prefix: "" }).ok).toBe(false);
    // threadId는 프로젝트 명령을 읽을 thread 문맥이다. 선택이고 thread id 모양이어야 한다
    const withThread = parse(list.params, { prefix: "pl", threadId: THREAD });
    expect(withThread.ok).toBe(true);
    const threadValue: unknown = withThread.ok ? withThread.value : undefined;
    expect(threadValue).toEqual({
      prefix: "pl",
      threadId: THREAD,
    });
    expect(parse(list.params, { threadId: "not-a-thread" }).ok).toBe(false);
    expect(parse(list.params, { threadId: 7 }).ok).toBe(false);
    const info = {
      name: "plan",
      description: "계획 모드를 켠다",
      argumentHint: "[주제]",
      args: [{ name: "topic", rest: true }],
      kind: "action",
      source: "capability",
      origin: "cap-work",
      hasShell: false,
    };
    expect(parse(list.result, { commands: [info] }).ok).toBe(true);
    expect(parse(list.result, { commands: [{ ...info, name: "Plan" }] }).ok).toBe(false);
    expect(parse(list.result, { commands: [{ ...info, kind: "macro" }] }).ok).toBe(false);

    const run = WIRE_METHODS["command.run"];
    expect(parse(run.params, { threadId: THREAD, text: "/plan 설계" }).ok).toBe(true);
    expect(parse(run.params, { threadId: THREAD, text: "/x", confirmShell: true }).ok).toBe(true);
    expect(parse(run.params, { text: "/plan" }).ok).toBe(false);
    expect(parse(run.params, { threadId: THREAD, text: "" }).ok).toBe(false);
    // 동작 명령의 출력은 done.message(텍스트)와 done.result(구조 값)로 돌아온다
    const done = { status: "done", name: "tasks", message: "할 일 2건", result: { open: 2 } };
    expect(parse(run.result, done).ok).toBe(true);
    expect(parse(run.result, { status: "not_command" }).ok).toBe(true);
    expect(parse(run.result, { status: "expanded", name: "review", text: "검토한다" }).ok).toBe(
      true,
    );
    expect(
      parse(run.result, {
        status: "needs_confirmation",
        name: "ship",
        shell: [{ index: 0, command: "git status" }],
      }).ok,
    ).toBe(true);
    expect(parse(run.result, { ...done, message: undefined }).ok).toBe(false);
    expect(parse(run.result, { status: "failed" }).ok).toBe(false);
  });

  test("secret.test reports decryptability, length and a hash prefix, and no value", () => {
    const { result } = WIRE_METHODS["secret.test"];
    const present = {
      state: "registered",
      decryptable: true,
      length: 24,
      sha256Prefix: "1a2b3c4d",
    };
    expect(parse(result, present).ok).toBe(true);
    expect(
      parse(result, { state: "missing", decryptable: false, length: null, sha256Prefix: null }).ok,
    ).toBe(true);
    // 앞 8자가 아닌 해시, 대문자, 값 필드, 옛 모양(state만)은 거부한다
    expect(parse(result, { ...present, sha256Prefix: "1a2b3c4d5e6f" }).ok).toBe(false);
    expect(parse(result, { ...present, sha256Prefix: "1A2B3C4D" }).ok).toBe(false);
    expect(parse(result, { ...present, value: "plain" }).ok).toBe(false);
    expect(parse(result, { ...present, length: -1 }).ok).toBe(false);
    expect(parse(result, { state: "registered" }).ok).toBe(false);
  });

  test("secret.references names the settings, leases and sessions that point at a secret", () => {
    const { params, result } = WIRE_METHODS["secret.references"];
    expect(parse(params, { name: "github-token" }).ok).toBe(true);
    expect(parse(params, { name: "GitHub" }).ok).toBe(false);
    const report = { settingKeys: ["l2.web.exa.apiKey"], activeLeases: 1, sessions: [THREAD] };
    expect(parse(result, report).ok).toBe(true);
    expect(parse(result, { settingKeys: [], activeLeases: 0, sessions: [] }).ok).toBe(true);
    expect(parse(result, { ...report, sessions: ["recent"] }).ok).toBe(false);
    expect(parse(result, { ...report, settingKeys: ["no key"] }).ok).toBe(false);
    expect(parse(result, { ...report, activeLeases: -1 }).ok).toBe(false);
    expect(parse(result, { ...report, value: "x" }).ok).toBe(false);
  });

  test("secret methods carry no value field", () => {
    for (const name of [
      "secret.meta",
      "secret.remove",
      "secret.test",
      "secret.references",
      "secret.beginEntry",
      "secret.beginReveal",
    ] as const) {
      const params = WIRE_METHODS[name].params;
      expect(parse(params, { name: "github-token", action: "add", value: "plain" }).ok).toBe(false);
    }
    expect(
      parse(WIRE_METHODS["secret.beginEntry"].params, { name: "github-token", action: "rotate" })
        .ok,
    ).toBe(true);
    expect(parse(WIRE_METHODS["secret.test"].params, { name: "GitHub" }).ok).toBe(false);
    expect(parse(WIRE_METHODS["secret.beginReveal"].params, { name: "github-token" }).ok).toBe(
      true,
    );
    expect(parse(WIRE_METHODS["secret.beginReveal"].result, { started: true }).ok).toBe(true);
    expect(parse(WIRE_METHODS["secret.beginReveal"].result, { started: true, value: "x" }).ok).toBe(
      false,
    );
    expect(parse(WIRE_METHODS["secret.list"].params, { meta: true, usage: false }).ok).toBe(true);
  });

  test("trust methods take a workspace and a choice, and the status lists the options", () => {
    const { params: getParams, result } = WIRE_METHODS["trust.get"];
    expect(parse(getParams, { workspace: "/work/app" }).ok).toBe(true);
    expect(parse(getParams, {}).ok).toBe(false);
    expect(parse(getParams, { workspace: "" }).ok).toBe(false);
    const decide = WIRE_METHODS["trust.decide"].params;
    expect(
      parse(decide, { workspace: "/work/app", choice: { kind: "folder", verdict: "allow" } }).ok,
    ).toBe(true);
    expect(
      parse(decide, { workspace: "/work/app", choice: { kind: "forever", verdict: "allow" } }).ok,
    ).toBe(false);
    expect(
      parse(decide, { workspace: "/work/app", choice: { kind: "session", verdict: "undecided" } })
        .ok,
    ).toBe(false);
    const status = {
      projectRoot: "/work/app",
      required: true,
      verdict: "undecided",
      via: "headless",
      resources: [".mcp.json", ".xeon/settings.json"],
      options: [
        {
          choice: { kind: "folder", verdict: "allow" },
          label: "trust-folder",
          savedPath: "/work/app",
        },
        { choice: { kind: "session", verdict: "allow" }, label: "trust-session", savedPath: null },
      ],
    };
    expect(parse(result, status).ok).toBe(true);
    expect(WIRE_METHODS["trust.decide"].result).toBe(result);
    expect(parse(result, { ...status, verdict: "maybe" }).ok).toBe(false);
    expect(parse(result, { ...status, via: "somewhere" }).ok).toBe(false);
    expect(parse(result, { ...status, extra: true }).ok).toBe(false);
  });

  test("settings.list leaves reserved keys out unless asked", () => {
    const { params } = WIRE_METHODS["settings.list"];
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { includeReserved: true, includeDeprecated: false }).ok).toBe(true);
    expect(parse(params, { includeReserved: "yes" }).ok).toBe(false);
  });

  test("thread.list returns summaries with the ThreadSummaryRow fields", () => {
    const { result, params } = WIRE_METHODS["thread.list"];
    const summary = {
      threadId: THREAD,
      title: "hello",
      status: "idle",
      workspace: "/work/app",
      createdAt: "2026-10-23T01:00:00Z",
      updatedAt: "2026-10-23T01:05:00Z",
      headSeq: 42,
      forkedFrom: { threadId: rawId("thr", 2), eventId: rawId("evt", 3) },
      resumable: {
        turnId: rawId("trn", 1),
        runningSince: "2026-10-23T01:04:00Z",
        resumeAttempts: 1,
      },
      queuedInputs: 0,
      pendingApprovals: 2,
    };
    expect(parse(result, { threads: [summary], nextCursor: null }).ok).toBe(true);
    expect(parse(result, { threads: [], nextCursor: "c1" }).ok).toBe(true);
    expect(
      parse(result, {
        threads: [{ ...summary, resumable: null, workspace: null, title: null, forkedFrom: null }],
        nextCursor: null,
      }).ok,
    ).toBe(true);
    // 열려 있던 원소는 더 이상 받지 않는다
    expect(parse(result, { threads: [{ anything: 1 }], nextCursor: null }).ok).toBe(false);
    expect(parse(result, { threads: [{ ...summary, headSeq: -1 }], nextCursor: null }).ok).toBe(
      false,
    );
    expect(
      parse(result, { threads: [{ ...summary, status: "paused" }], nextCursor: null }).ok,
    ).toBe(false);
    expect(
      parse(result, { threads: [{ ...summary, updatedAt: 1_700_000_000 }], nextCursor: null }).ok,
    ).toBe(false);
    expect(parse(result, { threads: [{ ...summary, extra: 1 }], nextCursor: null }).ok).toBe(false);
    expect(parse(params, { workspace: "/work/app", limit: 50 }).ok).toBe(true);
  });

  test("host.shutdown and host.status", () => {
    expect(
      parse(WIRE_METHODS["host.shutdown"].params, { reason: "user", deadlineMs: 3000 }).ok,
    ).toBe(true);
    expect(parse(WIRE_METHODS["host.shutdown"].params, { reason: "boredom" }).ok).toBe(false);
    expect(
      parse(WIRE_METHODS["host.status"].result, {
        mode: "service",
        pid: 10,
        startedAt: "2026-10-21T00:00:00.000Z",
        connections: 1,
        liveTurns: 0,
        idleShutdownAt: null,
      }).ok,
    ).toBe(true);
  });

  test("host.status asks for the external binary check only when includeBinaries is true", () => {
    const { params } = WIRE_METHODS["host.status"];
    expect(parse(params, {}).ok).toBe(true);
    const asked = parse(params, { includeBinaries: true });
    expect(asked.ok && asked.value.includeBinaries).toBe(true);
    expect(parse(params, { includeBinaries: "yes" }).ok).toBe(false);
    expect(parse(params, { binaries: true }).ok).toBe(false);
  });

  test("host.status carries the binary check as ready, blocking, degraded and one row per binary", () => {
    const { result } = WIRE_METHODS["host.status"];
    const status = {
      mode: "stdio",
      pid: 10,
      startedAt: "2026-10-21T00:00:00.000Z",
      connections: 1,
      liveTurns: 0,
      idleShutdownAt: null,
    };
    const binaries = {
      platform: "linux",
      ready: false,
      blocking: ["sops"],
      degraded: ["git", "secret-tool"],
      items: [
        {
          name: "rg",
          need: "required",
          usedBy: "파일 검색",
          impact: "파일 검색이 동작하지 않는다",
          status: { kind: "ok", version: "14.1.0", source: "bundled" },
        },
        {
          name: "sops",
          need: "required",
          usedBy: "secrets 기본 provider",
          impact: "비밀을 읽고 쓸 수 없다",
          status: { kind: "missing", hint: "brew install sops" },
        },
        {
          name: "bwrap",
          need: "required",
          usedBy: "sandbox",
          impact: "샌드박스를 쓸 수 없다",
          status: { kind: "too_old", found: "0.3.0", required: "0.4.0" },
        },
        {
          name: "git",
          need: "optional",
          usedBy: "작업 공간 git 기능",
          impact: "git 상태 표시만 빠진다",
          status: { kind: "unusable", reason: "version_unreadable" },
        },
      ],
    };
    const parsed = parse(result, { ...status, binaries });
    const carried: unknown = parsed.ok ? parsed.value.binaries : undefined;
    expect(carried).toEqual(binaries);
    // 점검을 요청하지 않으면 필드가 없다
    const plain = parse(result, status);
    expect(plain.ok).toBe(true);
    expect(plain.ok ? plain.value.binaries : "parse failed").toBeUndefined();
    // 어긋난 모양은 거절한다
    const row = binaries.items[1];
    const rejects = (changed: Record<string, unknown>): boolean =>
      parse(result, { ...status, binaries: { ...binaries, ...changed } }).ok;
    expect(rejects({ ready: "no" })).toBe(false);
    expect(rejects({ platform: "freebsd" })).toBe(false);
    expect(rejects({ blocking: ["curl"] })).toBe(false);
    expect(rejects({ extra: 1 })).toBe(false);
    expect(rejects({ items: [{ ...row, need: "not_used" }] })).toBe(false);
    expect(rejects({ items: [{ ...row, status: { kind: "ok", version: "1" } }] })).toBe(false);
    // 실행 파일 경로는 wire에 싣지 않는다
    expect(
      rejects({
        items: [
          { ...row, status: { kind: "ok", version: "1", source: "system", path: "/usr/bin/x" } },
        ],
      }),
    ).toBe(false);
  });

  test("every external binary name the services know is accepted in blocking", () => {
    const all: Record<BinaryName, true> = {
      rg: true,
      sops: true,
      age: true,
      git: true,
      bwrap: true,
      socat: true,
      security: true,
      "secret-tool": true,
    };
    const { result } = WIRE_METHODS["host.status"];
    for (const name of Object.keys(all)) {
      const parsed = parse(result, {
        mode: "stdio",
        pid: 1,
        startedAt: "2026-10-21T00:00:00.000Z",
        connections: 0,
        liveTurns: 0,
        idleShutdownAt: null,
        binaries: { platform: "darwin", ready: false, blocking: [name], degraded: [], items: [] },
      });
      expect(parsed.ok).toBe(true);
    }
  });
});
