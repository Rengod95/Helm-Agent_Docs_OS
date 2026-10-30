import { describe, expect, test } from "bun:test";
import { err, ok, parse, type Scheduler } from "@xeon/contracts";
import { SecretNameSchema, type SecretName } from "@xeon/contracts/capabilities";
import { wireError, type WireParams, type WireResult } from "@xeon/contracts/wire";
import {
  createSecretReveal,
  revealViaWire,
  type RevealConnection,
  type RevealFailure,
  type RevealState,
  type SecretRevealPort,
} from "../../src/settings/index.ts";

// X8 (review.m3b-plan §1.1, UC-6): 비밀 view-model이 재인증 결과를 받아 값 상태로 바뀐다. 화면(탭)은 M4라 이 시험은 view-model과 가짜 재인증
// 포트로 확인한다. 값은 가짜다(실제 키를 쓰지 않는다).

const FAKE = "fake-secret-for-tests-0001";
const NAME = ((): SecretName => {
  const parsed = parse(SecretNameSchema, "exa-api-key");
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
})();

/** 시험이 시간을 직접 흘리는 스케줄러 */
function manualScheduler(): Scheduler & { fire(): void; pending(): number } {
  const timers = new Map<number, () => void>();
  let next = 1;
  return {
    setTimeout(fn) {
      const id = next;
      next += 1;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    fire() {
      const due = Array.from(timers.values());
      timers.clear();
      for (const fn of due) fn();
    },
    pending: () => timers.size,
  };
}

function succeedingPort(): { port: SecretRevealPort; bytes: Uint8Array; calls: () => number } {
  const bytes = new TextEncoder().encode(FAKE);
  const state = { calls: 0 };
  return {
    bytes,
    calls: () => state.calls,
    port: {
      reveal: () => {
        state.calls += 1;
        return Promise.resolve(ok({ kind: "value", bytes }));
      },
    },
  };
}

function failingPort(failure: RevealFailure): SecretRevealPort {
  return { reveal: () => Promise.resolve(err(failure)) };
}

function statuses(): { seen: RevealState["status"][]; listener: (state: RevealState) => void } {
  const seen: RevealState["status"][] = [];
  return { seen, listener: (state) => seen.push(state.status) };
}

describe("X8 secret view-model after a fake re-auth", () => {
  test("holds the value after the re-auth succeeds, and walks hidden -> reauth -> revealed", async () => {
    const { port, bytes } = succeedingPort();
    const reveal = createSecretReveal({ port, scheduler: manualScheduler() });
    const watch = statuses();
    reveal.subscribe(watch.listener);
    expect(reveal.state()).toEqual({ status: "hidden" });
    await reveal.reveal(NAME);
    const state = reveal.state();
    if (state.status !== "revealed" || state.value === null) throw new Error("expected a value");
    expect(state.name).toBe(NAME);
    expect(new TextDecoder().decode(state.value.read())).toBe(FAKE);
    expect(state.value.length).toBe(bytes.length);
    expect(watch.seen).toEqual(["reauth", "revealed"]);
  });

  test("holds no value after the re-auth fails, whatever the reason", async () => {
    const reasons: readonly RevealFailure[] = [
      { kind: "reauth_denied" },
      { kind: "reauth_expired" },
      { kind: "unavailable" },
      { kind: "not_found" },
      { kind: "failed" },
    ];
    await Promise.all(
      reasons.map(async (failure) => {
        const reveal = createSecretReveal({
          port: failingPort(failure),
          scheduler: manualScheduler(),
        });
        await reveal.reveal(NAME);
        expect(reveal.state()).toEqual({ status: "failed", name: NAME, failure });
      }),
    );
  });

  test("a port that throws leaves a failed state with no value", async () => {
    const reveal = createSecretReveal({
      port: {
        reveal: () => Promise.reject(new Error(`reveal exploded near ${FAKE}`)),
      },
      scheduler: manualScheduler(),
    });
    await reveal.reveal(NAME);
    expect(reveal.state()).toEqual({ status: "failed", name: NAME, failure: { kind: "failed" } });
    expect(JSON.stringify(reveal.state())).not.toContain(FAKE);
  });

  test("the serialized state never contains the value, and clear() wipes the bytes", async () => {
    const { port, bytes } = succeedingPort();
    const reveal = createSecretReveal({ port, scheduler: manualScheduler() });
    await reveal.reveal(NAME);
    expect(JSON.stringify(reveal.state())).not.toContain(FAKE);
    reveal.hide();
    expect(reveal.state()).toEqual({ status: "hidden" });
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  test("the value hides itself when the visible time passes", async () => {
    const scheduler = manualScheduler();
    const { port, bytes } = succeedingPort();
    const reveal = createSecretReveal({ port, scheduler });
    await reveal.reveal(NAME);
    expect(scheduler.pending()).toBe(1);
    scheduler.fire();
    expect(reveal.state()).toEqual({ status: "hidden" });
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  test("a second request while the re-auth is pending does not call the port again", async () => {
    const calls = { n: 0 };
    const gate: { open: () => void } = { open: () => {} };
    const reveal = createSecretReveal({
      port: {
        reveal: async () => {
          calls.n += 1;
          await new Promise<void>((resolve) => {
            gate.open = resolve;
          });
          return err({ kind: "reauth_denied" } as const);
        },
      },
      scheduler: manualScheduler(),
    });
    const first = reveal.reveal(NAME);
    await reveal.reveal(NAME);
    expect(reveal.state().status).toBe("reauth");
    gate.open();
    await first;
    expect(calls.n).toBe(1);
    expect(reveal.state().status).toBe("failed");
  });

  test("a failed re-auth after a shown value drops the old value first", async () => {
    const scheduler = manualScheduler();
    const first = succeedingPort();
    let port: SecretRevealPort = first.port;
    const reveal = createSecretReveal({ port: { reveal: (name) => port.reveal(name) }, scheduler });
    await reveal.reveal(NAME);
    port = failingPort({ kind: "reauth_denied" });
    await reveal.reveal(NAME);
    expect(reveal.state().status).toBe("failed");
    expect(first.bytes.every((byte) => byte === 0)).toBe(true);
    expect(scheduler.pending()).toBe(0);
  });
});

function connection(
  answer: (params: WireParams<"secret.beginReveal">) => Promise<WireResult<"secret.beginReveal">>,
): RevealConnection {
  return { request: (_method, params) => answer(params) };
}

describe("X8 wire adapter (the host shows the value, the view-model gets none)", () => {
  test("started: true becomes a revealed state with no value", async () => {
    const reveal = createSecretReveal({
      port: revealViaWire(connection(() => Promise.resolve({ started: true }))),
      scheduler: manualScheduler(),
    });
    await reveal.reveal(NAME);
    expect(reveal.state()).toEqual({ status: "revealed", name: NAME, value: null });
  });

  test("started: false and a missing secret become failures", async () => {
    const notStarted = createSecretReveal({
      port: revealViaWire(connection(() => Promise.resolve({ started: false }))),
      scheduler: manualScheduler(),
    });
    await notStarted.reveal(NAME);
    expect(notStarted.state()).toEqual({
      status: "failed",
      name: NAME,
      failure: { kind: "not_started" },
    });
    const missing = createSecretReveal({
      port: revealViaWire(
        connection(() =>
          Promise.reject(wireError("secret.notFound", { details: { where: "meta" } })),
        ),
      ),
      scheduler: manualScheduler(),
    });
    await missing.reveal(NAME);
    expect(missing.state()).toEqual({
      status: "failed",
      name: NAME,
      failure: { kind: "not_found" },
    });
  });
});
