import { describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { promptText, selectOsAuth } from "../src/os-auth.ts";
import type { ProcessRunner, RunRequest } from "../src/providers/process.ts";
import { fakeOsAuth, memorySecrets } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

// M3-m2c-01. macOS os-auth: 코드와 가짜 provider 시험. 실제 Touch ID와 암호 대화상자는 macOS 사용자 묶음에서 확인한다.

const HANDLE = handleOf("github-token");

function runnerOf(result: { exitCode: number; stderr: string } | "cancelled" | { code: string }): {
  readonly runner: ProcessRunner;
  readonly requests: RunRequest[];
} {
  const requests: RunRequest[] = [];
  const runner: ProcessRunner = (request) => {
    requests.push(request);
    if (result === "cancelled") return Promise.resolve(err({ kind: "cancelled" as const }));
    if ("code" in result) {
      return Promise.resolve(err({ kind: "spawn_failed" as const, code: result.code }));
    }
    return Promise.resolve(
      ok({ exitCode: result.exitCode, stdout: new Uint8Array(), stderr: result.stderr }),
    );
  };
  return { runner, requests };
}

function darwin(
  result: Parameters<typeof runnerOf>[0],
  exists = true,
): ReturnType<typeof runnerOf> & {
  readonly provider: NonNullable<ReturnType<typeof selectOsAuth>>;
  readonly clock: ReturnType<typeof manualClock>;
} {
  const clock = manualClock();
  const run = runnerOf(result);
  const provider = selectOsAuth({
    platform: "darwin",
    runner: run.runner,
    clock,
    pathExists: () => exists,
    env: { PATH: "/usr/bin" },
  });
  if (provider === undefined) throw new Error("darwin must have an os-auth provider");
  return { ...run, provider, clock };
}

const signal = new AbortController().signal;

describe("macOS os-auth provider", () => {
  test("a successful dialog yields an os-auth proof stamped with the clock", async () => {
    const { provider, requests, clock } = darwin({ exitCode: 0, stderr: "" });
    clock.advance(5000);
    const proof = await provider.verify("Reveal github-token", signal);
    expect(proof).toEqual({ ok: true, value: { method: "os-auth", verifiedAt: clock.now() } });
    expect(requests.length).toBe(1);
    expect(requests[0]?.argv.slice(0, 2)).toEqual(["/usr/bin/osascript", "-e"]);
    expect(requests[0]?.argv[2]).toBe(
      'do shell script "true" with prompt "Reveal github-token" with administrator privileges',
    );
    // 출력은 필요 없고 버린다
    expect(requests[0]?.discardStdout).toBe(true);
  });

  test("a closed dialog is cancelled and a rejected credential is denied", async () => {
    const closed = darwin({ exitCode: 1, stderr: "execution error: User canceled. (-128)" });
    expect(await closed.provider.verify("x", signal)).toEqual({
      ok: false,
      error: { kind: "cancelled" },
    });
    const wrong = darwin({
      exitCode: 1,
      stderr: "execution error: authentication failed (-60007)",
    });
    expect(await wrong.provider.verify("x", signal)).toEqual({
      ok: false,
      error: { kind: "denied" },
    });
  });

  test("spawn failure and abort are reported, a missing osascript is unavailable", async () => {
    const broken = darwin({ code: "ENOENT" });
    expect(await broken.provider.verify("x", signal)).toEqual({
      ok: false,
      error: { kind: "failed", code: "ENOENT" },
    });
    const aborted = darwin("cancelled");
    expect(await aborted.provider.verify("x", signal)).toEqual({
      ok: false,
      error: { kind: "cancelled" },
    });
    const missing = darwin({ exitCode: 0, stderr: "" }, false);
    expect(missing.provider.available()).toBe(false);
    expect(await missing.provider.verify("x", signal)).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
    expect(missing.requests.length).toBe(0);
  });

  test("the dialog text cannot break out of the script string", () => {
    expect(promptText('a" & do shell script "rm -rf ~" & "')).toBe(
      "a & do shell script rm -rf ~ &",
    );
    expect(promptText('\\"\n')).toBe("Xeon");
    expect(promptText("x".repeat(500)).length).toBe(120);
  });

  test("only macOS has a provider", () => {
    const common = {
      runner: runnerOf({ exitCode: 0, stderr: "" }).runner,
      clock: manualClock(),
      pathExists: () => true,
      env: {},
    };
    expect(selectOsAuth({ ...common, platform: "linux" })).toBeUndefined();
    expect(selectOsAuth({ ...common, platform: "win32" })).toBeUndefined();
  });
});

function setup(outcome: Parameters<typeof fakeOsAuth>[0]["outcome"]) {
  const clock = manualClock();
  const secret = fakeValue(seededRandom(7), 24, true);
  const auth = fakeOsAuth({ clock, ...(outcome === undefined ? {} : { outcome }) });
  const mem = memorySecrets({
    clock,
    scheduler: clock,
    ids: fixedLocalIds(),
    secrets: [{ meta: metaOf(), value: secret }],
    osAuthAvailable: auth.available(),
  });
  return { clock, mem, secret, auth };
}

describe("reveal with a fake os-auth provider", () => {
  test("a verified os-auth proof shows the value, and tty-confirm is refused while os-auth is available", async () => {
    const { clock, mem, secret, auth } = setup(undefined);
    const proof = await auth.verify("Reveal github-token", signal);
    expect(proof.ok).toBe(true);
    if (!proof.ok) return;
    let shown = "";
    const revealed = await mem.admin.reveal(HANDLE, proof.value, (view) => {
      shown = view.text();
      return Promise.resolve();
    });
    expect(revealed).toEqual({ ok: true, value: undefined });
    expect(shown === secret).toBe(true);
    expect(mem.auditRecords().filter((r) => r.type === "secret.revealed")).toEqual([
      {
        type: "secret.revealed",
        handle: HANDLE,
        reauth: "os-auth",
        actor: "human",
        at: clock.now(),
      },
    ]);

    let calls = 0;
    const viaTty = await mem.admin.reveal(
      HANDLE,
      { method: "tty-confirm", verifiedAt: clock.now() },
      () => {
        calls += 1;
        return Promise.resolve();
      },
    );
    expect(viaTty).toEqual({ ok: false, error: { kind: "reauth_required" } });
    expect(calls).toBe(0);
  });

  test("a cancelled or denied dialog yields no proof, so nothing can be revealed", async () => {
    const outcomes = [{ kind: "cancelled" }, { kind: "denied" }] as const;
    const results = await Promise.all(
      outcomes.map((outcome) => setup(outcome).auth.verify("Reveal", signal)),
    );
    expect(results).toEqual(outcomes.map((outcome) => ({ ok: false, error: outcome })));
  });

  test("an os-auth proof older than 60 seconds is refused", async () => {
    const { clock, mem, auth } = setup(undefined);
    const proof = await auth.verify("Reveal", signal);
    if (!proof.ok) throw new Error("expected a proof");
    clock.advance(61_000);
    const late = await mem.admin.reveal(HANDLE, proof.value, () => Promise.resolve());
    expect(late).toEqual({ ok: false, error: { kind: "reauth_required" } });
  });
});
