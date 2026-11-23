import { expect, test } from "bun:test";
import type { ExtMethodDecl } from "@fresnel/contracts/extensions";
import { hostOf, registrationToggleSourceOf } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

// 앱 화면은 그 대화의 프로필에 없는 플러그인도 연다(pgRe §3.6, AGE-78 질문 3). 메서드는 돌고, 훅은 켜진 대화에서만 돈다.
// 전체로 꺼진 플러그인과 설치되지 않은 플러그인은 열리지 않는다.

type Host = Awaited<ReturnType<typeof createTestHost>>;

const decl = (verb: string, readOnly: boolean): ExtMethodDecl => ({
  verb,
  params: {},
  result: {},
  readOnly,
});

function callOf(
  t: Host,
  extension: string,
  verb: string,
  thread: ReturnType<Host["newThread"]> | null,
) {
  return t.host.methods.call({
    extension,
    verb,
    params: {},
    threadId: thread,
    signal: new AbortController().signal,
    caller: "ui",
  });
}

async function installApp(t: Host, seen: string[], who: (id: string | null) => void) {
  await t.host.install(
    makeUnit(
      {
        name: "appun",
        hooks: ["boundary.settle.after"],
        initialEnabled: false,
        methods: [decl("board", true), decl("poke", false)],
      },
      (g) => {
        g.on("boundary.settle.after", (_payload, ctx) => {
          seen.push(ctx.threadId);
        });
        const api = hostOf(g);
        api.registerMethod("board", {
          handler: (_params, ctx) => {
            who(ctx.threadId);
            return Promise.resolve(null);
          },
        });
        api.registerMethod("poke", {
          handler: (_params, ctx) => {
            who(ctx.threadId);
            return Promise.resolve(null);
          },
        });
      },
    ),
  );
}

async function fire(t: Host, thread: ReturnType<Host["newThread"]>, key: string): Promise<void> {
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}

test("an app of a plugin that no profile has runs its read and write methods, without a thread, and its hook stays off", async () => {
  const t = await createTestHost();
  const a = t.newThread();
  const b = t.newThread();
  const seen: string[] = [];
  const callers: (string | null)[] = [];
  await installApp(t, seen, (id) => callers.push(id));
  await t.host.openThread(a);
  await t.host.openThread(b);
  await t.settled();
  expect(t.host.methods.list()).toEqual([]);

  // 어느 대화의 프로필에도 없다: 호출은 열리고 처리기는 대화 없이 불린다
  expect(await callOf(t, "appun", "board", a)).toEqual({ kind: "ok", value: null });
  expect(await callOf(t, "appun", "poke", null)).toEqual({ kind: "ok", value: null });
  expect(callers).toEqual([null, null]);
  // 훅은 대화의 켜짐 집합에 있을 때만 돈다
  await fire(t, a, "k-a");
  await fire(t, b, "k-b");
  expect(seen).toEqual([]);

  // 대화 b의 프로필이 켜면 b에서는 훅이 돌고 처리기가 b를 받는다. a는 여전히 대화 없이 돈다
  registrationToggleSourceOf(t.host).request("appun", true, "request", b);
  await t.settled();
  await fire(t, a, "k-a2");
  await fire(t, b, "k-b2");
  expect(seen).toEqual([b]);
  callers.length = 0;
  expect(await callOf(t, "appun", "board", b)).toEqual({ kind: "ok", value: null });
  expect(await callOf(t, "appun", "board", a)).toEqual({ kind: "ok", value: null });
  expect(callers).toEqual([b, null]);
});

test("a plugin switched off for everyone and a plugin that is not installed do not open", async () => {
  const t = await createTestHost();
  const a = t.newThread();
  const seen: string[] = [];
  await installApp(t, seen, () => {});
  await t.host.openThread(a);
  await t.settled();
  expect(await callOf(t, "appun", "board", a)).toEqual({ kind: "ok", value: null });

  // 전체 끄기: 열려 있던 세대도 닫히고 다시 열리지 않는다
  registrationToggleSourceOf(t.host).request("appun", false, "request", undefined);
  await t.settled();
  expect(await callOf(t, "appun", "board", a)).toEqual({ kind: "extension_off" });
  expect(await callOf(t, "appun", "poke", null)).toEqual({ kind: "extension_off" });

  // 다시 켜면 열린다
  registrationToggleSourceOf(t.host).request("appun", true, "request", undefined);
  await t.settled();
  expect(await callOf(t, "appun", "board", a)).toEqual({ kind: "ok", value: null });

  // 설치되지 않은 플러그인과 선언 없는 메서드
  expect(await callOf(t, "nothere", "board", a)).toEqual({ kind: "not_found" });
  expect(await callOf(t, "appun", "nope", a)).toEqual({ kind: "not_found" });
});
