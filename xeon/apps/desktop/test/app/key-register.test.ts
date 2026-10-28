import { afterEach, describe, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { SecretNameSchema } from "@xeon/contracts/capabilities";
import { mockIPC } from "@tauri-apps/api/mocks";
import { submitKey, type KeyField, type KeyOutcome } from "@xeon/client/settings";
import { rejectLikeShell, tauriMockIpc } from "../transport/tauri-mock.ts";
import { engineFake, makeAppOver, until } from "./support.ts";

// 키 등록의 앱 쪽 흐름(L4.desktop.spec §4.14.1): 실제 createApp과 ipc.ts를 mockIPC 위에서 돌린다.
// 입력란 -> submitKey -> commands.setup.registerKey -> ipc.registerSecret -> invoke("secret_register", 원시 바이트).
// 값은 가짜다. 값이 상태, 로그, wire에 없고 셸로 가는 본문 바이트는 호출이 끝난 뒤 0이어야 한다.

const FAKE = "fake-key-for-tests-0002";
const name = (() => {
  const parsed = parse(SecretNameSchema, "anthropic-api-key");
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
})();

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function inputOf(initial: string): { field: KeyField; shown: () => string } {
  const state = { value: initial };
  return {
    field: {
      take: () => {
        const typed = state.value;
        state.value = "";
        return typed;
      },
    },
    shown: () => state.value,
  };
}

async function liveApp(fake: ReturnType<typeof engineFake> = engineFake()) {
  const shell = tauriMockIpc(fake.fake);
  disposers.push(shell.dispose);
  const app = makeAppOver(shell.ipc);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { ...fake, shell, app };
}

describe("registering a model key from the settings screen", () => {
  test("the value reaches the shell command as raw bytes only, and is nowhere else", async () => {
    const { fake, shell, app, params, methods } = await liveApp();
    const input = inputOf(`${FAKE}\n`);
    const outcome = await submitKey(app.commands.setup, name, "add", input.field);
    expect(outcome).toEqual({ kind: "registered" });
    expect(input.shown()).toBe("");

    // 셸 명령은 하나이고 본문은 `<동작> <이름>\n<값>`이다. 보낸 뒤 그 버퍼는 0이다
    expect(fake.registered).toEqual([{ name: "anthropic-api-key", action: "add", text: FAKE }]);
    const calls = shell.calls.filter((c) => c.cmd === "secret_register");
    expect(calls.length).toBe(1);
    const sent = calls[0]?.args;
    expect(sent instanceof Uint8Array).toBe(true);
    expect([...(sent instanceof Uint8Array ? sent : [1])].every((byte) => byte === 0)).toBe(true);

    // 값을 실을 수 있는 다른 곳: wire 요청, 호출 목록의 다른 인자, 화면 상태, 엔진 거울, 로그
    expect(JSON.stringify(params)).not.toContain(FAKE);
    expect(methods).not.toContain("secret.put");
    expect(JSON.stringify(shell.calls.filter((c) => c.cmd !== "secret_register"))).not.toContain(
      FAKE,
    );
    expect(JSON.stringify(app.ui.read.getState())).not.toContain(FAKE);
    expect(JSON.stringify(app.engine.read.getState())).not.toContain(FAKE);
    expect(JSON.stringify(app.log.lines())).not.toContain(FAKE);
    await app.stop();
  });

  test("an existing key is replaced with the set action", async () => {
    const { fake, app } = await liveApp();
    await submitKey(app.commands.setup, name, "set", inputOf(FAKE).field);
    expect(fake.registered.map((r) => r.action)).toEqual(["set"]);
    await app.stop();
  });

  test("a rejection from the CLI process shows its message and keeps the value out of every result", async () => {
    const { app } = await liveApp(
      engineFake(undefined, undefined, {
        registerError: {
          kind: "rejected",
          exitCode: 1,
          detail: "비밀 제공자(sops)를 쓸 수 없다 (not_registered)",
        },
      }),
    );
    const outcome = await submitKey(app.commands.setup, name, "add", inputOf(FAKE).field);
    expect(outcome).toEqual({
      kind: "failed",
      text: "키를 저장하지 못했습니다. 비밀 제공자(sops)를 쓸 수 없다 (not_registered)",
    });
    expect(JSON.stringify(outcome)).not.toContain(FAKE);
    await app.stop();
  });
});

describe("shell errors on the page side", () => {
  const cases: readonly {
    readonly label: string;
    readonly reject: unknown;
    readonly outcome: KeyOutcome;
  }[] = [
    {
      label: "no sidecar to run",
      reject: { kind: "unavailable", detail: "x" },
      outcome: { kind: "terminal" },
    },
    {
      label: "a second registration at once",
      reject: { kind: "busy" },
      outcome: { kind: "failed", text: "다른 키 등록이 진행 중입니다. 끝난 뒤 다시 시도하세요." },
    },
    {
      label: "a child that never ends",
      reject: { kind: "timeout" },
      outcome: { kind: "failed", text: "키 등록이 시간 안에 끝나지 않았습니다. 다시 시도하세요." },
    },
    {
      label: "a request the shell rejected as malformed",
      reject: { kind: "bad-request" },
      outcome: { kind: "failed", text: "키 등록 요청에 실패했습니다." },
    },
    {
      label: "a string rejection",
      reject: "some-code",
      outcome: { kind: "failed", text: "키 등록 요청에 실패했습니다." },
    },
    {
      label: "an object of an unknown shape",
      reject: { kind: "exploded", value: FAKE },
      outcome: { kind: "failed", text: "키 등록 요청에 실패했습니다." },
    },
  ];
  for (const item of cases) {
    test(`${item.label} becomes ${JSON.stringify(item.outcome)}`, async () => {
      const { app } = await liveApp();
      // 연결이 선 뒤에 셸 대역을 이 시험의 거부로 바꾼다
      mockIPC((cmd) =>
        cmd === "secret_register" ? rejectLikeShell(item.reject) : Promise.resolve(null),
      );
      const outcome = await submitKey(app.commands.setup, name, "add", inputOf(FAKE).field);
      expect(outcome).toEqual(item.outcome);
      expect(JSON.stringify(outcome)).not.toContain(FAKE);
      await app.stop();
    });
  }
});
