import { describe, expect, test } from "bun:test";
import {
  decide,
  eventKindAllowed,
  secretKeyPartsOf,
  secretNameOf,
  settingKeyAllowed,
} from "../../../src/views/app/index.ts";
import { policyContext } from "./support.ts";

function req(op: Parameters<typeof decide>[0]["op"], args: unknown): Parameters<typeof decide>[0] {
  return { v: 1, id: 1, op, args };
}

describe("bridge policy", () => {
  test("query needs a declared read-only method and never reaches a write method", () => {
    const context = policyContext();
    expect(decide(req("query", { verb: "status" }), context)).toEqual({
      ok: true,
      action: { op: "query", verb: "status", params: {} },
    });
    expect(decide(req("query", { verb: "missing" }), context)).toEqual({
      ok: false,
      error: { kind: "not_declared" },
    });
    expect(decide(req("query", { verb: "start" }), context)).toEqual({
      ok: false,
      error: { kind: "denied", detail: "query_needs_read_only" },
    });
  });

  test("call needs a declared write method and carries the approval flag", () => {
    const context = policyContext();
    expect(decide(req("call", { verb: "wipe", params: { all: true } }), context)).toEqual({
      ok: true,
      action: { op: "call", verb: "wipe", params: { all: true }, approval: true },
    });
    expect(decide(req("call", { verb: "status" }), context)).toEqual({
      ok: false,
      error: { kind: "denied", detail: "call_needs_write_method" },
    });
  });

  test("extension state blocks every op except pong", () => {
    expect(decide(req("host", {}), policyContext({ enabled: false }))).toEqual({
      ok: false,
      error: { kind: "extension_off" },
    });
    expect(decide(req("host", {}), policyContext({ safeMode: true }))).toEqual({
      ok: false,
      error: { kind: "safe_mode" },
    });
    expect(decide(req("pong", { n: 4 }), policyContext({ enabled: false }))).toEqual({
      ok: true,
      action: { op: "pong", n: 4 },
    });
  });

  test("event kinds: own prefixes, declared kinds and the core list only", () => {
    const context = policyContext();
    const allowed = [
      "x.helm.a",
      "grp.helm.inquiry.finished",
      "note.created",
      "turn.started",
      "lease.granted",
      "scope.changed",
    ];
    const denied = [
      "x.other.a",
      "grp.other.a",
      "secret.revealed",
      "turn.",
      "*",
      "scope.other",
      "x.helmet.a",
      "approval.requested",
    ];
    expect(allowed.map((kind) => eventKindAllowed(kind, context))).toEqual(allowed.map(() => true));
    expect(denied.map((kind) => eventKindAllowed(kind, context))).toEqual(denied.map(() => false));
    expect(decide(req("events", { kinds: ["x.other.a"] }), context)).toEqual({
      ok: false,
      error: { kind: "not_declared", detail: "event_kind" },
    });
    expect(decide(req("events", { kinds: ["x.helm.a"], limit: 501 }), context).ok).toBe(false);
    expect(decide(req("events", { kinds: ["x.helm.a"] }), context)).toEqual({
      ok: true,
      action: { op: "events", kinds: ["x.helm.a"], limit: 500 },
    });
  });

  test("setting keys must carry an own prefix", () => {
    const context = policyContext();
    expect(settingKeyAllowed("ext.helm.depth", context)).toBe(true);
    expect(settingKeyAllowed("l3.helm.lenses", context)).toBe(true);
    expect(settingKeyAllowed("ext.helm.", context)).toBe(false);
    expect(settingKeyAllowed("ext.helmet.x", context)).toBe(false);
    expect(settingKeyAllowed("model.default", context)).toBe(false);
    expect(decide(req("settings", { keys: ["ext.helm.a", "model.default"] }), context)).toEqual({
      ok: false,
      error: { kind: "not_declared", detail: "setting_key" },
    });
  });

  test("command only runs the extension's own registered names", () => {
    const context = policyContext();
    expect(decide(req("command", { name: "helm-start", args: "x" }), context)).toEqual({
      ok: true,
      action: { op: "command", name: "helm-start", args: "x" },
    });
    expect(decide(req("command", { name: "model" }), context)).toEqual({
      ok: false,
      error: { kind: "not_declared", detail: "command" },
    });
  });

  test("post and requestApproval only reach the open thread, post also needs the trust grade", () => {
    const context = policyContext();
    expect(decide(req("post", { threadId: "thr_1", text: "hi" }), context).ok).toBe(true);
    expect(decide(req("post", { threadId: "thr_2", text: "hi" }), context)).toEqual({
      ok: false,
      error: { kind: "denied", detail: "thread_not_open" },
    });
    expect(
      decide(req("post", { threadId: "thr_1", text: "hi" }), policyContext({ allowPost: false })),
    ).toEqual({
      ok: false,
      error: { kind: "denied", detail: "post_not_allowed" },
    });
    expect(
      decide(
        req("post", { threadId: "thr_1", text: "hi" }),
        policyContext({ openThreadId: undefined }),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "denied", detail: "thread_not_open" },
    });
    expect(decide(req("requestApproval", { threadId: "thr_9", verb: "wipe" }), context)).toEqual({
      ok: false,
      error: { kind: "denied", detail: "thread_not_open" },
    });
    expect(decide(req("requestApproval", { threadId: "thr_1", verb: "wipe" }), context)).toEqual({
      ok: true,
      action: { op: "requestApproval", threadId: "thr_1", verb: "wipe", params: {} },
    });
    // 선언 없는 동사와 읽기 메서드는 승인 카드를 청할 수 없다
    expect(decide(req("requestApproval", { threadId: "thr_1", verb: "nope" }), context)).toEqual({
      ok: false,
      error: { kind: "not_declared" },
    });
    expect(decide(req("requestApproval", { threadId: "thr_1", verb: "status" }), context)).toEqual({
      ok: false,
      error: { kind: "denied", detail: "approval_needs_write_method" },
    });
    // 프레임이 쓴 글(title, detail)은 받지 않는다
    expect(decide(req("requestApproval", { threadId: "thr_1", title: "t" }), context).ok).toBe(
      false,
    );
  });

  test("navigate: app targets pass, external needs http(s) without credentials and a shell confirm", () => {
    const context = policyContext();
    expect(decide(req("navigate", { target: { kind: "secrets" } }), context)).toEqual({
      ok: true,
      action: { op: "navigate", target: { kind: "secrets" }, needsShellConfirm: false },
    });
    expect(
      decide(
        req("navigate", { target: { kind: "external", url: "https://example.com/a" } }),
        context,
      ),
    ).toEqual({
      ok: true,
      action: {
        op: "navigate",
        target: {
          kind: "external",
          url: "https://example.com/a",
          link: {
            href: "https://example.com/a",
            display: "https://example.com/a",
            punycodeHost: undefined,
          },
        },
        needsShellConfirm: true,
      },
    });
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "fresnel-view://x/1.0.0/a",
      "https://u:p@example.com/",
      "nope",
    ]) {
      expect(decide(req("navigate", { target: { kind: "external", url } }), context).ok).toBe(
        false,
      );
    }
    expect(decide(req("navigate", { target: { kind: "settings", extra: 1 } }), context).ok).toBe(
      false,
    );
  });

  test("argument errors name the place and keyword, never the value", () => {
    const decision = decide(req("query", { verb: "SECRET-VALUE-123" }), policyContext());
    expect(decision).toEqual({
      ok: false,
      error: { kind: "args_invalid", detail: "/verb pattern" },
    });
    expect(JSON.stringify(decision)).not.toContain("SECRET-VALUE-123");
  });

  test("resize and log are bounded, log keeps only the size", () => {
    const context = policyContext();
    expect(decide(req("resize", { height: 300 }), context)).toEqual({
      ok: true,
      action: { op: "resize", height: 300 },
    });
    expect(decide(req("resize", { height: 99999 }), context).ok).toBe(false);
    expect(decide(req("log", { message: "héllo" }), context)).toEqual({
      ok: true,
      action: { op: "log", size: 6 },
    });
    expect(decide(req("log", { message: "x".repeat(513) }), context).ok).toBe(false);
  });
});

describe("secretKeyPartsOf", () => {
  test("splits the internal secret name into the extension and the key, and is the inverse of secretNameOf", () => {
    expect(secretKeyPartsOf("ext--permdemo--token")).toEqual({ plugin: "permdemo", key: "token" });
    expect(secretKeyPartsOf("ext--a-b--my-key-1")).toEqual({ plugin: "a-b", key: "my-key-1" });
    // 확장 이름에는 `--`가 없어서 첫 `--`가 경계다. 꼬리는 등록 이름 규칙대로 `--`를 담을 수 있다
    expect(secretKeyPartsOf("ext--a--b--c")).toEqual({ plugin: "a", key: "b--c" });
    expect(secretKeyPartsOf("ext--a--token-")).toEqual({ plugin: "a", key: "token-" });
    expect(secretKeyPartsOf(secretNameOf("helm", "api-key"))).toEqual({
      plugin: "helm",
      key: "api-key",
    });
  });

  test("returns null for a name that does not have the ext--<extension>--<key> shape", () => {
    expect(secretKeyPartsOf("ext--permdemo")).toBeNull();
    expect(secretKeyPartsOf("ext----token")).toBeNull();
    expect(secretKeyPartsOf("ext--Perm--token")).toBeNull();
    expect(secretKeyPartsOf("api-key")).toBeNull();
    expect(secretKeyPartsOf("")).toBeNull();
  });
});
