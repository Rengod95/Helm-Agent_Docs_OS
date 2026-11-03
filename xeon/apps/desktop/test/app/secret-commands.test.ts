import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import type { SecretListEntry } from "@fresnel/contracts/wire";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 시크릿 명령(`commands.secrets`)을 가짜 엔진 위에서 끝까지 돌린다. 메서드와 인자가 맞는지, 결과 값이 그대로 오는지,
// `secret.*` 오류 종류가 화면이 구분하는 종류로 바뀌는지, 값은 셸 명령(등록 ipc)으로만 가는지 본다.

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
}

const NAME = nameOf("exa-api-key");

const ENTRY: SecretListEntry = {
  name: NAME,
  status: "valid",
  lastUsedAt: "2026-11-03T10:00:00.000Z",
};

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const paramsOf = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.find((entry) => entry.method === method)?.params;

describe("secret.list reads the metadata and usage", () => {
  test("the list asks for meta and usage, and returns the host's entries as they came", async () => {
    const { app, params } = await liveApp({ results: { "secret.list": { secrets: [ENTRY] } } });
    const listed = await app.commands.secrets.list();
    expect(listed).toEqual({ ok: true, value: [ENTRY] });
    expect(paramsOf(params, "secret.list")).toEqual({ meta: true, usage: true });
    await app.stop();
  });

  test("a host without secret.list gets the unsupported command error", async () => {
    const { app } = await liveApp({
      errors: { "secret.list": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    expect(await app.commands.secrets.list()).toEqual({
      ok: false,
      error: { kind: "unsupported" },
    });
    await app.stop();
  });

  test("with no connection the list is offline", async () => {
    const engine = engineFake([summary(thr(1))]);
    const app = makeApp(engine.fake);
    expect(await app.commands.secrets.list()).toEqual({ ok: false, error: { kind: "offline" } });
    await app.stop();
  });
});

describe("secret wire errors keep the kinds the screen tells apart", () => {
  test("not found, in use, and reauth required are their own kinds; other failures are failed", async () => {
    const { app } = await liveApp({
      errors: {
        "secret.references": { code: 3201, kind: "secret.notFound" },
        "secret.remove": { code: 3206, kind: "secret.inUse" },
        "secret.beginReveal": { code: 3209, kind: "secret.reauthRequired" },
        "secret.test": { code: 3203, kind: "secret.providerUnavailable" },
      },
    });
    expect(await app.commands.secrets.references(NAME)).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
    expect(await app.commands.secrets.remove(NAME)).toEqual({
      ok: false,
      error: { kind: "inUse" },
    });
    expect(await app.commands.secrets.beginReveal(NAME)).toEqual({
      ok: false,
      error: { kind: "reauthRequired" },
    });
    expect(await app.commands.secrets.test(NAME)).toEqual({ ok: false, error: { kind: "failed" } });
    await app.stop();
  });
});

describe("the other secret methods return the host's values", () => {
  test("references and test pass their results through", async () => {
    const { app, params } = await liveApp({
      results: {
        "secret.references": { settingKeys: [], activeLeases: 0, sessions: [] },
        "secret.test": {
          state: "registered",
          decryptable: true,
          length: 108,
          sha256Prefix: "1f3a9c0e",
        },
      },
    });
    expect(await app.commands.secrets.references(NAME)).toEqual({
      ok: true,
      value: { settingKeys: [], activeLeases: 0, sessions: [] },
    });
    expect(await app.commands.secrets.test(NAME)).toEqual({
      ok: true,
      value: { state: "registered", decryptable: true, length: 108, sha256Prefix: "1f3a9c0e" },
    });
    expect(paramsOf(params, "secret.test")).toEqual({ name: NAME });
    await app.stop();
  });

  test("editing metadata sends secret.meta and returns the changed entry", async () => {
    const { app, params } = await liveApp({ results: { "secret.meta": { secret: ENTRY } } });
    const edited = await app.commands.secrets.editMeta({
      name: NAME,
      desc: "search key",
      approval: "none",
    });
    expect(edited).toEqual({ ok: true, value: ENTRY });
    expect(paramsOf(params, "secret.meta")).toEqual({
      name: NAME,
      desc: "search key",
      approval: "none",
    });
    await app.stop();
  });

  test("removing sends secret.remove and reports whether it removed", async () => {
    const { app } = await liveApp({ results: { "secret.remove": { removed: true } } });
    expect(await app.commands.secrets.remove(NAME)).toEqual({ ok: true, value: true });
    await app.stop();
  });

  test("beginEntry reports started, and false means this screen takes the value", async () => {
    const { app, params } = await liveApp({ results: { "secret.beginEntry": { started: false } } });
    expect(await app.commands.secrets.beginEntry(NAME, "set")).toEqual({ ok: true, value: false });
    expect(paramsOf(params, "secret.beginEntry")).toEqual({ name: NAME, action: "set" });
    await app.stop();
  });

  test("beginReveal returns only whether the host showed the value, never the value", async () => {
    const { app, params } = await liveApp({ results: { "secret.beginReveal": { started: true } } });
    expect(await app.commands.secrets.beginReveal(NAME)).toEqual({ ok: true, value: true });
    expect(paramsOf(params, "secret.beginReveal")).toEqual({ name: NAME });
    await app.stop();
  });
});

describe("the value goes through the shell command, not the wire", () => {
  test("registerKey hands the bytes to the shell's register command", async () => {
    const { app, fake } = await liveApp({});
    const bytes = new TextEncoder().encode("fake-value-for-tests");
    expect(await app.commands.secrets.registerKey(NAME, "add", bytes)).toEqual({
      ok: true,
      value: null,
    });
    expect(fake.registered).toEqual([{ name: NAME, action: "add", text: "fake-value-for-tests" }]);
    await app.stop();
  });

  test("a shell that cannot take the value reports unavailable, with no detail", async () => {
    const { app } = await liveApp({ registerError: { kind: "unavailable", detail: "no shell" } });
    const bytes = new TextEncoder().encode("fake-value-for-tests");
    expect(await app.commands.secrets.registerKey(NAME, "set", bytes)).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
    await app.stop();
  });
});
