import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { parseJson, type Result } from "@xeon/contracts";
import { validateSettingValue } from "@xeon/contracts/settings";
import { wireError, type WireParams, type WireResult } from "@xeon/contracts/wire";
import { MODELS_SETTING_DEFS } from "@xeon/core-models";
import {
  ACCOUNTS_KEY,
  DEFAULT_RATE_LIMIT_POLICY,
  RATE_LIMIT_KEY,
  checkAccount,
  checkRateLimit,
  modelAccountsView,
  saveModelAccounts,
  withAccount,
  withRateLimit,
  type AccountsConnection,
  type AccountsWireMethod,
} from "../../src/accounts/index.ts";

// X7 (review.m3b-plan §1.1, I14): 설정 화면에서 레이트 리밋·계정 회전을 바꾸면 사용자 설정 파일에 같은 키로 저장된다.
// 화면은 M4라 이 시험은 view-model과 `settings.readFile`·`settings.writeFile` 흐름을 메모리 호스트 하나로 돌린다.
// 시험이 쓰는 키와 값은 core-models의 `MODELS_SETTING_DEFS`와 같은 정의를 따른다(validateSettingValue).

const FILE_PATH = "settings.json";
const START_TEXT =
  '{"l1.models.default":"anthropic/claude-sonnet-5-5","ext.unknown.key":{"keep":true}}';
const CHANGED_TEXT = '{"l1.models.default":"openai/gpt-x"}';

function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 성공이 아니면 시험을 실패시킨다 */
function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function defOf(key: string): (typeof MODELS_SETTING_DEFS)[number] {
  const def = MODELS_SETTING_DEFS.find((entry) => entry.key === key);
  if (def === undefined) throw new Error(`missing definition ${key}`);
  return def;
}

/** 메서드 이름마다 응답 함수를 둔다. 응답의 모양은 와이어 메서드 표의 타입과 같다 */
type FakeHandlers = {
  readonly [M in AccountsWireMethod]: (params: WireParams<M>) => Promise<WireResult<M>>;
};

interface FakeHost {
  readonly connection: AccountsConnection;
  /** 지금 파일 원문. 파일이 없으면 undefined */
  text(): string | undefined;
  /** 다음 `settings.readFile`이 답한 뒤 파일이 이 원문으로 바뀐다(읽기와 쓰기 사이의 다른 쓰기) */
  changeAfterNextRead(text: string): void;
}

/** 메모리 호스트. 사용자 설정 파일 하나를 들고 있고, `baseSha256`이 지금 파일과 다르면 `settings.fileConflict`로 거절한다 */
function fakeHost(initial: string): FakeHost {
  let stored: string | undefined = initial;
  let pendingChange: string | undefined;

  const handlers: FakeHandlers = {
    "settings.readFile": () => {
      const text = stored;
      const result: WireResult<"settings.readFile"> = {
        scope: "user",
        path: FILE_PATH,
        exists: text !== undefined,
        readOnly: false,
        text: text ?? "",
        sha256: text === undefined ? null : sha256Of(text),
        unknownKeys: [],
      };
      if (pendingChange !== undefined) {
        stored = pendingChange;
        pendingChange = undefined;
      }
      return Promise.resolve(result);
    },
    "settings.writeFile": (params) => {
      const current = stored === undefined ? null : sha256Of(stored);
      if (params.baseSha256 !== current) {
        return Promise.reject(wireError("settings.fileConflict", { details: { scope: "user" } }));
      }
      if (!isObject(parseJsonValue(params.text))) {
        return Promise.reject(
          wireError("settings.fileInvalid", { details: { scope: "user", issues: [] } }),
        );
      }
      stored = params.text;
      return Promise.resolve({ path: FILE_PATH, sha256: sha256Of(params.text), unknownKeys: [] });
    },
  };

  return {
    connection: {
      request: (method, params) => handlers[method](params),
    },
    text: () => stored,
    changeAfterNextRead: (text) => {
      pendingChange = text;
    },
  };
}

function parseJsonValue(text: string): unknown {
  const parsed = parseJson(text);
  return parsed.ok ? parsed.value : undefined;
}

function keysOf(value: unknown): readonly string[] {
  return isObject(value) ? Object.keys(value) : [];
}

const accountA = valueOf(
  checkAccount({
    provider: "anthropic",
    accountId: "a",
    credential: "secret://acct-a",
    priority: 1,
    reservePct: 0,
  }),
);
const accountB = valueOf(
  checkAccount({
    provider: "anthropic",
    accountId: "b",
    credential: "secret://acct-b",
    priority: 2,
    reservePct: 0,
  }),
);
const accounts = withAccount(withAccount([], accountA), accountB);
const anthropicPolicy = valueOf(
  checkRateLimit({ minIntervalMs: 1500, onLimit: "wait", maxWaitMs: 8000 }),
);
const rateLimit = withRateLimit({}, "anthropic", anthropicPolicy);

const SAVED_KEYS = [
  "l1.models.default",
  "ext.unknown.key",
  "l1.models.accounts",
  "l1.models.rateLimit",
  "ext.account-rotation.acknowledgeRisk",
];

describe("X7: the rate limit and the account rotation are saved under the setting keys", () => {
  test("the first save writes the accounts, the rate limit and the notice key, and keeps the other keys", async () => {
    const host = fakeHost(START_TEXT);
    const saved = await saveModelAccounts(host.connection, {
      accounts,
      rateLimit,
      acknowledged: true,
    });
    expect(saved).toEqual({ ok: true, value: { sha256: sha256Of(host.text() ?? "") } });
    expect(parseJson(host.text() ?? "")).toEqual({
      ok: true,
      value: {
        "l1.models.default": "anthropic/claude-sonnet-5-5",
        "ext.unknown.key": { keep: true },
        "l1.models.accounts": [accountA, accountB],
        "l1.models.rateLimit": {
          anthropic: { minIntervalMs: 1500, onLimit: "wait", maxWaitMs: 8000 },
        },
        "ext.account-rotation.acknowledgeRisk": true,
      },
    });
    // 키 순서도 그대로다: 있던 키는 제자리, 새 키는 accounts, rateLimit, 고지 순으로 끝에 붙는다
    expect(keysOf(parseJsonValue(host.text() ?? ""))).toEqual(SAVED_KEYS);
  });

  test("the written keys are keys of the real schema and the written values pass its validator", () => {
    const keys = MODELS_SETTING_DEFS.map((def) => def.key);
    expect(keys).toContain(ACCOUNTS_KEY);
    expect(keys).toContain(RATE_LIMIT_KEY);
    const written: readonly (readonly [string, unknown])[] = [
      [ACCOUNTS_KEY, accounts],
      [RATE_LIMIT_KEY, rateLimit],
    ];
    for (const [key, value] of written) {
      const def = defOf(key);
      expect(def.allowedScopes).toContain("user");
      expect(validateSettingValue(def, value)).toEqual({ ok: true });
    }
  });

  test("a second edit that changes only maxWaitMs, built from the view, keeps the accounts", async () => {
    const host = fakeHost(START_TEXT);
    await saveModelAccounts(host.connection, { accounts, rateLimit, acknowledged: true });

    const view = modelAccountsView({
      accounts,
      rateLimit,
      acknowledged: true,
      pluginEnabled: true,
    });
    const current =
      view.providers.find((row) => row.provider === "anthropic")?.policy ??
      DEFAULT_RATE_LIMIT_POLICY;
    const changed = valueOf(checkRateLimit({ maxWaitMs: 9000 }, current));
    // 계정 목록과 고지 값은 이 편집에 없다. 파일에 있던 값이 그대로 남아야 한다
    const second = await saveModelAccounts(host.connection, {
      rateLimit: withRateLimit(rateLimit, "anthropic", changed),
    });
    expect(second.ok).toBe(true);
    expect(parseJson(host.text() ?? "")).toEqual({
      ok: true,
      value: {
        "l1.models.default": "anthropic/claude-sonnet-5-5",
        "ext.unknown.key": { keep: true },
        "l1.models.accounts": [accountA, accountB],
        "l1.models.rateLimit": {
          anthropic: { minIntervalMs: 1500, onLimit: "wait", maxWaitMs: 9000 },
        },
        "ext.account-rotation.acknowledgeRisk": true,
      },
    });
  });

  test("a file that changes between the read and the write is a conflict, and the save writes nothing", async () => {
    const host = fakeHost(START_TEXT);
    host.changeAfterNextRead(CHANGED_TEXT);
    const result = await saveModelAccounts(host.connection, { acknowledged: true });
    expect(result).toEqual({ ok: false, error: { kind: "conflict" } });
    expect(host.text()).toBe(CHANGED_TEXT);
  });

  test("the same edit with no concurrent change succeeds", async () => {
    const host = fakeHost(START_TEXT);
    const result = await saveModelAccounts(host.connection, { acknowledged: true });
    expect(result.ok).toBe(true);
    expect(parseJson(host.text() ?? "")).toEqual({
      ok: true,
      value: {
        "l1.models.default": "anthropic/claude-sonnet-5-5",
        "ext.unknown.key": { keep: true },
        "ext.account-rotation.acknowledgeRisk": true,
      },
    });
  });

  test("a file that is not a JSON object is refused and left as it was", async () => {
    const host = fakeHost("[1, 2]");
    const result = await saveModelAccounts(host.connection, { acknowledged: true });
    expect(result).toEqual({ ok: false, error: { kind: "not_object" } });
    expect(host.text()).toBe("[1, 2]");
  });
});
