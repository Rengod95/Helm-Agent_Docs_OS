import { describe, expect, test } from "bun:test";
import { err, ok, parse, type Result, type Scheduler } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import {
  CLIPBOARD_CLEAR_MS,
  REVEAL_VISIBLE_MS,
  type RevealFailure,
  type RevealGrant,
  type SecretRevealPort,
} from "@fresnel/client/settings";
import type { SecretListEntry } from "@fresnel/contracts/wire";
import { UNAVAILABLE_GATE, type RevealGate } from "../../src/app/secret-reveal-gate.ts";
import {
  createRevealSession,
  revealPortOf,
  type RevealSession,
  type RevealView,
} from "../../src/views/pages/secrets/secret-reveal.ts";
import {
  initialSecretsState,
  secretsReducer,
  secretsViewOf,
  type SecretsState,
} from "../../src/views/pages/secrets/secret-model.ts";
import type { SecretCommandError, SecretCommands } from "../../src/views/commands.ts";

// 값 보기와 클립보드 시한을 가짜 재인증 관문, 가짜 값 포트, 가짜 시계와 시간, 가짜 클립보드로 시험한다.
// 값은 가짜 문자열이다(실제 키를 쓰지 않는다). 시간은 시험이 직접 흘린다.

const SECRET = "fake-secret-value-for-tests-0001";

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
}

const NAME = nameOf("exa-api-key");
const OTHER = nameOf("brave-api-key");

/** 시험이 시간을 직접 흘리는 스케줄러. 걸린 시한을 가장 오래된 것부터 또는 가장 새것부터 연다 */
function manualScheduler(): Scheduler & {
  fire(): void;
  fireOldest(): void;
  fireNewest(): void;
  delays(): number[];
  pending(): number;
} {
  const timers = new Map<number, { readonly fn: () => void; readonly ms: number }>();
  let next = 1;
  const fireId = (id: number): void => {
    const timer = timers.get(id);
    if (timer === undefined) return;
    timers.delete(id);
    timer.fn();
  };
  return {
    setTimeout(fn, ms) {
      const id = next;
      next += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    fire() {
      const due = Array.from(timers.keys());
      for (const id of due) fireId(id);
    },
    fireOldest() {
      const oldest = Math.min(...timers.keys());
      if (Number.isFinite(oldest)) fireId(oldest);
    },
    fireNewest() {
      const newest = Math.max(...timers.keys());
      if (Number.isFinite(newest)) fireId(newest);
    },
    delays: () => Array.from(timers.values(), (timer) => timer.ms),
    pending: () => timers.size,
  };
}

/** 시험의 시계. 시간은 `advance`로만 흐른다 */
function manualClock(start: number): { now(): number; advance(ms: number): void } {
  let at = start;
  return {
    now: () => at,
    advance(ms) {
      at += ms;
    },
  };
}

/** 가짜 클립보드. 쓴 글을 차례로 남긴다. 비우기는 빈 글을 쓰는 것이다 */
function fakeClipboard(refuse = false): {
  writeText(text: string): Promise<void>;
  writes(): readonly string[];
  content(): string;
} {
  const log: string[] = [];
  return {
    writeText(text) {
      if (refuse) return Promise.reject(new Error("clipboard refused"));
      log.push(text);
      return Promise.resolve();
    },
    writes: () => log.slice(),
    content: () => log.at(-1) ?? "",
  };
}

/** 값 포트. 부를 때마다 새 바이트를 내고, 낸 바이트를 모두 기억한다(덮였는지 본다) */
function fakeValuePort(text: string): {
  port: SecretRevealPort;
  handed(): readonly Uint8Array[];
  calls(): number;
} {
  const handed: Uint8Array[] = [];
  const state = { calls: 0 };
  return {
    port: {
      reveal() {
        state.calls += 1;
        const bytes = new TextEncoder().encode(text);
        handed.push(bytes);
        const grant: RevealGrant = { kind: "value", bytes };
        return Promise.resolve(ok(grant));
      },
    },
    handed: () => handed.slice(),
    calls: () => state.calls,
  };
}

/** 가짜 재인증 관문. 정해진 결과를 돌려주고 부른 횟수를 센다 */
function fakeGate(outcome: Result<void, RevealFailure>): RevealGate & { calls(): number } {
  const state = { calls: 0 };
  return {
    available: true,
    reauth: () => {
      state.calls += 1;
      return Promise.resolve(outcome);
    },
    calls: () => state.calls,
  };
}

const PASSED: Result<void, RevealFailure> = ok(undefined);

function sessionFor(options: {
  readonly gate: RevealGate;
  readonly port: SecretRevealPort;
  readonly scheduler: Scheduler;
  readonly clock: { now(): number };
  readonly clipboard: { writeText(text: string): Promise<void> };
}): RevealSession {
  return createRevealSession({
    gate: options.gate,
    valuePort: options.port,
    scheduler: options.scheduler,
    clock: options.clock,
    clipboard: options.clipboard,
  });
}

const zeroed = (bytes: Uint8Array): boolean => bytes.every((byte) => byte === 0);

describe("the reveal gate comes before the value", () => {
  test("the shipped gate is unavailable: the value port is never called and the view says why", async () => {
    const value = fakeValuePort(SECRET);
    const session = sessionFor({
      gate: UNAVAILABLE_GATE,
      port: value.port,
      scheduler: manualScheduler(),
      clock: manualClock(0),
      clipboard: fakeClipboard(),
    });
    await session.reveal(NAME);
    expect(session.view()).toEqual({
      status: "failed",
      name: NAME,
      failure: { kind: "unavailable" },
    });
    expect(value.calls()).toBe(0);
    expect(session.shownText()).toBeNull();
    expect(await session.copy()).toBe(false);
  });

  test("a denied re-auth holds no value and never calls the value port", async () => {
    const value = fakeValuePort(SECRET);
    const gate = fakeGate(err({ kind: "reauth_denied" }));
    const session = sessionFor({
      gate,
      port: value.port,
      scheduler: manualScheduler(),
      clock: manualClock(0),
      clipboard: fakeClipboard(),
    });
    await session.reveal(NAME);
    expect(session.view()).toEqual({
      status: "failed",
      name: NAME,
      failure: { kind: "reauth_denied" },
    });
    expect(gate.calls()).toBe(1);
    expect(value.calls()).toBe(0);
  });

  test("a passed re-auth shows the value for the visible time, and the countdown falls with the clock", async () => {
    const clock = manualClock(1_000_000);
    const value = fakeValuePort(SECRET);
    const session = sessionFor({
      gate: fakeGate(PASSED),
      port: value.port,
      scheduler: manualScheduler(),
      clock,
      clipboard: fakeClipboard(),
    });
    await session.reveal(NAME);
    expect(session.view()).toEqual({
      status: "revealed",
      name: NAME,
      hostShown: false,
      remainingSec: REVEAL_VISIBLE_MS / 1000,
    });
    expect(session.shownText()).toBe(SECRET);
    clock.advance(10_000);
    expect(session.view()).toMatchObject({ status: "revealed", remainingSec: 20 });
  });

  test("the value hides itself when the visible time passes, and its bytes are zeroed", async () => {
    const scheduler = manualScheduler();
    const value = fakeValuePort(SECRET);
    const session = sessionFor({
      gate: fakeGate(PASSED),
      port: value.port,
      scheduler,
      clock: manualClock(0),
      clipboard: fakeClipboard(),
    });
    await session.reveal(NAME);
    expect(scheduler.delays()).toEqual([REVEAL_VISIBLE_MS]);
    scheduler.fire();
    expect(session.view()).toEqual({ status: "hidden" });
    expect(session.shownText()).toBeNull();
    expect(value.handed().every(zeroed)).toBe(true);
  });
});

describe("the clipboard copy is cleared after 30 seconds", () => {
  test("copy writes the value, and only the clipboard's own 30-second timer empties it", async () => {
    const scheduler = manualScheduler();
    const clipboard = fakeClipboard();
    const session = sessionFor({
      gate: fakeGate(PASSED),
      port: fakeValuePort(SECRET).port,
      scheduler,
      clock: manualClock(0),
      clipboard,
    });
    await session.reveal(NAME);
    expect(await session.copy()).toBe(true);
    expect(clipboard.content()).toBe(SECRET);
    // 가림 시한과 클립보드 시한, 두 개가 30초씩 걸려 있다
    expect(scheduler.delays()).toEqual([CLIPBOARD_CLEAR_MS, CLIPBOARD_CLEAR_MS]);
    // 클립보드 시한은 가장 나중에 건 것이다. 그것만 열면 값은 가려지지 않고 클립보드만 비워진다
    scheduler.fireNewest();
    expect(clipboard.content()).toBe("");
    expect(clipboard.writes()).toEqual([SECRET, ""]);
    expect(session.view()).toMatchObject({ status: "revealed" });
    scheduler.fireOldest();
    expect(session.view()).toEqual({ status: "hidden" });
  });

  test("hiding the value clears a copied value at once, without waiting for the timer", async () => {
    const scheduler = manualScheduler();
    const clipboard = fakeClipboard();
    const value = fakeValuePort(SECRET);
    const session = sessionFor({
      gate: fakeGate(PASSED),
      port: value.port,
      scheduler,
      clock: manualClock(0),
      clipboard,
    });
    await session.reveal(NAME);
    await session.copy();
    session.hide();
    expect(clipboard.content()).toBe("");
    expect(scheduler.pending()).toBe(0);
    expect(value.handed().every(zeroed)).toBe(true);
  });

  test("copy with no visible value does nothing", async () => {
    const clipboard = fakeClipboard();
    const session = sessionFor({
      gate: UNAVAILABLE_GATE,
      port: fakeValuePort(SECRET).port,
      scheduler: manualScheduler(),
      clock: manualClock(0),
      clipboard,
    });
    expect(await session.copy()).toBe(false);
    expect(clipboard.writes()).toEqual([]);
  });

  test("a clipboard that refuses the write reports the copy as failed and arms no clear", async () => {
    const scheduler = manualScheduler();
    const session = sessionFor({
      gate: fakeGate(PASSED),
      port: fakeValuePort(SECRET).port,
      scheduler,
      clock: manualClock(0),
      clipboard: fakeClipboard(true),
    });
    await session.reveal(NAME);
    expect(await session.copy()).toBe(false);
    expect(scheduler.delays()).toEqual([REVEAL_VISIBLE_MS]);
  });
});

describe("another name and the screen state", () => {
  test("opening another name zeroes the first value", async () => {
    const value = fakeValuePort(SECRET);
    const session = sessionFor({
      gate: fakeGate(PASSED),
      port: value.port,
      scheduler: manualScheduler(),
      clock: manualClock(0),
      clipboard: fakeClipboard(),
    });
    await session.reveal(NAME);
    await session.reveal(OTHER);
    const [first, second] = value.handed();
    expect(first !== undefined && zeroed(first)).toBe(true);
    expect(second !== undefined && zeroed(second)).toBe(false);
    expect(session.view()).toMatchObject({ status: "revealed", name: OTHER });
  });
});

describe("secrets.value-never-in-state", () => {
  const ROW: SecretListEntry = { name: NAME, status: "valid" };

  test("after reveal and hide, the reducer state and the view model hold none of the secret text", async () => {
    const value = fakeValuePort(SECRET);
    const scheduler = manualScheduler();
    const clipboard = fakeClipboard();
    const session = sessionFor({
      gate: fakeGate(PASSED),
      port: value.port,
      scheduler,
      clock: manualClock(0),
      clipboard,
    });
    const screen: { state: SecretsState } = {
      state: secretsReducer(initialSecretsState(true), {
        type: "listLoaded",
        rows: [ROW],
      }),
    };
    session.subscribe(() => {
      screen.state = secretsReducer(screen.state, { type: "reveal", view: session.view() });
    });

    await session.reveal(NAME);
    await session.copy();
    // 그리는 순간에만 글자가 있다. 상태와 뷰 모델에는 없다
    expect(session.shownText()).toBe(SECRET);
    expect(screen.state.reveal.status).toBe("revealed");
    expect(JSON.stringify(screen.state)).not.toContain(SECRET);
    expect(JSON.stringify(secretsViewOf(screen.state))).not.toContain(SECRET);
    expect(JSON.stringify(screen.state)).not.toContain(SECRET.slice(0, 12));

    session.hide();
    expect(screen.state.reveal).toEqual({ status: "hidden" });
    expect(JSON.stringify(screen.state)).not.toContain(SECRET);
    expect(JSON.stringify(secretsViewOf(screen.state))).not.toContain(SECRET);
    expect(JSON.stringify(screen.state)).not.toContain(SECRET.slice(0, 12));
    expect(clipboard.content()).toBe("");
    expect(value.handed().every(zeroed)).toBe(true);
  });
});

function secretsWith(
  answer: Result<boolean, SecretCommandError>,
): Pick<SecretCommands, "beginReveal"> {
  return { beginReveal: () => Promise.resolve(answer) };
}

async function outcomeOf(answer: Result<boolean, SecretCommandError>): Promise<RevealView> {
  const session = sessionFor({
    gate: fakeGate(PASSED),
    port: revealPortOf(secretsWith(answer)),
    scheduler: manualScheduler(),
    clock: manualClock(0),
    clipboard: fakeClipboard(),
  });
  await session.reveal(NAME);
  return session.view();
}

describe("the wire answers map to reveal outcomes", () => {
  test("the host showing the value is a revealed state with no value in this process", async () => {
    expect(await outcomeOf(ok(true))).toEqual({
      status: "revealed",
      name: NAME,
      hostShown: true,
      remainingSec: REVEAL_VISIBLE_MS / 1000,
    });
  });

  test("a host that did not start the reveal is not_started", async () => {
    expect(await outcomeOf(ok(false))).toEqual({
      status: "failed",
      name: NAME,
      failure: { kind: "not_started" },
    });
  });

  test("the wire kinds map to the failure texts the screen shows", async () => {
    const cases: readonly (readonly [SecretCommandError, RevealFailure])[] = [
      [{ kind: "reauthRequired" }, { kind: "reauth_expired" }],
      [{ kind: "notFound" }, { kind: "not_found" }],
      [{ kind: "unsupported" }, { kind: "unavailable" }],
      [{ kind: "failed" }, { kind: "failed" }],
      [{ kind: "offline" }, { kind: "failed" }],
    ];
    const outcomes = await Promise.all(cases.map(([error]) => outcomeOf(err(error))));
    expect(outcomes).toEqual(
      cases.map(([, failure]) => ({ status: "failed", name: NAME, failure })),
    );
  });
});
