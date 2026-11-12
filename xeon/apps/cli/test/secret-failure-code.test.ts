import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import type { FailureKind } from "@fresnel/contracts/services";
import { wireError, type WireError } from "@fresnel/contracts/wire";
import { failureOfStart, failureOfWire, renderFailure } from "../src/errors.ts";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { fakeSecrets, type FakeSecretFailures } from "./support/secrets.ts";

// 시크릿 명령의 실패는 마지막 줄에 `fresnel-code: <코드>`를 쓴다(L4.cli.spec §4.7). 다른 명령의 실패는 그 줄이 없다.
// 값은 어떤 출력에도 없다.

const VALUE = "Zq7-very-secret-0123456789-abcdef!";
const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;

let before: Locale = "ko";

beforeEach(() => {
  before = activeLocale();
  setActiveLocale("en");
});

afterEach(() => {
  setActiveLocale(before);
});

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function setup(
  options: Parameters<typeof createHarness>[0] = {},
  failures: FakeSecretFailures = {},
): Harness {
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
  return h;
}

/** 마지막 줄이 종류 코드 줄인지 본다. 줄의 글은 코드 하나다 */
function lastLineOf(text: string): string {
  return text.trimEnd().split("\n").at(-1) ?? "";
}

// ── 문구 틀 ──────────────────────────────────────────────────────────────

test("a failure with a kind ends with the code line, after the two-line block", () => {
  expect(renderFailure({ message: "m", fix: "f", kind: "key_store" })).toBe(
    "fresnel: m\n  Fix: f\nfresnel-code: key_store\n",
  );
});

test("a failure without a kind renders exactly the two lines", () => {
  expect(renderFailure({ message: "m", fix: "f" })).toBe("fresnel: m\n  Fix: f\n");
});

// ── 종류 매핑(엔진 쪽) ──────────────────────────────────────────────────

const SECRET_CASES: readonly (readonly [string, WireError, FailureKind])[] = [
  ["a missing secret", wireError("secret.notFound", { details: { where: "meta" } }), "not_found"],
  ["an existing name", wireError("secret.alreadyExists"), "already_exists"],
  [
    "a missing sops binary",
    wireError("secret.providerUnavailable", {
      details: { provider: "sops", reason: "binary_missing" },
    }),
    "sops_missing",
  ],
  [
    "a sops that is too old",
    wireError("secret.providerUnavailable", {
      details: { provider: "sops", reason: "version_too_old" },
    }),
    "sops_version",
  ],
  [
    "a provider with no registration",
    wireError("secret.providerUnavailable", {
      details: { provider: "sops", reason: "not_registered" },
    }),
    "provider_unavailable",
  ],
  [
    "a file key that the OS key store does not back",
    wireError("secret.keyUnavailable", { details: { key: "file", reason: "access_denied" } }),
    "key_store",
  ],
  [
    "a locked keychain",
    wireError("secret.keyUnavailable", { details: { key: "darwin-keychain", reason: "locked" } }),
    "key_store",
  ],
  [
    "a key entry that is missing",
    wireError("secret.keyUnavailable", {
      details: { key: "darwin-keychain", reason: "item_missing" },
    }),
    "key_missing",
  ],
  [
    "a key file with the wrong mode",
    wireError("secret.keyUnavailable", { details: { key: "file", reason: "file_mode" } }),
    "key_file",
  ],
  [
    "a sops file lock that another fresnel holds",
    wireError("secret.writeFailed", { details: { target: "sops_file", code: "lock_timeout" } }),
    "store_busy",
  ],
  [
    "a sops file that cannot be encrypted",
    wireError("secret.writeFailed", {
      details: { target: "sops_file", code: "sops_encrypt_failed" },
    }),
    "provider_unavailable",
  ],
  [
    "a key store write",
    wireError("secret.writeFailed", { details: { target: "key_store", code: "add_failed" } }),
    "key_store",
  ],
  [
    "an age key file write",
    wireError("secret.writeFailed", { details: { target: "key_file", code: "EACCES" } }),
    "key_file",
  ],
  [
    "a write with no known target",
    wireError("secret.writeFailed", { details: { target: "other", code: "EIO" } }),
    "write_failed",
  ],
  [
    "an audit log that cannot be written",
    wireError("secret.auditUnwritable", { details: { code: "EACCES" } }),
    "write_failed",
  ],
  ["a value that cannot be decrypted", wireError("secret.decryptFailed"), "decrypt_failed"],
  [
    "a read-only provider",
    wireError("secret.readOnlyProvider", { details: { provider: "env" } }),
    "read_only_provider",
  ],
  ["a cancelled entry", wireError("secret.cancelled"), "cancelled"],
  ["a secret in use", wireError("secret.inUse", { details: { activeLeases: 1 } }), "unknown"],
  ["a denied confirmation", wireError("secret.denied"), "unknown"],
  ["a busy store", wireError("store.busy"), "store_busy"],
  ["a full disk", wireError("store.diskFull"), "write_failed"],
  [
    "a value shorter than the minimum (the host's -32602 on the value)",
    wireError("jsonrpc.invalidParams", {
      details: { issues: [{ path: "value", message: "value is shorter than 8 bytes" }] },
    }),
    "value_too_short",
  ],
  [
    "invalid params on another field",
    wireError("jsonrpc.invalidParams", {
      details: { issues: [{ path: "name", message: "not a secret name" }] },
    }),
    "unknown",
  ],
  [
    "an engine error outside the vocabulary",
    wireError("thread.notFound", { details: { threadId: "thr_1" } }),
    "unknown",
  ],
];

for (const [label, error, kind] of SECRET_CASES) {
  test(`the secret scope gives ${label} the code ${kind}`, () => {
    expect(failureOfWire(error, "secret").kind).toBe(kind);
  });
}

test("the plain scope gives no kind, so other commands print exactly what they printed before", () => {
  for (const [, error] of SECRET_CASES) {
    const failure = failureOfWire(error, "plain");
    expect(Object.hasOwn(failure, "kind")).toBe(false);
  }
  expect(renderFailure(failureOfWire(wireError("store.busy"), "plain"))).toBe(
    "fresnel: The store is busy with another write\n  Fix: Run again shortly\n",
  );
});

test("an engine start error gets its code in the secret scope only", () => {
  const sops = { kind: "sopsMissing", message: "m", fix: "f" } as const;
  expect(failureOfStart(sops, "secret").kind).toBe("sops_missing");
  expect(failureOfStart({ kind: "storeBusy", message: "m", fix: "f" }, "secret").kind).toBe(
    "store_busy",
  );
  expect(
    failureOfStart({ kind: "serviceUnreachable", message: "m", fix: "f" }, "secret").kind,
  ).toBe("service_unreachable");
  expect(failureOfStart({ kind: "fts5Missing", message: "m", fix: "f" }, "secret").kind).toBe(
    "unknown",
  );
  expect(Object.hasOwn(failureOfStart(sops), "kind")).toBe(false);
});

// ── 실제 명령 ───────────────────────────────────────────────────────────

test("a host that refuses the entry as already existing ends the output with its code and shows no value", async () => {
  const h = setup({ stdin: `${VALUE}\n` }, { beginEntry: wireError("secret.alreadyExists") });
  expect(await h.run(["secret", "add", "github-token"])).toBe(EXIT.error);
  expect(lastLineOf(h.stderrText())).toBe("fresnel-code: already_exists");
  expect(h.stderrText()).not.toContain(VALUE);
  expect(h.stdoutText()).not.toContain(VALUE);
});

test("a missing sops binary on the host is an environment error with the sops_missing code", async () => {
  const h = setup(
    { stdin: `${VALUE}\n` },
    {
      beginEntry: wireError("secret.providerUnavailable", {
        details: { provider: "sops", reason: "binary_missing" },
      }),
    },
  );
  expect(await h.run(["secret", "add", "github-token"])).toBe(EXIT.environment);
  expect(lastLineOf(h.stderrText())).toBe("fresnel-code: sops_missing");
});

test("a key that the OS key store cannot give gets the key_store code", async () => {
  const h = setup(
    { stdin: `${VALUE}\n` },
    {
      beginEntry: wireError("secret.keyUnavailable", {
        details: { key: "file", reason: "access_denied" },
      }),
    },
  );
  expect(await h.run(["secret", "add", "github-token"])).toBe(EXIT.environment);
  expect(lastLineOf(h.stderrText())).toBe("fresnel-code: key_store");
});

test("a value shorter than the minimum gets the value_too_short code", async () => {
  const h = setup(
    { stdin: "short\n" },
    {
      beginEntry: wireError("jsonrpc.invalidParams", {
        details: { issues: [{ path: "value", message: "value is shorter than 8 bytes" }] },
      }),
    },
  );
  expect(await h.run(["secret", "add", "github-token"])).toBe(EXIT.usage);
  expect(lastLineOf(h.stderrText())).toBe("fresnel-code: value_too_short");
});

test("a busy store on the host gets the store_busy code", async () => {
  const h = setup({ stdin: `${VALUE}\n` }, { beginEntry: wireError("store.busy") });
  expect(await h.run(["secret", "add", "github-token"])).toBe(EXIT.error);
  expect(lastLineOf(h.stderrText())).toBe("fresnel-code: store_busy");
});

test("setting a name that does not exist gets not_found", async () => {
  const h = setup({ stdin: `${VALUE}\n` }, { beginEntry: wireError("secret.notFound") });
  expect(await h.run(["secret", "set", "github-token"])).toBe(EXIT.error);
  expect(lastLineOf(h.stderrText())).toBe("fresnel-code: not_found");
  expect(h.stderrText()).not.toContain(VALUE);
});

test("an empty value from stdin gets value_empty, and no value is shown", async () => {
  const h = setup({ stdin: "\n" });
  expect(await h.run(["secret", "add", "github-token"])).toBe(EXIT.usage);
  expect(lastLineOf(h.stderrText())).toBe("fresnel-code: value_empty");
});

test("cancelling the prompt on a terminal gets the cancelled code", async () => {
  const h = setup({ terminal: TTY, secretInputs: [null] });
  expect(await h.run(["secret", "add", "github-token"])).toBe(EXIT.error);
  expect(lastLineOf(h.stderrText())).toBe("fresnel-code: cancelled");
});

test("a value the host cannot take over this computer's local channel is refused as service_local_only", async () => {
  const h = setup({ service: "local", stdin: `${VALUE}\n` }, { refuseChannel: true });
  expect(await h.run(["secret", "add", "github-token"])).toBe(EXIT.error);
  expect(lastLineOf(h.stderrText())).toBe("fresnel-code: service_local_only");
  expect(h.stderrText()).not.toContain(VALUE);
});

test("removing a name that does not exist gets not_found", async () => {
  const h = setup({});
  expect(await h.run(["secret", "rm", "github-token", "--yes"])).toBe(EXIT.error);
  expect(lastLineOf(h.stderrText())).toBe("fresnel-code: not_found");
});

test("a usage error in a secret command has no code line, because it is not an engine failure", async () => {
  const h = setup({ stdin: `${VALUE}\n` });
  expect(await h.run(["secret", "rotate", "github-token"])).toBe(EXIT.usage);
  expect(h.stderrText()).not.toContain("fresnel-code:");
});
