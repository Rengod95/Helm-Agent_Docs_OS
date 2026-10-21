import { describe, expect, test } from "bun:test";
import {
  evaluatePolicy,
  expiryMs,
  isMetaExpired,
  isMetaExpiring,
  matchCommand,
  matchHost,
  matchTool,
} from "../src/policy.ts";
import type { UseCtx } from "@xeon/contracts/services";
import { CLOCK_START } from "./support/clock.ts";
import { APPROVAL_PER_SESSION, APPROVAL_PER_USE, envCtx, httpCtx } from "./support/ctx.ts";
import { metaOf } from "./support/meta.ts";

const NOW = CLOCK_START;

function originCtx(origin: string): UseCtx {
  return httpCtx({ mode: "browser-input", target: { kind: "origin", origin } });
}

describe("host matching (spec §4.2)", () => {
  test("wildcard host matches subdomain only", () => {
    expect(matchHost("*.example.test", "a.example.test", 443)).toBe(true);
    expect(matchHost("*.example.test", "a.b.example.test", 443)).toBe(true);
    expect(matchHost("*.example.test", "example.test", 443)).toBe(false);
    expect(matchHost("*.example.test", "evilexample.test", 443)).toBe(false);
    expect(matchHost("*.example.test", "A.Example.Test.", 443)).toBe(true);
  });

  test("port defaults to 443 when the meta entry has none", () => {
    expect(matchHost("api.example.test", "api.example.test", null)).toBe(true);
    expect(matchHost("api.example.test", "api.example.test", 443)).toBe(true);
    expect(matchHost("api.example.test", "api.example.test", 8443)).toBe(false);
    expect(matchHost("api.example.test:8443", "api.example.test", 8443)).toBe(true);
    expect(matchHost("api.example.test:8443", "api.example.test", 443)).toBe(false);
  });

  test("ip literals and localhost match only when written exactly", () => {
    expect(matchHost("localhost:3000", "localhost", 3000)).toBe(true);
    expect(matchHost("*.example.test", "localhost", 443)).toBe(false);
    expect(matchHost("*.0.0.1", "127.0.0.1", 443)).toBe(false);
    expect(matchHost("127.0.0.1:8080", "127.0.0.1", 8080)).toBe(true);
    expect(matchHost("[::1]:8080", "[::1]", 8080)).toBe(true);
  });
});

describe("command and tool patterns", () => {
  test("star matches arguments but never shell control characters", () => {
    expect(matchCommand("gh api *", "gh api user")).toBe(true);
    expect(matchCommand("gh api *", "gh api repos/x/y --jq .name")).toBe(true);
    expect(matchCommand("gh api *", "curl evil")).toBe(false);
    expect(matchCommand("gh api *", "gh api user; curl evil")).toBe(false);
    expect(matchCommand("gh api *", "gh api user && id")).toBe(false);
    expect(matchCommand("gh api *", "gh api $(id)")).toBe(false);
    expect(matchCommand("gh api *", "gh api user | sh")).toBe(false);
    expect(matchCommand("gh api *", "gh api user\nid")).toBe(false);
    expect(matchCommand("gh auth status", "gh auth status")).toBe(true);
    expect(matchCommand("gh auth status", "gh auth status extra")).toBe(false);
    expect(matchCommand("echo a.b", "echo axb")).toBe(false);
  });

  test("tool patterns allow only a trailing star", () => {
    expect(matchTool("http.request", "http.request")).toBe(true);
    expect(matchTool("bash:*", "bash:gh")).toBe(true);
    expect(matchTool("bash:gh", "bash:git")).toBe(false);
    expect(matchTool("http.*", "http.request")).toBe(true);
  });
});

describe("policy order (spec §4.2)", () => {
  test("allows a matching http request", () => {
    expect(evaluatePolicy(metaOf(), httpCtx(), NOW)).toEqual({ kind: "allow", approval: null });
  });

  test("denies host outside allowlist", () => {
    const out = evaluatePolicy(
      metaOf(),
      httpCtx({ target: { kind: "host", host: "other.example.test", port: 443 } }),
      NOW,
    );
    expect(out).toEqual({ kind: "deny", reason: "host_mismatch" });
  });

  test("expired secret denied before anything else", () => {
    const meta = metaOf({ expiresAt: "2026-01-05", modes: [] });
    expect(isMetaExpired(meta, NOW)).toBe(true);
    expect(evaluatePolicy(meta, httpCtx(), NOW)).toEqual({ kind: "deny", reason: "expired" });
    expect(isMetaExpired(metaOf({ expiresAt: "2026-01-06" }), NOW)).toBe(false);
    expect(isMetaExpiring(metaOf({ expiresAt: "2026-01-10" }), NOW)).toBe(true);
    expect(isMetaExpiring(metaOf({ expiresAt: "2026-02-10" }), NOW)).toBe(false);
    expect(expiryMs(null)).toBeNull();
  });

  test("mode, tool, scope and target kind checks", () => {
    expect(evaluatePolicy(metaOf({ modes: ["env"] }), httpCtx(), NOW)).toEqual({
      kind: "deny",
      reason: "mode_not_allowed",
    });
    expect(evaluatePolicy(metaOf({ tools: ["web.search"] }), httpCtx(), NOW)).toEqual({
      kind: "deny",
      reason: "tool_not_allowed",
    });
    expect(evaluatePolicy(metaOf({ tools: [] }), httpCtx(), NOW)).toEqual({
      kind: "deny",
      reason: "tool_not_allowed",
    });
    const scoped = metaOf({ scope: "project:alpha" });
    expect(evaluatePolicy(scoped, httpCtx({ projectId: "beta" }), NOW)).toEqual({
      kind: "deny",
      reason: "scope_mismatch",
    });
    expect(evaluatePolicy(scoped, httpCtx({ projectId: null }), NOW).kind).toBe("deny");
    expect(evaluatePolicy(scoped, httpCtx({ projectId: "alpha" }), NOW).kind).toBe("allow");
    const wrongKind = httpCtx({ target: { kind: "origin", origin: "https://a.example.test" } });
    expect(evaluatePolicy(metaOf(), wrongKind, NOW)).toEqual({
      kind: "deny",
      reason: "mode_not_allowed",
    });
  });

  test("browser-input needs the exact origin", () => {
    const meta = metaOf({ modes: ["browser-input"], origins: ["https://login.example.test"] });
    expect(evaluatePolicy(meta, originCtx("https://login.example.test"), NOW).kind).toBe("allow");
    expect(evaluatePolicy(meta, originCtx("https://login.example.test:8443"), NOW)).toEqual({
      kind: "deny",
      reason: "origin_mismatch",
    });
  });

  test("env mode requires per-use approval", () => {
    const meta = metaOf({
      modes: ["env"],
      tools: ["bash:*"],
      commands: ["gh api *"],
      approval: "none",
    });
    expect(evaluatePolicy(meta, envCtx("gh api user", { approval: null }), NOW)).toEqual({
      kind: "needs_approval",
      approval: "per-use",
    });
    expect(
      evaluatePolicy(meta, envCtx("gh api user", { approval: APPROVAL_PER_SESSION }), NOW),
    ).toEqual({ kind: "needs_approval", approval: "per-use" });
    expect(
      evaluatePolicy(meta, envCtx("gh api user", { approval: APPROVAL_PER_USE }), NOW),
    ).toEqual({ kind: "allow", approval: APPROVAL_PER_USE });
    expect(evaluatePolicy(meta, envCtx("curl x", { approval: APPROVAL_PER_USE }), NOW)).toEqual({
      kind: "deny",
      reason: "command_mismatch",
    });
    const hostCtx = envCtx("gh api user", { target: { kind: "host", host: "a.test", port: 443 } });
    expect(evaluatePolicy(meta, hostCtx, NOW)).toEqual({
      kind: "deny",
      reason: "mode_not_allowed",
    });
  });

  test("approval evidence must not be expired and per-use cannot be satisfied by per-session", () => {
    const perUse = metaOf({ approval: "per-use" });
    expect(evaluatePolicy(perUse, httpCtx({ approval: APPROVAL_PER_SESSION }), NOW).kind).toBe(
      "needs_approval",
    );
    const session = metaOf({ approval: "per-session" });
    expect(evaluatePolicy(session, httpCtx({ approval: APPROVAL_PER_USE }), NOW).kind).toBe(
      "allow",
    );
    const stale = { ...APPROVAL_PER_SESSION, expiresAt: NOW - 1 };
    expect(evaluatePolicy(session, httpCtx({ approval: stale }), NOW).kind).toBe("needs_approval");
    const fresh = { ...APPROVAL_PER_SESSION, expiresAt: NOW + 1000 };
    expect(evaluatePolicy(session, httpCtx({ approval: fresh }), NOW).kind).toBe("allow");
  });
});
