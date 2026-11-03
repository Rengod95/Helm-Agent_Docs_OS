import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { WireResult } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { sequencedModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// 훅별 핸들러 순서 덮어쓰기(X.operations §4.1.5, F.wire-settings `hooks.order.*`)를 실제 조립으로 시험한다. 실제 엔진이
// `hooks.order.*`에 답하고, 설정 파일은 엔진 홈에 쓰이며, 디스패처가 실제 Turn을 돈다. 가짜 원천은 쓰지 않는다.
//
// 관찰 방법: 실행 순서는 `trace.turn`으로 읽는다. 계측 버퍼의 항목 안 핸들러 목록은 핸들러가 실행될 때 쌓이므로 그 순서가
// 실제 실행 순서다. `boundary.settle.after`는 turn.completed 뒤에 돌고 그 Turn의 항목으로 남는다. 순서 값(`hooks.list`의 행 순서,
// `hooks.order.get`의 applied)은 같은 정렬을 쓰는 읽기 값이라 실행 순서와 맞는지를 덧붙여 본다.
//
// 가드 tier: 이 호스트에는 가드 tier 핸들러가 실제로 없다(core-tools는 훅을 걸지 않고, 내장 단위는 tier가 매겨지지 않는다).
// 그래서 고정(guard) 관련 시험은 실제 엔진에서 닿는 가장 가까운 자리에서만 쓰고, 나머지는 보고서의 공백으로 남긴다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const KEY = "x.operations.hookOrder";
/** tier 1(사용자 위치의 확장) 핸들러가 걸리는 tap 훅 */
const SETTLE = "boundary.settle.after";
/** tier 1 확장과 tier 5(내장 학습 그룹)가 같은 tap 훅에 걸린다 */
const PROBE = "ext-probe";
const LEARNING = "learning";
/** 저장한 뒤 폴더를 지워 다음 시작에서 실리지 않는 확장 */
const GONE = "ext-gone";
/** closed first 훅(`tool.call.before`)에 걸리는 사용자 확장 두 개 */
const CALL = "tool.call.before";
const FIRST_A = "ext-first-a";
const FIRST_B = "ext-first-b";
/** open first 훅(`thread.compact.before`). 내장 핸들러가 없어 사용자 확장 두 개가 핸들러를 준다 */
const COMPACT = "thread.compact.before";
const COMPACT_A = "ext-compact-a";
const COMPACT_B = "ext-compact-b";
/** chain 훅. 내장 `cap-dialog`와 `cap-web`이 걸린다(멈춤 규칙이 있다) */
const CHAIN = "input.user.before";
const CHAIN_FIRST = "cap-dialog";
const CHAIN_SECOND = "cap-web";

const ANSWERS = ["하나.", "둘.", "셋.", "넷.", "다섯.", "여섯."];

function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

/** 값이 조건을 만족할 때까지 다시 읽는다(최대 5초). 시간 안에 못 맞추면 마지막 값을 돌려준다 */
async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  deadline = Date.now() + 5000,
): Promise<T> {
  const value = await read();
  if (done(value) || Date.now() > deadline) return value;
  await new Promise((resolve) => setTimeout(resolve, 50));
  return until(read, done, deadline);
}

/**
 * `<config>/extensions/<name>`: 훅 하나에 빈 핸들러를 건다. Registration id는 확장 이름이고 사용자 위치의 확장이라 tier 1이다
 */
function writeHookProbe(home: EngineHome, name: string, hook: string): void {
  const root = join(home.root, "config", "extensions", name);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify({
      schemaVersion: 2,
      name,
      version: "1.0.0",
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [hook] }],
    }),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `export const extension = ({ register }) => {
  register(${JSON.stringify(name)}, {}, (g) => {
    g.on(${JSON.stringify(hook)}, () => {});
  });
};
`,
  );
}

/** 사용자 설정 파일(엔진 홈)을 읽는다. 저장 키가 있으면 그대로 보인다 */
function settingsOf(home: EngineHome): unknown {
  const parsed: unknown = JSON.parse(
    readFileSync(join(home.root, "config", "settings.json"), "utf8"),
  );
  return parsed;
}

/** 같은 엔진 홈에서 실제 호스트를 세운다. 기본 플러그인 폴더는 비워 사용자 위치의 확장만 실린다 */
async function openHost(answers: readonly string[]) {
  const host = await startInProcessHost({
    devChecks: true,
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "hook-order-bundles-")),
    buildModels: sequencedModels("hook-order-real", answers),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return { host, connection };
}

type Running = Awaited<ReturnType<typeof openHost>>;

async function closeHost(running: Running): Promise<void> {
  await running.connection.close();
  await running.host.close();
}

/** `trace.turn` 항목 가운데 `boundary.settle.after`의 핸들러 Registration id 목록들 */
function settleOrdersOf(trace: WireResult<"trace.turn">): string[][] {
  return trace.entries
    .filter((entry) => entry.hook === SETTLE)
    .map((entry) => entry.handlers.map((handler) => handler.registrationId));
}

/**
 * Turn 하나를 돌리고 그 Turn의 `boundary.settle.after` 실행 순서를 돌려준다. 항목은 Turn이 끝난 뒤에 생기므로 생길 때까지 읽는다
 */
async function turnOrder(
  connection: Running["connection"],
  threadId: ThreadId,
  input: string,
): Promise<string[]> {
  const started = await startTurnWhenIdle(connection, { threadId, input });
  const trace = await until(
    () => connection.request("trace.turn", { threadId, turnId: started.turnId }),
    (value) => settleOrdersOf(value).length > 0,
  );
  return settleOrdersOf(trace)[0] ?? [];
}

/** 사용자 위치 확장의 참조(미리보기 `by`, `affects`) */
function userRef(name: string) {
  return { registrationId: name, extension: name, tier: 1 };
}

/** 내장 단위의 참조. 이 호스트에서 내장 핸들러는 tier 5로 나온다 */
function builtinRef(name: string) {
  return { registrationId: name, extension: name, tier: 5 };
}

realTest(
  "a set across tiers reverses the real dispatch order at the next step boundary, and get shows pending until a turn applies it",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    writeHookProbe(home, PROBE, SETTLE);
    const running = await openHost(ANSWERS);
    const { connection } = running;
    try {
      const created = await connection.request("thread.create", {});
      // 저장 값이 없으면 기본 순서다: 사용자 확장(tier 1)이 내장 학습(tier 5)보다 먼저 돈다
      expect(await turnOrder(connection, created.threadId, "첫 질문")).toEqual([PROBE, LEARNING]);
      expect(await connection.request("hooks.order.get", {})).toEqual({ hooks: [] });

      // tier 5를 tier 1 앞으로 옮긴다. 저장만 하고 적용은 다음 단계 경계다
      expect(
        await connection.request("hooks.order.set", { hook: SETTLE, order: [LEARNING, PROBE] }),
      ).toEqual({ hook: SETTLE, saved: [LEARNING, PROBE], appliesAt: "nextStepBoundary" });
      // 아직 경계 전이라 적용 중인 순서는 비어 있고(기본 순서) 저장 값과 달라 보류다
      expect(await connection.request("hooks.order.get", {})).toEqual({
        hooks: [{ hook: SETTLE, saved: [LEARNING, PROBE], applied: [], pending: true, pinned: [] }],
      });

      // 다음 Turn의 경계에서 적용되어 실제 실행 순서가 뒤집힌다
      expect(await turnOrder(connection, created.threadId, "둘째 질문")).toEqual([LEARNING, PROBE]);
      expect(await connection.request("hooks.order.get", {})).toEqual({
        hooks: [
          {
            hook: SETTLE,
            saved: [LEARNING, PROBE],
            applied: [LEARNING, PROBE],
            pending: false,
            pinned: [],
          },
        ],
      });
      // 읽기 값도 적용된 순서를 보인다(같은 정렬을 쓴다)
      const listed = await connection.request("hooks.list", {});
      const settle = listed.hooks.find((row) => row.hook === SETTLE);
      expect(settle?.order?.map((entry) => entry.registrationId)).toEqual([LEARNING, PROBE]);
    } finally {
      await closeHost(running);
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "a saved order survives a restart: the next host applies it at its first step boundary, and the settings file keeps exactly the saved value",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    writeHookProbe(home, PROBE, SETTLE);
    const first = await openHost(ANSWERS);
    try {
      expect(
        await first.connection.request("hooks.order.set", {
          hook: SETTLE,
          order: [LEARNING, PROBE],
        }),
      ).toEqual({ hook: SETTLE, saved: [LEARNING, PROBE], appliesAt: "nextStepBoundary" });
    } finally {
      await closeHost(first);
    }
    // 엔진 홈의 사용자 설정 파일에 키가 정확히 이 값으로 남는다
    expect(settingsOf(home)).toEqual({ ...TAPE_SETTINGS, [KEY]: { [SETTLE]: [LEARNING, PROBE] } });

    const second = await openHost(ANSWERS);
    try {
      const created = await second.connection.request("thread.create", {});
      expect(await turnOrder(second.connection, created.threadId, "재시작 뒤 질문")).toEqual([
        LEARNING,
        PROBE,
      ]);
      expect(await second.connection.request("hooks.order.get", {})).toEqual({
        hooks: [
          {
            hook: SETTLE,
            saved: [LEARNING, PROBE],
            applied: [LEARNING, PROBE],
            pending: false,
            pinned: [],
          },
        ],
      });
      expect(settingsOf(home)).toEqual({
        ...TAPE_SETTINGS,
        [KEY]: { [SETTLE]: [LEARNING, PROBE] },
      });
    } finally {
      await closeHost(second);
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "a saved id whose extension is gone is accepted when saved, listed by get, and ignored at dispatch",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    writeHookProbe(home, PROBE, SETTLE);
    writeHookProbe(home, GONE, SETTLE);
    const first = await openHost(ANSWERS);
    try {
      // 저장할 때는 실린 확장이라 오류가 없다
      expect(
        await first.connection.request("hooks.order.set", {
          hook: SETTLE,
          order: [GONE, LEARNING, PROBE],
        }),
      ).toEqual({ hook: SETTLE, saved: [GONE, LEARNING, PROBE], appliesAt: "nextStepBoundary" });
    } finally {
      await closeHost(first);
    }
    // 확장 폴더를 지운다: 다음 시작에서 GONE은 실리지 않는다
    rmSync(join(home.root, "config", "extensions", GONE), { recursive: true, force: true });

    const second = await openHost(ANSWERS);
    try {
      const created = await second.connection.request("thread.create", {});
      // GONE의 자리는 없는 것으로 치고 남은 두 핸들러가 저장 순서대로 돈다
      expect(await turnOrder(second.connection, created.threadId, "질문")).toEqual([
        LEARNING,
        PROBE,
      ]);
      // 저장 목록에는 GONE이 그대로 남고 오류는 없다
      expect(await second.connection.request("hooks.order.get", {})).toEqual({
        hooks: [
          {
            hook: SETTLE,
            saved: [GONE, LEARNING, PROBE],
            applied: [GONE, LEARNING, PROBE],
            pending: false,
            pinned: [],
          },
        ],
      });
      const extensions = await second.connection.request("ext.list", {});
      expect(extensions.extensions.map((entry) => entry.name)).not.toContain(GONE);
    } finally {
      await closeHost(second);
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "preview of a closed first hook names the handler after the first answer as first_answer and first_failure_deny, with the handlers before it",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    writeHookProbe(home, FIRST_A, CALL);
    writeHookProbe(home, FIRST_B, CALL);
    const running = await openHost(ANSWERS);
    try {
      // 제안 [B, A]: B가 먼저 답하면 A는 실행되지 않고(first_answer), B가 실패하면 closed라서 거부로 멈춘다(first_failure_deny)
      expect(
        await running.connection.request("hooks.order.preview", {
          hook: CALL,
          order: [FIRST_B, FIRST_A],
        }),
      ).toEqual({
        hook: CALL,
        order: [FIRST_B, FIRST_A],
        saveable: true,
        guard: null,
        skips: [
          {
            registrationId: FIRST_A,
            extension: FIRST_A,
            reason: "first_answer",
            by: [userRef(FIRST_B)],
          },
          {
            registrationId: FIRST_A,
            extension: FIRST_A,
            reason: "first_failure_deny",
            by: [userRef(FIRST_B)],
          },
        ],
        valueChanges: [],
        // B는 면제가 아니고 뒤의 A를 가린다. 자동 끄기 대상이다
        autoDisable: [{ registrationId: FIRST_B, extension: FIRST_B, affects: [userRef(FIRST_A)] }],
      });
      // 미리보기는 저장하지 않는다
      expect(await running.connection.request("hooks.order.get", {})).toEqual({ hooks: [] });
    } finally {
      await closeHost(running);
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "preview of an open first hook lists first_answer only: no first_failure_deny and no auto-disable",
  async () => {
    // 내장 핸들러가 없는 thread.compact.before에 사용자 확장 두 개를 건다. 두 개가 있어야 앞선 핸들러의 답을 본다
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    writeHookProbe(home, COMPACT_A, COMPACT);
    writeHookProbe(home, COMPACT_B, COMPACT);
    const running = await openHost(ANSWERS);
    try {
      expect(
        await running.connection.request("hooks.order.preview", {
          hook: COMPACT,
          order: [COMPACT_B, COMPACT_A],
        }),
      ).toEqual({
        hook: COMPACT,
        order: [COMPACT_B, COMPACT_A],
        saveable: true,
        guard: null,
        skips: [
          {
            registrationId: COMPACT_A,
            extension: COMPACT_A,
            reason: "first_answer",
            by: [userRef(COMPACT_B)],
          },
        ],
        valueChanges: [],
        autoDisable: [],
      });
    } finally {
      await closeHost(running);
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "preview of a chain hook lists value changes for the handler after the first and no first reasons",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const running = await openHost(ANSWERS);
    try {
      // 기본 순서와 반대로 제안한다. 뒤 핸들러의 패치가 앞 핸들러의 값을 바꿀 수 있다(valueChanges).
      // input.user.before에는 멈춤 규칙(handled)이 있어 뒤 핸들러는 chain_stop으로도 표시된다
      expect(
        await running.connection.request("hooks.order.preview", {
          hook: CHAIN,
          order: [CHAIN_SECOND, CHAIN_FIRST],
        }),
      ).toEqual({
        hook: CHAIN,
        order: [CHAIN_SECOND, CHAIN_FIRST],
        saveable: true,
        guard: null,
        skips: [
          {
            registrationId: CHAIN_FIRST,
            extension: CHAIN_FIRST,
            reason: "chain_stop",
            by: [builtinRef(CHAIN_SECOND)],
          },
        ],
        valueChanges: [
          {
            registrationId: CHAIN_FIRST,
            extension: CHAIN_FIRST,
            by: [builtinRef(CHAIN_SECOND)],
          },
        ],
        autoDisable: [],
      });
    } finally {
      await closeHost(running);
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "nearest to the guard pin: the real host has no guard-tier handler, so pinned stays empty and a reorder is saved and applied unpinned",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    writeHookProbe(home, PROBE, SETTLE);
    const running = await openHost(ANSWERS);
    const { connection } = running;
    try {
      // 가드 tier(0) 핸들러가 한 줄도 없다. 고정 대상이 없어서 `pinned`는 어느 훅에서도 비어 있다
      const listed = await connection.request("hooks.list", {});
      const rows = listed.hooks.flatMap((row) => row.order ?? []);
      expect(rows.filter((entry) => entry.tier === 0)).toEqual([]);
      const created = await connection.request("thread.create", {});
      expect(
        await connection.request("hooks.order.set", { hook: SETTLE, order: [LEARNING, PROBE] }),
      ).toEqual({ hook: SETTLE, saved: [LEARNING, PROBE], appliesAt: "nextStepBoundary" });
      expect(await turnOrder(connection, created.threadId, "질문")).toEqual([LEARNING, PROBE]);
      expect(await connection.request("hooks.order.get", {})).toEqual({
        hooks: [
          {
            hook: SETTLE,
            saved: [LEARNING, PROBE],
            applied: [LEARNING, PROBE],
            pending: false,
            pinned: [],
          },
        ],
      });
    } finally {
      await closeHost(running);
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "nearest to the guard rejection: with no guard-tier row, reversing two first-hook handlers is saved and previewed as saveable",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    writeHookProbe(home, FIRST_A, CALL);
    writeHookProbe(home, FIRST_B, CALL);
    const running = await openHost(ANSWERS);
    const { connection } = running;
    try {
      // 3404(hooks.guardPinned)는 guard tier 핸들러가 있어야 닿는다. 이 호스트에는 없어서 뒤집기도 저장된다
      expect(
        await connection.request("hooks.order.set", { hook: CALL, order: [FIRST_B, FIRST_A] }),
      ).toEqual({ hook: CALL, saved: [FIRST_B, FIRST_A], appliesAt: "nextStepBoundary" });
      expect(await connection.request("hooks.order.get", {})).toEqual({
        hooks: [{ hook: CALL, saved: [FIRST_B, FIRST_A], applied: [], pending: true, pinned: [] }],
      });
      const preview = await connection.request("hooks.order.preview", {
        hook: CALL,
        order: [FIRST_A, FIRST_B],
      });
      expect(preview).toMatchObject({ saveable: true, guard: null });
    } finally {
      await closeHost(running);
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "reset of one hook removes its saved order from the settings file and, after the next turn, the dispatch is back to the default",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    writeHookProbe(home, PROBE, SETTLE);
    const running = await openHost(ANSWERS);
    const { connection } = running;
    try {
      const created = await connection.request("thread.create", {});
      expect(
        await connection.request("hooks.order.set", { hook: SETTLE, order: [LEARNING, PROBE] }),
      ).toEqual({ hook: SETTLE, saved: [LEARNING, PROBE], appliesAt: "nextStepBoundary" });
      expect(await turnOrder(connection, created.threadId, "적용 전 질문")).toEqual([
        LEARNING,
        PROBE,
      ]);

      expect(await connection.request("hooks.order.reset", { hook: SETTLE })).toEqual({
        hooks: [SETTLE],
        appliesAt: "nextStepBoundary",
      });
      // 마지막 저장 훅이 지워지면 키 자체가 빠진다
      expect(settingsOf(home)).toEqual(TAPE_SETTINGS);
      // 저장 값은 비었고 적용 중인 순서는 다음 경계까지 남아 보류다
      expect(await connection.request("hooks.order.get", {})).toEqual({
        hooks: [{ hook: SETTLE, saved: [], applied: [LEARNING, PROBE], pending: true, pinned: [] }],
      });
      expect(await turnOrder(connection, created.threadId, "되돌린 뒤 질문")).toEqual([
        PROBE,
        LEARNING,
      ]);
      expect(await connection.request("hooks.order.get", {})).toEqual({ hooks: [] });

      // 저장된 것이 없는 훅을 되돌리면 빈 목록이다
      expect(await connection.request("hooks.order.reset", { hook: SETTLE })).toEqual({
        hooks: [],
        appliesAt: "nextStepBoundary",
      });
    } finally {
      await closeHost(running);
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "reset without a hook clears every saved hook in sorted order, and a reset with nothing saved answers an empty list",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    writeHookProbe(home, PROBE, SETTLE);
    writeHookProbe(home, FIRST_A, CALL);
    writeHookProbe(home, FIRST_B, CALL);
    const running = await openHost(ANSWERS);
    const { connection } = running;
    try {
      const created = await connection.request("thread.create", {});
      expect(
        await connection.request("hooks.order.set", { hook: SETTLE, order: [LEARNING, PROBE] }),
      ).toEqual({ hook: SETTLE, saved: [LEARNING, PROBE], appliesAt: "nextStepBoundary" });
      expect(
        await connection.request("hooks.order.set", { hook: CALL, order: [FIRST_B, FIRST_A] }),
      ).toEqual({ hook: CALL, saved: [FIRST_B, FIRST_A], appliesAt: "nextStepBoundary" });
      expect(await turnOrder(connection, created.threadId, "적용 전 질문")).toEqual([
        LEARNING,
        PROBE,
      ]);

      expect(await connection.request("hooks.order.reset", {})).toEqual({
        hooks: [SETTLE, CALL],
        appliesAt: "nextStepBoundary",
      });
      expect(settingsOf(home)).toEqual(TAPE_SETTINGS);
      expect(await turnOrder(connection, created.threadId, "되돌린 뒤 질문")).toEqual([
        PROBE,
        LEARNING,
      ]);
      expect(await connection.request("hooks.order.get", {})).toEqual({ hooks: [] });
      expect(await connection.request("hooks.order.reset", {})).toEqual({
        hooks: [],
        appliesAt: "nextStepBoundary",
      });
    } finally {
      await closeHost(running);
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "an unknown hook is refused with 3405 hooks.notFound by set, reset and preview, and nothing is written",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    writeHookProbe(home, PROBE, SETTLE);
    const running = await openHost(ANSWERS);
    const { connection } = running;
    try {
      const unknown = "no.such.hook";
      expect(
        await failureOf(connection.request("hooks.order.set", { hook: unknown, order: [PROBE] })),
      ).toMatchObject({ code: 3405, data: { kind: "hooks.notFound", details: { hook: unknown } } });
      expect(
        await failureOf(connection.request("hooks.order.reset", { hook: unknown })),
      ).toMatchObject({ code: 3405, data: { kind: "hooks.notFound", details: { hook: unknown } } });
      expect(
        await failureOf(connection.request("hooks.order.preview", { hook: unknown, order: [] })),
      ).toMatchObject({ code: 3405, data: { kind: "hooks.notFound", details: { hook: unknown } } });
      expect(await connection.request("hooks.order.get", {})).toEqual({ hooks: [] });
      expect(settingsOf(home)).toEqual(TAPE_SETTINGS);
    } finally {
      await closeHost(running);
      home.dispose();
    }
  },
  60_000,
);
