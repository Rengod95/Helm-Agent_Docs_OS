import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { parseJson, type Result } from "@xeon/contracts";
import {
  ACCOUNTS_KEY,
  RATE_LIMIT_KEY,
  ROTATION_ACK_KEY,
  checkAccount,
  checkRateLimit,
  saveModelAccounts,
  withAccount,
  withRateLimit,
  type AccountsConnection,
} from "@xeon/client/accounts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// X7 (review.m3b-plan §1.1): packages/client/test/accounts/x7.test.ts는 같은 모델 계정 view-model을 메모리 가짜 호스트에 저장한다.
// 여기서는 그 view-model(`saveModelAccounts`)이 실제 호스트의 `settings.readFile`·`settings.writeFile` 처리기를 지나 사용자 설정 파일(F5 파일)에
// 같은 키로 남는지 확인한다. 실제 엔진과 임시 홈 위의 시험이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
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
const rateLimit = withRateLimit(
  {},
  "anthropic",
  valueOf(checkRateLimit({ minIntervalMs: 1500, onLimit: "wait", maxWaitMs: 8000 })),
);

const START = {
  "l1.models.default": "tape/tape-1",
  "ext.unknown.key": { keep: true },
};

function keysOf(value: unknown): readonly string[] {
  return typeof value === "object" && value !== null ? Object.keys(value) : [];
}

function fileJson(path: string): unknown {
  const parsed = parseJson(readFileSync(path, "utf8"));
  return parsed.ok ? parsed.value : undefined;
}

realTest(
  "the model account view-model saves through the real settings.writeFile and the user file holds the same keys",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, START);
    const userFile = join(home.root, "config", "settings.json");
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);

    const saved = await saveModelAccounts(connection, { accounts, rateLimit, acknowledged: true });
    const { sha256 } = valueOf(saved);

    // 파일에는 있던 키(모르는 키 포함)가 제자리에 있고 새 키 셋이 끝에 붙는다: 메모리 가짜 호스트 시험(x7.test.ts)과 같은 키·값이다
    const onDisk = fileJson(userFile);
    expect(onDisk).toEqual({
      "l1.models.default": "tape/tape-1",
      "ext.unknown.key": { keep: true },
      [ACCOUNTS_KEY]: [accountA, accountB],
      [RATE_LIMIT_KEY]: { anthropic: { minIntervalMs: 1500, onLimit: "wait", maxWaitMs: 8000 } },
      [ROTATION_ACK_KEY]: true,
    });
    expect(keysOf(onDisk)).toEqual([
      "l1.models.default",
      "ext.unknown.key",
      ACCOUNTS_KEY,
      RATE_LIMIT_KEY,
      ROTATION_ACK_KEY,
    ]);

    // 호스트가 쓴 파일의 해시를 읽기가 그대로 돌려주고, 메모리 층도 새 값을 본다
    const read = await connection.request("settings.readFile", { scope: "user" });
    expect(read).toMatchObject({ scope: "user", exists: true, readOnly: false, sha256 });
    expect(read.unknownKeys).toContain("ext.unknown.key");
    const got = await connection.request("settings.get", { keys: [ACCOUNTS_KEY, RATE_LIMIT_KEY] });
    expect(got.settings.map((setting) => [setting.key, setting.source.scope])).toEqual([
      [ACCOUNTS_KEY, "user"],
      [RATE_LIMIT_KEY, "user"],
    ]);

    await connection.close();
    await host.close();
    home.dispose();
  },
);

realTest(
  "a file edited by someone else between the read and the write is a conflict through the real handler, and the file keeps their edit",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, START);
    const userFile = join(home.root, "config", "settings.json");
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const theirEdit = JSON.stringify({ "l1.models.default": "tape/tape-1", "ext.theirs": 1 });
    const racing: AccountsConnection = {
      async request(method, params) {
        const result = await connection.request(method, params);
        if (method === "settings.readFile") writeFileSync(userFile, theirEdit);
        return result;
      },
    };

    const saved = await saveModelAccounts(racing, { acknowledged: true });
    expect(saved).toEqual({ ok: false, error: { kind: "conflict" } });
    expect(readFileSync(userFile, "utf8")).toBe(theirEdit);

    await connection.close();
    await host.close();
    home.dispose();
  },
);

realTest(
  "the real handler refuses account values that do not pass the schema, and the file is unchanged",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, START);
    const userFile = join(home.root, "config", "settings.json");
    const before = readFileSync(userFile, "utf8");
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);

    const read = await connection.request("settings.readFile", { scope: "user" });
    const rejected = await rejectionOf(
      connection.request("settings.writeFile", {
        scope: "user",
        text: JSON.stringify({ [ACCOUNTS_KEY]: "not a list" }),
        baseSha256: read.sha256,
      }),
    );
    expect(rejected).toMatchObject({ data: { kind: "settings.fileInvalid" } });
    expect(readFileSync(userFile, "utf8")).toBe(before);

    await connection.close();
    await host.close();
    home.dispose();
  },
);
