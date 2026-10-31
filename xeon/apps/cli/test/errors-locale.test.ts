import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@xeon/client/i18n";
import { WireError, wireError } from "@xeon/contracts/wire";
import { AssembleError } from "@xeon/host";
import { invalidRemoteError, serviceConnectErrorOf, startErrorOf } from "../src/engine.ts";
import { failureOfExport, failureOfWire, renderFailure } from "../src/errors.ts";
import { EXIT } from "../src/exit-codes.ts";

// 오류 문장을 영어 로케일에서 전체 문자열로 비교한다. 시험 프로세스의 로케일은 ko이므로 끝나면 되돌린다.

let before: Locale = "ko";

beforeEach(() => {
  before = activeLocale();
  setActiveLocale("en");
});

afterEach(() => {
  setActiveLocale(before);
});

test("the failure block says Fix: and keeps the two-line shape", () => {
  expect(renderFailure({ message: "m", fix: "f" })).toBe("xeon: m\n  Fix: f\n");
});

test("a missing session renders both lines in English", () => {
  const failure = failureOfWire(wireError("thread.notFound", { details: { threadId: "thr_1" } }));
  expect(failure).toEqual({
    message: "Session thr_1 does not exist",
    fix: "Check the session id with xeon sessions ls",
    code: EXIT.error,
  });
  expect(renderFailure(failure)).toBe(
    "xeon: Session thr_1 does not exist\n  Fix: Check the session id with xeon sessions ls\n",
  );
});

test("a secret in use keeps the lease count and names the rotate command", () => {
  expect(failureOfWire(wireError("secret.inUse", { details: { activeLeases: 2 } }))).toEqual({
    message: "The secret is in use and cannot be removed (active leases: 2)",
    fix: "Remove it after use ends. To change only the value, use xeon secret rotate <name>",
    code: EXIT.error,
  });
});

test("a sops hint keeps the braces of the example", () => {
  expect(
    failureOfWire(
      wireError("secret.writeFailed", {
        details: { target: "sops_file", code: "recipient_unknown" },
      }),
    ),
  ).toEqual({
    message: "Could not prepare the default secret file (recipient_unknown)",
    fix: "An age key exists but has no recipient record. If you already use a SOPS file, add { env, path } to l0.secrets.sops.files",
    code: EXIT.environment,
  });
});

test("an extension block names the operation, with or without a reason", () => {
  expect(
    failureOfWire(
      wireError("thread.cancelledByExtension", {
        details: { point: "session.compact.before", reason: "quota exceeded" },
      }),
    ).message,
  ).toBe("An extension blocked the compaction operation: quota exceeded");
  expect(failureOfWire(wireError("thread.cancelledByExtension")).message).toBe(
    "An extension blocked this operation",
  );
  expect(
    failureOfWire(wireError("thread.cancelledByExtension", { details: { point: "x.y.z" } }))
      .message,
  ).toBe("An extension blocked the x.y.z operation");
});

test("an internal error shows the trace id, and an unknown kind keeps the generic line", () => {
  expect(failureOfWire(wireError("internal", { traceId: "trace-1" }))).toEqual({
    message: "Internal error (traceId trace-1)",
    fix: "Run xeon doctor and report the traceId",
    code: EXIT.error,
  });
  const future = new WireError(-32000, "future", { kind: "future.thing", retryable: false });
  expect(failureOfWire(future)).toEqual({
    message: "The engine could not process the request (future.thing)",
    fix: "Report this kind",
    code: EXIT.error,
  });
});

test("an export into a folder that is not empty is a usage error", () => {
  expect(failureOfExport({ kind: "dest_not_empty" })).toEqual({
    message: "The export folder is not empty (nothing was changed)",
    fix: "Choose an empty or new folder",
    code: EXIT.usage,
  });
  expect(failureOfExport({ kind: "foreign_database", applicationId: 1234 }).message).toBe(
    "This is not a Xeon database (application_id 1234)",
  );
});

test("engine start errors are English, and the catalog conflict names the keys", () => {
  expect(
    startErrorOf(
      new AssembleError([{ code: "store", message: "fts5Missing", failure: "unavailable" }]),
    ),
  ).toEqual({
    kind: "fts5Missing",
    message: "SQLite does not have FTS5",
    fix: "Install SQLite with FTS5 (macOS: brew install sqlite)",
  });
  expect(
    startErrorOf(
      new AssembleError([
        {
          code: "catalog",
          issues: [{ code: "duplicateKey", key: "l1.loop.maxSteps", owners: ["a", "b"] }],
        },
      ]),
    ).message,
  ).toBe("Setting key definitions conflict (l1.loop.maxSteps)");
});

test("a missing service socket and an invalid remote flag are English", () => {
  expect(serviceConnectErrorOf({ kind: "not_found", path: "/run/x.sock" })).toEqual({
    kind: "serviceUnreachable",
    message: "The service socket does not exist",
    fix: "Check that the remote service is running and the address is correct",
  });
  expect(
    invalidRemoteError({
      kind: "invalid",
      text: "ftp://box/x",
      from: "flag",
      error: { kind: "unknown_scheme" },
    }),
  ).toEqual({
    kind: "invalidRemote",
    message: "The --remote address has the wrong format: ftp://box/x",
    fix: "Change the --remote value to one of unix:/abs, tcp://host:port, ssh://[user@]host[:port]/abs/socket",
  });
});
