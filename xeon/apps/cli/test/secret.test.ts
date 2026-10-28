import { createHash } from "node:crypto";
import { afterEach, expect, test } from "bun:test";
import { wireError, type SecretListEntry, type SecretReferencesResult } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import { secretName, threadId } from "./support/ids.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { fakeSecrets, type FakeSecretStore } from "./support/secrets.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const VALUE = "Zq7-very-secret-0123456789-abcdef!";
const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;

function entry(name: string, status: SecretListEntry["status"] = "valid"): SecretListEntry {
  return {
    name: secretName(name),
    status,
    meta: {
      name: secretName(name),
      desc: `${name} 설명`,
      provider: "sops",
      ref: `dev/${name.toUpperCase()}`,
      scope: "user",
      expiresAt: "2027-01-01",
      use: { modes: ["runtime-http"], tools: ["http.request"], hosts: ["api.example.com"] },
      approval: "per-session",
      ttlSeconds: 300,
      maxUses: 10,
    },
  };
}

interface Setup {
  readonly h: Harness;
  readonly secrets: FakeSecretStore;
}

function setup(
  options: Parameters<typeof createHarness>[0] = {},
  initial: readonly SecretListEntry[] = [],
  failures: Parameters<typeof fakeSecrets>[2] = {},
  references: Readonly<Record<string, SecretReferencesResult>> = {},
): Setup {
  const ref: { h?: Harness } = {};
  const secrets = fakeSecrets(
    () => {
      if (ref.h === undefined) throw new Error("harness is not ready");
      return ref.h;
    },
    initial,
    failures,
    references,
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

test("secret add reads the value from stdin, drops one trailing newline, and hands it over out of band", async () => {
  const s = setup({ stdin: `${VALUE}\n` });
  expect(await s.h.run(["secret", "add", "github-token"])).toBe(EXIT.ok);
  expect(new TextDecoder().decode(s.secrets.stored.get("github-token"))).toBe(VALUE);
  expect(s.secrets.beginEntryCalls).toEqual([{ name: "github-token", action: "add" }]);
  expect(s.h.stdoutText()).toBe("github-token: 등록했다\n");
  expectNoValue(s);
  // 맡긴 수단은 쓰인 뒤 모두 거두어졌다
  expect(s.h.outOfBand.pending()).toBe(0);
});

test("the CLI's copy of the value is overwritten with zeros after the host took it", async () => {
  const s = setup({ stdin: VALUE });
  expect(await s.h.run(["secret", "add", "github-token"])).toBe(EXIT.ok);
  expect(s.secrets.received).toHaveLength(1);
  expect(s.secrets.received[0]?.every((byte) => byte === 0)).toBe(true);
});

test("secret add on a terminal asks twice without echo and compares", async () => {
  const s = setup({ terminal: TTY, secretInputs: [VALUE, VALUE] });
  expect(await s.h.run(["secret", "add", "github-token"])).toBe(EXIT.ok);
  expect(new TextDecoder().decode(s.secrets.stored.get("github-token"))).toBe(VALUE);
  expectNoValue(s);
});

test("two different entries store nothing and exit 1", async () => {
  const s = setup({ terminal: TTY, secretInputs: [VALUE, `${VALUE}x`] });
  expect(await s.h.run(["secret", "add", "github-token"])).toBe(EXIT.error);
  expect(s.h.stderrText()).toContain("두 번 입력한 값이 다르다");
  expect(s.secrets.stored.size).toBe(0);
  expectNoValue(s);
  expectNoValue(s, `${VALUE}x`);
});

test("cancelling the prompt (Ctrl+C / Ctrl+D) stores nothing", async () => {
  const s = setup({ terminal: TTY, secretInputs: [null] });
  expect(await s.h.run(["secret", "add", "github-token"])).toBe(EXIT.error);
  expect(s.h.stderrText()).toContain("입력을 취소했다");
});

test("an empty value from stdin is a usage error", async () => {
  const s = setup({ stdin: "\n" });
  expect(await s.h.run(["secret", "add", "github-token"])).toBe(EXIT.usage);
  expect(s.h.stderrText()).toContain("값이 비어 있다");
});

test("a value over 64 KiB on stdin is refused", async () => {
  const s = setup({ stdin: "x".repeat(70 * 1024) });
  expect(await s.h.run(["secret", "add", "github-token"])).toBe(EXIT.usage);
  expect(s.h.stderrText()).toContain("너무 크다");
});

test("secret set replaces a value; secret rotate needs a terminal", async () => {
  const set = setup({ stdin: VALUE }, [entry("github-token")]);
  expect(await set.h.run(["secret", "set", "github-token"])).toBe(EXIT.ok);
  expect(set.h.stdoutText()).toBe("github-token: 값을 바꿨다\n");

  const piped = setup({ stdin: VALUE }, [entry("github-token")]);
  expect(await piped.h.run(["secret", "rotate", "github-token"])).toBe(EXIT.usage);
  expect(piped.h.stderrText()).toContain("터미널에서만");
  expect(piped.h.closed()).toBe(false);

  const tty = setup({ terminal: TTY, secretInputs: [VALUE, VALUE] }, [entry("github-token")]);
  expect(await tty.h.run(["secret", "rotate", "github-token"])).toBe(EXIT.ok);
  expect(tty.secrets.beginEntryCalls).toEqual([{ name: "github-token", action: "rotate" }]);
  expect(tty.h.stdoutText()).toBe("github-token: 값을 교체했다\n");
});

test("secret add with metadata flags applies them through secret.meta after the value is stored", async () => {
  const s = setup({ stdin: VALUE });
  expect(
    await s.h.run([
      "secret",
      "add",
      "api-key",
      "--desc",
      "결제 API",
      "--expires",
      "2027-06-30",
      "--hosts",
      "api.example.com,*.example.org",
      "--scope",
      "user",
    ]),
  ).toBe(EXIT.ok);
  expect(s.secrets.metaCalls).toHaveLength(1);
  expect(s.secrets.metaCalls[0]).toMatchObject({
    name: "api-key",
    desc: "결제 API",
    expiresAt: "2027-06-30",
    scope: "user",
    use: { hosts: ["api.example.com", "*.example.org"], modes: ["runtime-http"] },
  });
  expectNoValue(s);
});

test("a provider other than sops is refused before connecting", async () => {
  const s = setup({ stdin: VALUE });
  expect(await s.h.run(["secret", "add", "api-key", "--provider", "op"])).toBe(EXIT.usage);
  expect(s.h.closed()).toBe(false);
});

test("secret meta changes metadata only and requires at least one flag", async () => {
  const s = setup({}, [entry("api-key")]);
  expect(await s.h.run(["secret", "meta", "api-key"])).toBe(EXIT.usage);
  expect(s.h.stderrText()).toContain("바꿀 항목이 없다");
  expect(await s.h.run(["secret", "meta", "api-key", "--desc", "새 설명"])).toBe(EXIT.ok);
  expect(s.secrets.metaCalls[0]).toEqual({ name: "api-key", desc: "새 설명" });
  expect(s.h.stdoutText()).toContain("api-key  valid");
});

test("secret ls prints names and statuses; --meta adds metadata; --json is the result object only", async () => {
  const s = setup({}, [entry("api-key"), entry("old-key", "expired")]);
  expect(await s.h.run(["secret", "ls"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toBe("api-key  valid\nold-key  expired\n");

  const meta = setup({}, [entry("api-key")]);
  expect(await meta.h.run(["secret", "ls", "--meta"])).toBe(EXIT.ok);
  expect(meta.h.stdoutText()).toContain("설명: api-key 설명");
  expect(meta.h.stdoutText()).toContain("허용 호스트: api.example.com");

  const json = setup({}, [entry("api-key")]);
  expect(await json.h.run(["secret", "ls", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(json.h.stdoutText())).toMatchObject([{ name: "api-key", status: "valid" }]);
  // 비밀 명령에는 메시지 탭이 붙지 않는다
  expect(json.h.stdoutText()).not.toContain("jsonrpc");
});

test("secret ls with nothing registered says so on stderr", async () => {
  const s = setup();
  expect(await s.h.run(["secret", "ls"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toBe("");
  expect(s.h.stderrText()).toContain("등록된 비밀이 없다");
});

test("secret test shows decryptability, length and the first 8 hex of the SHA-256, never the value", async () => {
  const s = setup({}, [entry("api-key")]);
  s.secrets.stored.set("api-key", new TextEncoder().encode(VALUE));
  const prefix = createHash("sha256").update(VALUE).digest("hex").slice(0, 8);
  expect(await s.h.run(["secret", "test", "api-key"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toBe(
    `api-key: registered (복호화 가능, 길이 ${String(VALUE.length)}바이트, sha256 앞 8자 ${prefix})\n`,
  );
  expect(await s.h.run(["secret", "test", "api-key", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(s.h.stdoutText().split("\n")[1] ?? "")).toEqual({
    name: "api-key",
    state: "registered",
    decryptable: true,
    length: VALUE.length,
    sha256Prefix: prefix,
  });
  expectNoValue(s);
});

test("secret test of a missing secret exits 1; a registered one that cannot be decrypted also exits 1", async () => {
  const s = setup({}, [entry("api-key")]);
  expect(await s.h.run(["secret", "test", "nothing-here", "--json"])).toBe(EXIT.error);
  expect(JSON.parse(s.h.stdoutText())).toEqual({
    name: "nothing-here",
    state: "missing",
    decryptable: false,
    length: null,
    sha256Prefix: null,
  });

  const broken = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      handlers: {
        "secret.test": () => ({
          state: "registered",
          decryptable: false,
          length: null,
          sha256Prefix: null,
        }),
      },
    },
  });
  harnesses.push(broken);
  expect(await broken.run(["secret", "test", "api-key"])).toBe(EXIT.error);
  expect(broken.stdoutText()).toBe("api-key: registered (복호화할 수 없다)\n");
});

test("secret rm --yes removes; without --yes a pipe is refused; a terminal asks first", async () => {
  const yes = setup({}, [entry("api-key")]);
  expect(await yes.h.run(["secret", "rm", "api-key", "--yes"])).toBe(EXIT.ok);
  expect(yes.h.stdoutText()).toBe("api-key: 지웠다\n");

  const piped = setup({}, [entry("api-key")]);
  expect(await piped.h.run(["secret", "rm", "api-key"])).toBe(EXIT.usage);
  expect(piped.h.closed()).toBe(false);

  const asked: string[] = [];
  const tty = setup(
    {
      terminal: TTY,
      readLine: (prompt) => (asked.push(prompt), Promise.resolve("y")),
    },
    [entry("api-key")],
  );
  expect(await tty.h.run(["secret", "rm", "api-key"])).toBe(EXIT.ok);
  // 참조하는 정책을 먼저 보인 뒤 묻는다
  expect(tty.h.stdoutText()).toContain("허용 도구 http.request / 허용 호스트 api.example.com");
  expect(tty.h.stdoutText()).toContain(
    "api-key: 참조하는 설정 키 없음 / 활성 lease 0개 / 최근 사용한 세션 없음\n",
  );
  expect(asked[0]).toContain("비밀 api-key을(를) 지울까요?");

  const declined = setup({ terminal: TTY, readLine: () => Promise.resolve("") }, [
    entry("api-key"),
  ]);
  expect(await declined.h.run(["secret", "rm", "api-key"])).toBe(EXIT.error);
  expect(declined.h.stderrText()).toContain("지우지 않았다");
});

test("secret rm shows what points at the secret from secret.references before it asks", async () => {
  const asked: string[] = [];
  const refs = {
    "api-key": {
      settingKeys: ["l2.web.search.apiKey", "l1.models.apiKey"],
      activeLeases: 0,
      sessions: [1, 2, 3, 4, 5, 6, 7].map((n) => threadId(n)),
    },
  };
  const s = setup(
    { terminal: TTY, readLine: (prompt) => (asked.push(prompt), Promise.resolve("n")) },
    [entry("api-key")],
    {},
    refs,
  );
  expect(await s.h.run(["secret", "rm", "api-key"])).toBe(EXIT.error);
  expect(s.secrets.referenceCalls).toEqual(["api-key"]);
  expect(s.h.stdoutText()).toContain(
    `api-key: 참조하는 설정 키 l2.web.search.apiKey, l1.models.apiKey / 활성 lease 0개 / 최근 사용한 세션 ${[1, 2, 3, 4, 5].map((n) => threadId(n)).join(", ")} 외 2개\n`,
  );
  expect(asked).toHaveLength(1);
  expect(s.h.server().requests.some((r) => r.method === "secret.remove")).toBe(false);
});

test("secret rm with an active lease explains it and never asks or removes", async () => {
  const asked: string[] = [];
  const s = setup(
    { terminal: TTY, readLine: (prompt) => (asked.push(prompt), Promise.resolve("y")) },
    [entry("api-key")],
    {},
    { "api-key": { settingKeys: [], activeLeases: 2, sessions: [] } },
  );
  expect(await s.h.run(["secret", "rm", "api-key"])).toBe(EXIT.error);
  expect(s.h.stderrText()).toContain("xeon: 사용 중인 비밀이라 지울 수 없다 (활성 lease 2개)");
  expect(asked).toEqual([]);
  expect(s.h.server().requests.some((r) => r.method === "secret.remove")).toBe(false);
});

test("secret rm --yes removes without asking and leaves the references on stderr", async () => {
  const s = setup(
    {},
    [entry("api-key")],
    {},
    {
      "api-key": { settingKeys: ["l2.web.search.apiKey"], activeLeases: 0, sessions: [] },
    },
  );
  expect(await s.h.run(["secret", "rm", "api-key", "--yes"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toBe("api-key: 지웠다\n");
  expect(s.h.stderrText()).toBe(
    "api-key: 참조하는 설정 키 l2.web.search.apiKey / 활성 lease 0개 / 최근 사용한 세션 없음\n",
  );
});

test("secret rm of a secret in use or a missing one maps to readable errors", async () => {
  const busy = setup({}, [entry("api-key")], {
    remove: wireError("internal", { details: { secret: { kind: "in_use", activeLeases: 2 } } }),
  });
  expect(await busy.h.run(["secret", "rm", "api-key", "--yes"])).toBe(EXIT.error);
  expect(busy.h.stderrText()).toContain("사용 중인 비밀이라 지울 수 없다 (활성 lease 2개)");

  const missing = setup();
  expect(await missing.h.run(["secret", "rm", "nothing-here", "--yes"])).toBe(EXIT.error);
  expect(missing.h.stderrText()).toContain("그 이름의 비밀이 없다");
});

test("a missing sops or age is an environment error (exit 3)", async () => {
  const broken = createHarness({
    env: { NO_COLOR: "1" },
    stdin: VALUE,
    server: {
      handlers: {
        "secret.beginEntry": () => {
          throw wireError("internal", {
            details: {
              secret: { kind: "provider_unavailable", provider: "sops", reason: "not_found" },
            },
          });
        },
      },
    },
  });
  harnesses.push(broken);
  expect(await broken.run(["secret", "add", "github-token"])).toBe(EXIT.environment);
  expect(broken.stderrText()).toContain("비밀 제공자(sops)를 쓸 수 없다 (not_found)");
  expect(broken.stderrText()).toContain("sops와 age를 설치하고");
});

test("secret reveal on a pipe is refused as a usage error and never connects", async () => {
  const s = setup({ terminal: { stdinIsTty: true, stdoutIsTty: false } }, [entry("api-key")]);
  expect(await s.h.run(["secret", "reveal", "api-key"])).toBe(EXIT.usage);
  expect(s.h.stderrText()).toContain("secret reveal은 터미널에서만 쓸 수 있다");
  expect(s.h.closed()).toBe(false);
  expect(s.h.stdoutBytes).toEqual([]);

  const noStdin = setup({ terminal: { stdinIsTty: false, stdoutIsTty: true } }, [entry("api-key")]);
  expect(await noStdin.h.run(["secret", "reveal", "api-key"])).toBe(EXIT.usage);
});

test("secret reveal shows the value once on the terminal after the name is typed again", async () => {
  const ref: { h?: Harness } = {};
  const secrets = fakeSecrets(() => {
    if (ref.h === undefined) throw new Error("not ready");
    return ref.h;
  });
  secrets.stored.set("api-key", new TextEncoder().encode(VALUE));
  const h = createHarness({
    env: { NO_COLOR: "1" },
    terminal: TTY,
    readLine: () => Promise.resolve("api-key"),
    server: { handlers: secrets.handlers },
  });
  ref.h = h;
  harnesses.push(h);
  expect(await h.run(["secret", "reveal", "api-key"])).toBe(EXIT.ok);
  // 값은 바이트로 TTY 쪽 스트림에만 나온다. 텍스트 stdout·stderr·요청에는 없다
  const shown = new TextDecoder().decode(Buffer.concat(h.stdoutBytes));
  expect(shown).toBe(`${VALUE}\n`);
  expect(h.stdoutText()).not.toContain(VALUE);
  expect(h.stderrText()).not.toContain(VALUE);
  expect(JSON.stringify(h.server().requests)).not.toContain(VALUE);
  expect(h.outOfBand.pending()).toBe(0);
});

test("secret reveal passes a tty-confirm reauth stamped with the engine clock", async () => {
  const ref: { h?: Harness } = {};
  const seen: { method: string; verifiedAt: number }[] = [];
  const secrets = fakeSecrets(() => {
    if (ref.h === undefined) throw new Error("not ready");
    return ref.h;
  });
  secrets.stored.set("api-key", new TextEncoder().encode(VALUE));
  const base = secrets.handlers["secret.beginReveal"];
  const h = createHarness({
    env: { NO_COLOR: "1" },
    terminal: TTY,
    readLine: () => Promise.resolve("api-key"),
    server: {
      handlers: {
        ...secrets.handlers,
        "secret.beginReveal": (params, server) => {
          const offer = ref.h?.outOfBand.reveals[0];
          if (offer !== undefined) seen.push({ ...offer.reauth });
          return base?.(params, server);
        },
      },
    },
  });
  ref.h = h;
  harnesses.push(h);
  expect(await h.run(["secret", "reveal", "api-key"])).toBe(EXIT.ok);
  expect(seen).toEqual([{ method: "tty-confirm", verifiedAt: h.clock.now() }]);
});

test("a wrong confirmation name cancels the reveal before anything is asked of the host", async () => {
  const s = setup({ terminal: TTY, readLine: () => Promise.resolve("other-name") }, [
    entry("api-key"),
  ]);
  expect(await s.h.run(["secret", "reveal", "api-key"])).toBe(EXIT.error);
  expect(s.h.stderrText()).toContain("확인하지 않아 열람을 취소했다");
  expect(s.h.methods()).not.toContain("secret.beginReveal");
  expect(s.h.stdoutBytes).toEqual([]);
});

test("a reveal the host declines (not started) says so and prints no value", async () => {
  const s = setup({ terminal: TTY, readLine: () => Promise.resolve("api-key") }, [
    entry("api-key"),
  ]);
  expect(await s.h.run(["secret", "reveal", "api-key"])).toBe(EXIT.error);
  expect(s.h.stderrText()).toContain("값을 보이지 않았다");
  expect(s.h.stdoutBytes).toEqual([]);
});
