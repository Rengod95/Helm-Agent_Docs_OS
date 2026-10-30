import { expect, test } from "bun:test";
import { ModelsPortKey, type ProviderResourceDef } from "@xeon/contracts/extensions";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import { GroupSettingsSourceKey } from "@xeon/group-kit";
import { providerAnthropicOauthGroup } from "../../src/index.ts";

const ACK = "ext.provider-anthropic-oauth.acknowledgeRisk";
const CREDENTIAL = "ext.provider-anthropic-oauth.credential";

/**
 * 가짜 xeon.models 포트와 설정 값을 주고 그룹을 설치한다. 기본 꺼짐이라 사용자가 켠 것처럼 enable한 뒤
 * thread를 열어 setup을 돌린다. setup이 돈 것은 호출자가 scope 상태 "enabled"로 확인한다
 */
async function rigWith(values: Readonly<Record<string, unknown>>): Promise<{
  readonly t: TestHost;
  readonly registered: Map<string, ProviderResourceDef>;
}> {
  const t = await createTestHost();
  const registered = new Map<string, ProviderResourceDef>();
  await t.host.registerPlatform({
    name: "fake-models",
    setup(ctx) {
      ctx.providePort(ModelsPortKey, {
        registerProvider(_owner, name, config) {
          registered.set(name, config);
          return () => {
            registered.delete(name);
          };
        },
      });
    },
  });
  await t.host.registerPlatform({
    name: "settings-source",
    setup(ctx) {
      ctx.providePort(GroupSettingsSourceKey, { value: (key) => values[key] });
    },
  });
  await t.host.install({
    manifest: providerAnthropicOauthGroup.manifest,
    entry: providerAnthropicOauthGroup.entry,
    loadIndex: 0,
    builtin: false,
  });
  t.host.scope("provider-anthropic-oauth")?.enable();
  await t.host.openThread(t.newThread());
  await t.settled();
  expect(t.host.scope("provider-anthropic-oauth")?.status).toBe("enabled");
  return { t, registered };
}

test("setup.no-registration-without-the-risk-acknowledgement", async () => {
  const { t, registered } = await rigWith({ [ACK]: false, [CREDENTIAL]: "secret://oauth-token" });
  expect([...registered.keys()]).toEqual([]);
  expect(t.host.resources.list("provider")).toEqual([]);
});

test("setup.no-registration-without-a-credential-reference", async () => {
  const { t, registered } = await rigWith({ [ACK]: true, [CREDENTIAL]: null });
  expect([...registered.keys()]).toEqual([]);
  expect(t.host.resources.list("provider")).toEqual([]);
});

test("setup.defaults-register-nothing", async () => {
  const { registered } = await rigWith({});
  expect([...registered.keys()]).toEqual([]);
});

test("setup.registers-anthropic-oauth-once-and-releases-it-on-disable", async () => {
  const { t, registered } = await rigWith({ [ACK]: true, [CREDENTIAL]: "secret://oauth-token" });
  expect([...registered.keys()]).toEqual(["anthropic-oauth"]);
  expect(registered.get("anthropic-oauth")).toMatchObject({
    kind: "config",
    name: "Anthropic OAuth",
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
    apiKey: "secret://oauth-token",
    models: expect.arrayContaining([
      expect.objectContaining({ id: "claude-opus-5-5", reasoning: true, contextWindow: 1000000 }),
      expect.objectContaining({ id: "claude-sonnet-5-5", reasoning: true }),
      expect.objectContaining({ id: "claude-haiku-5-5", reasoning: true }),
    ]),
  });
  expect(t.host.resources.list("provider").map((record) => record.scopeId)).toEqual([
    "provider-anthropic-oauth",
  ]);

  // 그룹을 끄면 provider 등록이 풀린다
  t.host.scope("provider-anthropic-oauth")?.disable();
  await t.settled();
  expect(registered.size).toBe(0);
  expect(t.host.resources.list("provider")).toEqual([]);
});
