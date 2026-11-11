import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import { wireError } from "@fresnel/contracts/wire";
import { activeLocale, setActiveLocale, type Locale } from "../../src/i18n/index.ts";
import {
  checkClientValue,
  coerceInput,
  planReset,
  planWrite,
  toFieldError,
  type WidgetVM,
} from "../../src/settings/index.ts";
import { effectiveOf, wireDef } from "./fixtures.ts";

// 쓰기 흐름의 순수 함수(write-flow.ts): 입력 변환, 클라이언트 검사, 보내기 계획, 서버 오류의 문장 변환.

function threadOf(name: string): ThreadId {
  const parsed = parse(ThreadIdSchema, `thr_01HZX0000000000000000000${name}`);
  if (!parsed.ok) throw new Error("test thread id must parse");
  return parsed.value;
}

const THREAD = threadOf("AA");
const BUDGET = "l1.models.budget";
const API_KEY = "l1.providers.apiKey";

const budgetDef = wireDef({
  key: BUDGET,
  type: { type: "integer" },
  range: { min: 1, max: 20 },
  ui: { tab: "models", widget: "number", order: 1, label: "판정 최대 횟수" },
});
const apiKeyDef = wireDef({
  key: API_KEY,
  type: { type: "string" },
  secret: true,
  ui: { tab: "providers", widget: "secret", order: 1, label: "API 키" },
});

let saved: Locale = "ko";
beforeEach(() => {
  saved = activeLocale();
  setActiveLocale("ko");
});
afterEach(() => {
  setActiveLocale(saved);
});

describe("coerceInput", () => {
  const number: WidgetVM = {
    kind: "number",
    min: null,
    max: null,
    integer: true,
    unit: null,
    unitId: null,
  };

  test("a numeric string becomes a number, and a non-numeric one is an issue", () => {
    expect(coerceInput(number, "12")).toEqual({ ok: true, value: 12 });
    expect(coerceInput(number, "abc")).toEqual({
      ok: false,
      error: { path: "", message: "형식이 맞지 않아요" },
    });
  });

  test("a toggle takes only a boolean", () => {
    const toggle: WidgetVM = { kind: "toggle" };
    expect(coerceInput(toggle, true)).toEqual({ ok: true, value: true });
    expect(coerceInput(toggle, "true").ok).toBe(false);
  });

  test("a secret takes only a reference and the issue carries no typed value", () => {
    const secret: WidgetVM = { kind: "secret" };
    expect(coerceInput(secret, "secret://exa-api-key")).toEqual({
      ok: true,
      value: "secret://exa-api-key",
    });
    const refused = coerceInput(secret, "sk-literal-value");
    expect(refused).toEqual({ ok: false, error: { path: "", message: "형식이 맞지 않아요" } });
    expect(JSON.stringify(refused)).not.toContain("sk-literal-value");
  });

  test("a read-only field refuses every input", () => {
    expect(coerceInput({ kind: "readonly" }, "x").ok).toBe(false);
  });
});

describe("checkClientValue", () => {
  test("a value inside the range passes and comes back as it was", () => {
    expect(checkClientValue(budgetDef, 3)).toEqual({ ok: true, value: 3 });
  });

  test("a value outside the range fails with the range sentence at the root path", () => {
    expect(checkClientValue(budgetDef, 25)).toEqual({
      ok: false,
      error: [{ path: "", message: "1에서 20 사이로 적어 주세요" }],
    });
  });

  test("a value of the wrong type fails", () => {
    expect(checkClientValue(budgetDef, "3").ok).toBe(false);
  });
});

describe("planWrite", () => {
  test("a valid value in the user scope becomes a settings.set without a thread id", () => {
    expect(planWrite(budgetDef, undefined, 3, "user", THREAD)).toEqual({
      kind: "send",
      params: { key: BUDGET, value: 3, scope: "user" },
    });
  });

  test("the launch scope carries the open thread id", () => {
    expect(planWrite(budgetDef, undefined, 3, "launch", THREAD)).toEqual({
      kind: "send",
      params: { key: BUDGET, value: 3, scope: "launch", threadId: THREAD },
    });
  });

  test("the launch scope with no open thread is blocked before sending", () => {
    expect(planWrite(budgetDef, undefined, 3, "launch", null)).toEqual({
      kind: "blocked",
      error: {
        kind: "scopeNotAllowed",
        message: "이번 실행 범위에는 저장할 수 없어요",
        allowed: ["user", "project", "local"],
      },
    });
  });

  test("a value outside the range is blocked with the issues and nothing is sent", () => {
    expect(planWrite(budgetDef, undefined, 25, "user", THREAD)).toEqual({
      kind: "blocked",
      error: {
        kind: "invalidValue",
        message: "1에서 20 사이로 적어 주세요",
        issues: [{ path: "", message: "1에서 20 사이로 적어 주세요" }],
      },
    });
  });

  test("a locked setting is blocked as locked", () => {
    const locked = effectiveOf(BUDGET, 3, { locked: true, lockReason: "managed_file" });
    expect(planWrite(budgetDef, locked, 4, "user", THREAD)).toEqual({
      kind: "blocked",
      error: { kind: "locked", message: "관리 정책으로 잠겨 있어 바꿀 수 없어요" },
    });
  });

  test("a secret key with a value that is not a reference is blocked as secretValue", () => {
    expect(planWrite(apiKeyDef, undefined, "sk-literal", "user", THREAD)).toEqual({
      kind: "blocked",
      error: {
        kind: "secretValue",
        message: "시크릿 값은 여기에 넣을 수 없어요. 시크릿 탭에서 등록한 뒤 참조를 골라 주세요",
      },
    });
  });
});

describe("planReset", () => {
  test("a reset in the user scope sends the key and the scope only", () => {
    expect(planReset(budgetDef, undefined, "user", THREAD)).toEqual({
      kind: "send",
      params: { key: BUDGET, scope: "user" },
    });
  });

  test("a reset of the launch scope with no open thread is blocked", () => {
    expect(planReset(budgetDef, undefined, "launch", null).kind).toBe("blocked");
  });
});

describe("toFieldError", () => {
  test("a scope the key does not allow names the scope and the allowed ones, then reloads the catalog", () => {
    const error = wireError("settings.scopeNotAllowed", {
      details: { key: BUDGET, scope: "project", allowedScopes: ["user", "local"] },
    });
    expect(toFieldError(budgetDef, error)).toEqual({
      error: {
        kind: "scopeNotAllowed",
        message: "프로젝트 범위에는 저장할 수 없어요",
        allowed: ["user", "local"],
      },
      followUp: "reloadCatalog",
    });
  });

  test("a project scope with no open project keeps the draft and does not reload", () => {
    const error = wireError("settings.scopeNotAllowed", {
      details: {
        key: BUDGET,
        scope: "project",
        allowedScopes: ["user"],
        reason: "workspaceRequired",
      },
    });
    expect(toFieldError(budgetDef, error)).toEqual({
      error: {
        kind: "scopeNotAllowed",
        message: "작업 폴더가 열려 있지 않아 프로젝트에는 저장할 수 없어요",
        allowed: ["user"],
      },
      followUp: "none",
    });
  });

  test("an invalid value keeps the path of each issue and uses the field sentence, not the server message", () => {
    const error = wireError("settings.invalidValue", {
      message: "value 25 fails maximum 20 at /",
      details: { key: BUDGET, issues: [{ path: "/", message: "value 25 fails maximum 20" }] },
    });
    expect(toFieldError(budgetDef, error)).toEqual({
      error: {
        kind: "invalidValue",
        message: "1에서 20 사이로 적어 주세요",
        issues: [{ path: "/", message: "1에서 20 사이로 적어 주세요" }],
      },
      followUp: "none",
    });
  });

  test("a locked answer names the lock and reads the key again", () => {
    const error = wireError("settings.locked", {
      details: { key: BUDGET, lockedBy: "managed" },
    });
    expect(toFieldError(budgetDef, error)).toEqual({
      error: { kind: "locked", message: "관리 정책으로 잠겨 있어 바꿀 수 없어요" },
      followUp: "refreshValue",
    });
  });

  test("an unknown key reloads the catalog", () => {
    const error = wireError("settings.unknownKey", { details: { key: BUDGET } });
    expect(toFieldError(budgetDef, error)).toEqual({
      error: { kind: "unknownKey", message: "이 설정을 찾을 수 없어요. 목록을 새로 불러왔어요" },
      followUp: "reloadCatalog",
    });
  });

  test("a secret value answer carries no value and asks for nothing more", () => {
    const error = wireError("settings.secretValue", { details: { key: API_KEY } });
    expect(toFieldError(apiKeyDef, error).followUp).toBe("none");
    expect(toFieldError(apiKeyDef, error).error.kind).toBe("secretValue");
  });

  test("a shutting-down host and a cancelled request are transient", () => {
    expect(toFieldError(budgetDef, wireError("host.shuttingDown")).error).toEqual({
      kind: "transient",
      message: "엔진과 연결이 끊겼어요. 다시 연결되면 저장해 주세요",
    });
    expect(toFieldError(budgetDef, wireError("request.cancelled")).error.kind).toBe("transient");
  });

  test("a failure that is not a wire error, such as a closed connection, is transient", () => {
    expect(toFieldError(budgetDef, new Error("socket closed"))).toEqual({
      error: {
        kind: "transient",
        message: "엔진과 연결이 끊겼어요. 다시 연결되면 저장해 주세요",
      },
      followUp: "none",
    });
  });

  test("any other wire error is internal, with the trace id when the host sent one", () => {
    expect(toFieldError(budgetDef, wireError("jsonrpc.invalidParams"))).toEqual({
      error: { kind: "internal", message: "저장하지 못했어요", traceId: null },
      followUp: "none",
    });
    expect(
      toFieldError(budgetDef, wireError("jsonrpc.invalidParams", { traceId: "trc_42" })),
    ).toEqual({
      error: {
        kind: "internal",
        message: "저장하지 못했어요. 추적 번호: trc_42",
        traceId: "trc_42",
      },
      followUp: "none",
    });
  });
});
