import { expect, test } from "bun:test";
import type { SecretMeta } from "@fresnel/contracts/capabilities";
import { parseSecretRef } from "@fresnel/contracts/capabilities";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { accountRotationGroup } from "@fresnel/group-account-rotation";
import { memorySecrets } from "@fresnel/platform-secrets/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// l1/M-01, l3/AR-03 (int): 조립된 호스트에서 계정 회전의 `onLimit: wait`는 포기하지 않고 스케줄러를 거쳐 기다린다.
// 가짜 provider(모델 테이프)가 계정 하나에 429(retry-after 1초)를 내고, 기다린 뒤 같은 계정으로 다시 보내면 답한다.
// 호스트가 core-models에 scheduler를 넘기지 않으면 즉시 "cooling down"으로 포기해 turn이 실패한다. 실제 계정과 키는 쓰지 않는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const REF = "secret://tape-account-a";
const KEY = "fresnel-fake-account-key-5d2c8e41a7b39f06";
const parsed = parseSecretRef(REF);
if (!parsed.ok) throw new Error("fixture secret reference is invalid");
const SECRET_NAME = parsed.value.name;

function metaOf(): SecretMeta {
  return {
    name: SECRET_NAME,
    desc: "Fake account key for the rotation wait test",
    provider: "sops",
    ref: "dev/TAPE_ACCOUNT_A",
    scope: "user",
    expiresAt: null,
    use: {
      modes: ["runtime-http"],
      tools: ["model.provider:*"],
      hosts: ["tape.example.test"],
      commands: [],
    },
    approval: "none",
    ttlSeconds: 900,
    maxUses: 50,
  };
}

const RETRY_AFTER_SECONDS = 1;

realTest(
  "with onLimit wait the assembled host waits out a 429 through the scheduler and the turn completes on the same account",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, {
      ...TAPE_SETTINGS,
      "l1.models.providers": [
        { id: "tape", enabled: true, apiKeyRef: null, baseUrl: "https://tape.example.test" },
      ],
      "l1.models.accounts": [
        { provider: "tape", accountId: "a", credential: REF, priority: 1, reservePct: 0 },
      ],
      "l1.models.rateLimit": { tape: { minIntervalMs: 0, onLimit: "wait", maxWaitMs: 5000 } },
      "ext.account-rotation.acknowledgeRisk": true,
    });
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      // 플러그인은 기본 꺼짐이다. 사용자가 켠 상태를 매니페스트 기본값으로 만든다
      extraPlugins: [
        {
          manifest: { ...accountRotationGroup.manifest, defaultEnabled: true },
          extension: accountRotationGroup.entry,
        },
      ],
      buildModels: tapeBuildModels(
        tapeProvider(
          tapePlayer(
            tape("rotation-wait", [
              {
                role: "main",
                label: "429 with retry-after",
                response: {
                  type: "error",
                  reason: "error",
                  errorMessage: `429 rate limit exceeded, retry-after: ${String(RETRY_AFTER_SECONDS)}`,
                },
              },
              {
                role: "main",
                label: "answer after the wait",
                response: {
                  type: "message",
                  content: [t.text("answered after waiting")],
                  stopReason: "stop",
                },
              },
            ]),
            { clock: realTapeClock() },
          ),
        ),
      ),
      secretsRuntime: (deps) => {
        const secrets = memorySecrets({
          clock: deps.os.time.clock,
          scheduler: deps.os.time.scheduler,
          ids: deps.ids,
          secrets: [{ meta: metaOf(), value: KEY }],
        });
        return { service: secrets, admin: secrets.admin };
      },
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      const began = Date.now();
      const started = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "hello",
      });
      const done = await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
        20_000,
      );
      expect(done.payload).toMatchObject({ status: "completed" });
      // 기다렸다: retry-after만큼 실제로 지났고, 답은 두 번째 호출의 것이다
      expect(Date.now() - began).toBeGreaterThanOrEqual(RETRY_AFTER_SECONDS * 1000 - 100);
      const texts = JSON.stringify(
        collector.events.filter((event) => event.kind === "item.recorded").map((e) => e.payload),
      );
      expect(texts).toContain("answered after waiting");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
