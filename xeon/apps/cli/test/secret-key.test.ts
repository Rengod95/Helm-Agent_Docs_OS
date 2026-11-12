import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { fakeSecrets, type FakeSecretStore } from "./support/secrets.ts";

// L4.cli.spec §4.7, L0.secrets.spec §4.7 (b)·(c). `secret key status|use`와 `secret add`의 앱 파일 폴백 확인.
// 열쇠 저장소는 가짜다. 값은 어느 출력과 요청에도 없어야 한다.

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const VALUE = "Zq7-very-secret-0123456789-abcdef!";
const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;

interface Setup {
  readonly h: Harness;
  readonly secrets: FakeSecretStore;
}

function setup(
  options: Parameters<typeof createHarness>[0] = {},
  failures: Parameters<typeof fakeSecrets>[2] = {},
): Setup {
  const ref: { h?: Harness } = {};
  const secrets = fakeSecrets(
    () => {
      if (ref.h === undefined) throw new Error("harness is not ready");
      return ref.h;
    },
    [],
    failures,
  );
  const h = createHarness({
    env: { NO_COLOR: "1" },
    ...options,
    server: { ...options.server, handlers: secrets.handlers },
  });
  ref.h = h;
  harnesses.push(h);
  return { h, secrets };
}

/** 값이 어느 출력과 요청에도 없다는 검사: 원문, base64, hex */
function expectNoValue(s: Setup, value: string = VALUE): void {
  const bytes = new TextEncoder().encode(value);
  const forms = [value, Buffer.from(bytes).toString("base64"), Buffer.from(bytes).toString("hex")];
  const haystack = [
    s.h.stdoutText(),
    s.h.stderrText(),
    JSON.stringify(s.h.server().requests),
    JSON.stringify(s.h.observed),
  ].join("\n");
  for (const form of forms) expect(haystack).not.toContain(form);
}

// ── secret key status ────────────────────────────────────────────────────

test("secret key status says that no key exists yet, and what the setting and the keychain are", async () => {
  const s = setup({}, { fallbackUnconfirmed: true });
  expect(await s.h.run(["secret", "key", "status"])).toBe(EXIT.ok);
  const out = s.h.stdoutText();
  expect(out).toContain("열쇠 위치: 아직 없다. 첫 키 등록 때 만든다");
  expect(out).toContain("설정 l0.secrets.ageKey.source: auto");
  expect(out).toContain("OS 키 저장소: 이 컴퓨터에서 쓸 수 없다");
  expect(out).toContain("자동 선택이 앱 파일로 떨어졌고 아직 확인하지 않았다");
  expect(s.h.stderrText()).toBe("");
  expectNoValue(s);
});

test("secret key status names the app file the key is in", async () => {
  const s = setup({});
  s.secrets.keyState.in = "file";
  s.secrets.keyState.source = "file";
  expect(await s.h.run(["secret", "key", "status"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toContain("열쇠 위치: 앱 파일 (/cfg/secrets/age/keys.txt)");
  expect(s.h.stdoutText()).toContain("설정 l0.secrets.ageKey.source: file");
});

test("secret key status names a key file the setting points to that is missing", async () => {
  const s = setup({});
  s.secrets.keyState.fileMissing = true;
  s.secrets.keyState.source = "file";
  expect(await s.h.run(["secret", "key", "status"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toContain("설정이 가리키는 열쇠 파일이 없다: /cfg/secrets/age/keys.txt");
});

test("secret key status with an extra argument is a usage error and asks the host nothing", async () => {
  const s = setup({});
  expect(await s.h.run(["secret", "key", "status", "extra"])).toBe(EXIT.usage);
  expect(s.h.stdoutText()).toBe("");
  expect(s.h.stderrText()).toContain("fresnel secret key status");
});

// ── secret key use ───────────────────────────────────────────────────────

test("secret key use file moves a key that is in the OS key store and says so", async () => {
  const s = setup({});
  s.secrets.keyState.in = "keychain";
  s.secrets.keyState.source = "keychain";
  expect(await s.h.run(["secret", "key", "use", "file"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toBe("열쇠를 앱 파일로 옮겼다\n");
  expect(s.h.stderrText()).toBe("");
  expect(s.secrets.keyMoves).toEqual(["file"]);
  expect(s.secrets.keyState).toMatchObject({ in: "file", source: "file" });
});

test("secret key use to the place the key already is says it is already kept there", async () => {
  const s = setup({});
  s.secrets.keyState.in = "file";
  expect(await s.h.run(["secret", "key", "use", "file"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toBe("이미 앱 파일에 보관한다\n");
  expect(s.secrets.keyMoves).toEqual(["file"]);
});

test("secret key use with no key to move only changes the setting, and the next key is made that way", async () => {
  const s = setup({});
  expect(await s.h.run(["secret", "key", "use", "keychain"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toBe(
    "옮길 열쇠가 없어 설정만 바꿨다. 다음 키 등록 때 OS 키 저장소에 만든다\n",
  );
  expect(s.secrets.keyState.in).toBe("none");
  expect(s.secrets.keyState.source).toBe("keychain");
});

test("secret key use warns on stderr when the old key could not be removed (two places now)", async () => {
  const s = setup({}, { keyOldKept: true });
  s.secrets.keyState.in = "keychain";
  expect(await s.h.run(["secret", "key", "use", "file"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toBe("열쇠를 앱 파일로 옮겼다\n");
  expect(s.h.stderrText()).toContain("두 곳에 남아 있다");
});

test("secret key use from another computer is refused with a sentence that says to run it on the holder, and moves nothing", async () => {
  const s = setup({}, { keyMoveRefused: true });
  s.secrets.keyState.in = "keychain";
  expect(await s.h.run(["secret", "key", "use", "file"])).toBe(EXIT.error);
  expect(s.h.stdoutText()).toBe("");
  expect(s.h.stderrText()).toContain("fresnel: 이 컴퓨터에서만 열쇠를 옮길 수 있어요");
  expect(s.h.stderrText()).toContain("fresnel-code: service_local_only");
  expect(s.secrets.keyState.in).toBe("keychain");
});

test("secret key use without a target, or with another target, is a usage error and moves nothing", async () => {
  const s = setup({});
  expect(await s.h.run(["secret", "key", "use"])).toBe(EXIT.usage);
  expect(s.h.stderrText()).toContain("secret key use에는 방식이 필요하다");
  expect(await s.h.run(["secret", "key", "use", "op"])).toBe(EXIT.usage);
  expect(s.h.stderrText()).toContain("열쇠 보관 방식은 keychain 또는 file만 된다");
  expect(s.secrets.keyMoves).toEqual([]);
});

test("secret key with no or an unknown subcommand is a usage error", async () => {
  const s = setup({});
  expect(await s.h.run(["secret", "key"])).toBe(EXIT.usage);
  expect(await s.h.run(["secret", "key", "rotate"])).toBe(EXIT.usage);
  expect(s.secrets.keyMoves).toEqual([]);
});

// ── secret add: 앱 파일 폴백의 사람 확인 없음 ─────────────────────────────

test("secret add on a terminal asks once when the OS key store is unusable, and yes keeps the same value in the app file", async () => {
  const s = setup(
    { terminal: TTY, secretInputs: [VALUE, VALUE], lines: ["y"] },
    {
      fallbackUnconfirmed: true,
    },
  );
  expect(await s.h.run(["secret", "add", "github-token"])).toBe(EXIT.ok);
  // 값은 한 번만 물었고, 다시 시도할 때 같은 값을 쓴다
  expect(new TextDecoder().decode(s.secrets.stored.get("github-token"))).toBe(VALUE);
  expect(s.secrets.keyMoves).toEqual(["file"]);
  expect(s.secrets.beginEntryCalls).toHaveLength(2);
  expect(s.h.stdoutText()).toBe("github-token: 등록했다\n");
  expectNoValue(s);
  expect(s.h.outOfBand.pending()).toBe(0);
});

test("secret add on a terminal answered no stores nothing, moves nothing, and exits 1", async () => {
  const s = setup(
    { terminal: TTY, secretInputs: [VALUE, VALUE], lines: ["n"] },
    {
      fallbackUnconfirmed: true,
    },
  );
  expect(await s.h.run(["secret", "add", "github-token"])).toBe(EXIT.error);
  expect(s.h.stderrText()).toContain("이 컴퓨터에서는 OS 키 저장소를 쓸 수 없어요");
  expect(s.h.stderrText()).toContain(
    "해결: `fresnel secret key use file`로 앱 파일 보관을 직접 정해요",
  );
  expect(s.h.stderrText()).toContain("fresnel-code: key_fallback_unconfirmed");
  expect(s.secrets.keyMoves).toEqual([]);
  expect(s.secrets.stored.size).toBe(0);
  expect(s.secrets.beginEntryCalls).toHaveLength(1);
  expectNoValue(s);
});

test("secret add without a terminal does not ask: it fails with the fix and stores nothing", async () => {
  const s = setup({ stdin: `${VALUE}\n`, lines: ["y"] }, { fallbackUnconfirmed: true });
  expect(await s.h.run(["secret", "add", "github-token"])).toBe(EXIT.environment);
  expect(s.h.stderrText()).toContain("fresnel: 이 컴퓨터에서는 OS 키 저장소를 쓸 수 없어요");
  expect(s.h.stderrText()).toContain(
    "해결: `fresnel secret key use file`로 앱 파일 보관을 직접 정해요",
  );
  expect(s.h.stderrText()).toContain("fresnel-code: key_fallback_unconfirmed");
  expect(s.h.stdoutText()).not.toContain("앱 파일에 보관할까요");
  expect(s.secrets.keyMoves).toEqual([]);
  expect(s.secrets.stored.size).toBe(0);
  expectNoValue(s);
});
