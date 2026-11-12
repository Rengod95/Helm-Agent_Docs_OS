import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import { memorySecrets } from "@fresnel/platform-secrets/testing";
import { startService, type ServiceHandle } from "../../src/index.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { connectedClient, manualTime, scratchRuntimeDir } from "../fixtures/service-harness.ts";

// 같은 컴퓨터의 서비스 접속이 로컬 일회용 채널로 값을 주고받는다(F wire §3.3.1, L4.cli.spec §4.7). 실제 서비스가 실제 유닉스
// 소켓에서 돈다. 시크릿 저장소만 메모리 대역이다(sops와 키체인을 쓰지 않는다). CLI 쪽 채널도 실제 소켓이다.
// 임시 홈과 임시 실행 폴더만 쓴다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
afterAll(() => {
  home.dispose();
});

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error(`not a secret name: ${text}`);
  return parsed.value;
}

const NAME = nameOf("exa-key");
const FIRST = "first-value-0123456";
const SECOND = "second-value-654321";

interface Channel {
  readonly path: string;
  /** 열람 시험: 호스트가 쓰고 닫아 끝까지 읽었을 때 끝난다 */
  readonly done: Promise<void>;
  readonly received: string[];
  dispose(): void;
}

/** CLI 쪽 흉내. 입력은 `value`를 쓰고 닫고, 열람은 호스트가 쓴 것을 모은다 */
function channelWith(mode: { readonly value: string } | { readonly collect: true }): Channel {
  const dir = mkdtempSync(join(tmpdir(), "xsvc-ch-"));
  const path = join(dir, "c.sock");
  const received: string[] = [];
  const finished = Promise.withResolvers<void>();
  const server: Server = createServer((socket: Socket) => {
    if ("collect" in mode) {
      socket.on("data", (chunk: Uint8Array) => {
        received.push(new TextDecoder().decode(chunk));
      });
      socket.on("end", () => finished.resolve());
      socket.on("close", () => finished.resolve());
      return;
    }
    socket.end(mode.value);
  });
  server.once("close", () => finished.resolve());
  server.listen(path);
  return {
    path,
    done: finished.promise,
    received,
    dispose() {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

realTest(
  "add, test, set, reveal and rm of a secret go through the local channel on a real service socket",
  async () => {
    const runtime = scratchRuntimeDir();
    const started = await startService({
      runtimeDir: runtime.dir,
      assemble: {
        devChecks: true,
        defaultGroups: false,
        secretsRuntime: (deps) => {
          const secrets = memorySecrets({
            clock: deps.os.time.clock,
            scheduler: deps.os.time.scheduler,
            ids: deps.ids,
            secrets: [],
          });
          return { service: secrets, admin: secrets.admin };
        },
      },
      time: manualTime(),
      handleSignals: false,
      startupGraceMs: 0,
      idleGraceMs: 60_000,
    });
    if (!started.started) throw new Error("the service did not start");
    const handle: ServiceHandle = started.handle;
    const connection = await connectedClient({ kind: "unix", path: handle.registration.socket });
    try {
      const entry = channelWith({ value: FIRST });
      expect(
        await connection.request("secret.beginEntry", {
          name: NAME,
          action: "add",
          channel: entry.path,
        }),
      ).toEqual({ started: true });
      entry.dispose();

      const tested = await connection.request("secret.test", { name: NAME });
      expect(tested).toMatchObject({
        state: "registered",
        decryptable: true,
        length: FIRST.length,
      });

      const replace = channelWith({ value: SECOND });
      expect(
        await connection.request("secret.beginEntry", {
          name: NAME,
          action: "set",
          channel: replace.path,
        }),
      ).toEqual({ started: true });
      replace.dispose();
      expect(await connection.request("secret.test", { name: NAME })).toMatchObject({
        length: SECOND.length,
      });

      const reveal = channelWith({ collect: true });
      const shown = await connection.request("secret.beginReveal", {
        name: NAME,
        channel: reveal.path,
        reauth: "tty-confirm",
      });
      expect(shown).toEqual({ started: true });
      await reveal.done;
      expect(reveal.received.join("")).toBe(SECOND);
      reveal.dispose();

      expect(await connection.request("secret.remove", { name: NAME })).toEqual({ removed: true });
    } finally {
      await connection.close();
      await handle.shutdown("stop");
      runtime.dispose();
    }
  },
);
