import { describe, expect, test } from "bun:test";
import type { SettingDefWire } from "@xeon/contracts/settings";
import {
  defaultWriteScope,
  deprecatedInfo,
  lockInfo,
  runtimeBadge,
  scopeBadge,
  writableScopes,
  type WritableScope,
} from "../../src/settings/index.ts";
import { effectiveOf, wireDef } from "./fixtures.ts";

describe("scope badge", () => {
  test("each scope has its Korean text and the same tone", () => {
    expect(scopeBadge({ scope: "managed" })).toEqual({
      scope: "managed",
      text: "관리",
      tone: "managed",
    });
    expect(scopeBadge({ scope: "user" })).toEqual({ scope: "user", text: "사용자", tone: "user" });
    expect(scopeBadge({ scope: "project" })).toEqual({
      scope: "project",
      text: "프로젝트",
      tone: "project",
    });
    expect(scopeBadge({ scope: "local" })).toEqual({ scope: "local", text: "로컬", tone: "local" });
    expect(scopeBadge({ scope: "session" })).toEqual({
      scope: "session",
      text: "세션",
      tone: "session",
    });
    expect(scopeBadge({ scope: "default" })).toEqual({
      scope: "default",
      text: "기본값",
      tone: "default",
    });
  });
});

describe("runtime badge", () => {
  test("live has no pending text", () => {
    expect(runtimeBadge(effectiveOf("l1.models.x", 1))).toEqual({
      change: "live",
      text: "즉시 적용",
      pending: null,
      pendingText: null,
    });
  });

  test("nextTurn and restart carry their pending texts", () => {
    expect(
      runtimeBadge(
        effectiveOf("l1.models.x", 1, { runtimeChange: "nextTurn", pendingUntil: "nextTurn" }),
      ),
    ).toEqual({
      change: "nextTurn",
      text: "다음 턴부터",
      pending: "nextTurn",
      pendingText: "다음 턴부터 적용돼요",
    });
    expect(
      runtimeBadge(
        effectiveOf("l1.models.x", 1, { runtimeChange: "restart", pendingUntil: "restart" }),
      ),
    ).toEqual({
      change: "restart",
      text: "재시작 필요",
      pending: "restart",
      pendingText: "재시작해야 적용돼요",
    });
  });
});

describe("lock info", () => {
  test("an unlocked setting has no lock info", () => {
    expect(lockInfo(effectiveOf("l1.models.x", 1))).toBeNull();
  });

  test("managed_file with a path names the policy file", () => {
    const locked = effectiveOf("l1.models.x", 1, {
      locked: true,
      lockReason: "managed_file",
      source: { scope: "managed", path: "/etc/xeon/managed.json" },
    });
    expect(lockInfo(locked)).toEqual({
      reason: "managed_file",
      path: "/etc/xeon/managed.json",
      text: "관리 정책으로 잠겨 있어요 정책 파일: /etc/xeon/managed.json",
    });
  });

  test("a missing lock reason is managed_file, and without a path the text has no path part", () => {
    const locked = effectiveOf("l1.models.x", 1, { locked: true, source: { scope: "managed" } });
    expect(lockInfo(locked)).toEqual({
      reason: "managed_file",
      path: null,
      text: "관리 정책으로 잠겨 있어요",
    });
  });

  test("managed_policy is the file-outside kind and has no path part", () => {
    const locked = effectiveOf("l1.models.x", 1, {
      locked: true,
      lockReason: "managed_policy",
      source: { scope: "managed", path: "/should/not/show" },
    });
    expect(lockInfo(locked)).toEqual({
      reason: "managed_policy",
      path: null,
      text: "관리 정책(파일 밖 수단)으로 잠겨 있어요",
    });
  });
});

describe("deprecated info", () => {
  const replacement: SettingDefWire = wireDef({
    key: "l1.models.routing.review",
    type: { type: "string" },
    ui: { tab: "models", widget: "text", order: 1, label: "검토 모델" },
  });

  test("a definition without deprecated has no info", () => {
    expect(
      deprecatedInfo(wireDef({ key: "l1.models.x", type: { type: "string" } }), new Map()),
    ).toBeNull();
  });

  test("replacedByLabel comes from the replacement definition's ui.label", () => {
    const old = wireDef({
      key: "l1.models.oldReview",
      type: { type: "string" },
      deprecated: { since: "0.2.0", replacedBy: "l1.models.routing.review", note: "옮기세요" },
    });
    const catalog = new Map([[replacement.key, replacement]]);
    expect(deprecatedInfo(old, catalog)).toEqual({
      since: "0.2.0",
      replacedBy: "l1.models.routing.review",
      replacedByLabel: "검토 모델",
      note: "옮기세요",
    });
  });

  test("a missing replacement definition gives a null label, and no replacedBy gives null", () => {
    const old = wireDef({
      key: "l1.models.oldReview",
      type: { type: "string" },
      deprecated: { since: "0.2.0", replacedBy: "l1.models.routing.gone" },
    });
    expect(deprecatedInfo(old, new Map())).toEqual({
      since: "0.2.0",
      replacedBy: "l1.models.routing.gone",
      replacedByLabel: null,
      note: null,
    });
    const bare = wireDef({
      key: "l1.models.oldX",
      type: { type: "string" },
      deprecated: { since: "0.2.0" },
    });
    expect(deprecatedInfo(bare, new Map())).toEqual({
      since: "0.2.0",
      replacedBy: null,
      replacedByLabel: null,
      note: null,
    });
  });
});

describe("writable scopes (4.3.6)", () => {
  const def = wireDef({ key: "l1.models.x", type: { type: "string" } });

  test("managed is never a candidate", () => {
    expect(writableScopes(def, undefined, true)).toEqual(["user", "project", "local", "session"]);
  });

  test("a locked setting has no candidates", () => {
    const locked = effectiveOf("l1.models.x", 1, { locked: true });
    expect(writableScopes(def, locked, true)).toEqual([]);
  });

  test("without a thread session is not a candidate", () => {
    expect(writableScopes(def, undefined, false)).toEqual(["user", "project", "local"]);
  });

  test("the allowed order of the definition is kept", () => {
    const narrow = wireDef({
      key: "l1.models.x",
      type: { type: "string" },
      allowedScopes: ["local", "managed", "user"],
    });
    expect(writableScopes(narrow, undefined, true)).toEqual(["local", "user"]);
  });
});

describe("default write scope", () => {
  test("user first, then project, local, session", () => {
    expect(defaultWriteScope(["project", "local", "session", "user"])).toBe("user");
    expect(defaultWriteScope(["session", "local", "project"])).toBe("project");
    expect(defaultWriteScope(["session", "local"])).toBe("local");
    expect(defaultWriteScope(["session"])).toBe("session");
  });

  test("no candidates gives null", () => {
    const none: readonly WritableScope[] = [];
    expect(defaultWriteScope(none)).toBeNull();
  });
});
