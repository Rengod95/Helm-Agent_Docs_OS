import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { ok, parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import type { ResolvedBinary, SecretEntryAction } from "@fresnel/contracts/services";
import type { HostConnection, Transport } from "@fresnel/contracts/wire";
import {
  createSecretsRuntime,
  type SecretsRuntime,
  type SecretsRuntimeDeps,
} from "@fresnel/platform-secrets";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, type InProcessHost } from "../../src/main.ts";
import { connectServiceTransport, startService, type ServiceHandle } from "../../src/index.ts";
import { fakeKeychain, type FakeKeychain } from "../fixtures/fake-keychain.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { manualTime, scratchRuntimeDir } from "../fixtures/service-harness.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, type EventCollector } from "../fixtures/wire-client.ts";

// 서비스 on/off × 열쇠 방식 시험 표 (L0.secrets.spec §4.7, L4.host-service.spec §3.4, L4.cli.spec §4.7).
// 시크릿 런타임은 운영 구현(`createSecretsRuntime`)이고 sops와 age 암복호도 실제다. 가짜는 OS 키 저장소뿐이다:
// `security` 자리에 놓는 임시 셸 스크립트(fixtures/fake-keychain.ts)이고, 열쇠 파일과 키체인 항목은 임시 홈 안에만 있다.
// 실제 HOME, 실제 키체인, 실제 열쇠는 건드리지 않는다(HOME도 임시 디렉터리로 돌린다).
//
// 조합 × 동작. 각 조합은 등록(add) → 시험(test) → 바꾸기(set) → 시험 → 회전(rotate) → 시험 → 값 보기(reveal) → 지우기(rm) 순서다.
//   (A) 서비스 모드 + file     : 값은 같은 컴퓨터의 로컬 일회용 채널로 오고 간다. reveal은 tty-confirm
//   (B) 서비스 모드 + keychain : (A)와 같되 열쇠는 OS 키 저장소(가짜)에 있고 sops는 SOPS_AGE_KEY_CMD로 받는다
//   (C) 앱 안 모드 + file      : 값은 맡긴 수단(secretOutOfBand offers)으로 간다. reveal은 offerReveal
//   (D) 앱 안 모드 + keychain  : (C)와 같되 열쇠는 가짜 키 저장소에 있다
//   (E) file → keychain 옮기기(keys.move, 서비스와 앱 안 각각): 등록 → 옮기기 → 시험 decryptable true → 옛 파일 열쇠 없음,
//       옮긴 뒤 쓴 값과 값 보기도 같은 길로 풀린다
// (A)~(E) 모두 세 번의 값이 wire 프레임(보낸 것과 받은 것, 이벤트 알림 포함), 이벤트 기록, 임시 홈의 파일 어디에도 평문으로 없다.
// 통과 여부는 이 시험의 실행이 증명한다. 위 표기는 무엇을 보는지만 말한다.

const gate = await realEngineGate();
const sopsReady = Bun.which("sops") !== null && Bun.which("age-keygen") !== null;
const sopsTest = sopsReady && gate.blocker === undefined ? test : test.skip;

test.skipIf(sopsReady)(
  "sops or age-keygen missing on this machine: the secret matrix is skipped (environment, not code)",
  () => {
    expect(sopsReady).toBe(false);
  },
);

type RuntimeKind = "service" | "in-app";
type KeySource = "file" | "keychain";

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error(`not a secret name: ${text}`);
  return parsed.value;
}

const NAME = nameOf("matrix-key");
const FIRST = "matrix-fake-first-0101";
const SECOND = "matrix-fake-second-0202";
const ROTATED = "matrix-fake-rotated-0303";
const MOVED = "matrix-fake-moved-0404";

function prefixOf(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** 값을 맡기는 수단(SecretValueSource). 메모리 값 하나를 준다 */
function sourceOf(value: string) {
  return {
    read: () => Promise.resolve(ok(new TextEncoder().encode(value))),
  };
}

/** CLI 쪽 흉내(같은 컴퓨터의 일회용 소켓). `value`를 쓰고 닫거나(입력), 호스트가 쓴 것을 모은다(열람) */
interface Channel {
  readonly path: string;
  readonly done: Promise<void>;
  readonly received: string[];
  dispose(): void;
}

function channelWith(mode: { readonly value: string } | { readonly collect: true }): Channel {
  // 소켓 경로 한도(103바이트)를 넘지 않도록 짧은 임시 폴더를 쓴다
  const dir = mkdtempSync(join(tmpdir(), "xmx-ch-"));
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

/** 보낸 것과 받은 것을 모두 남기는 전송 감싸기. 값이 프레임(이벤트 알림 포함)에 있는지 본다 */
function recorded(inner: Transport, frames: string[]): Transport {
  return {
    kind: inner.kind,
    send(message) {
      frames.push(JSON.stringify(message));
      return inner.send(message);
    },
    onMessage(handler) {
      return inner.onMessage((message) => {
        frames.push(JSON.stringify(message));
        handler(message);
      });
    },
    onClose: (handler) => inner.onClose(handler),
    close: (reason) => inner.close(reason),
  };
}

/** `security` 해석만 가짜 스크립트로 바꾼다. 나머지 해석과 운영 제공자 코드는 그대로다 */
function runtimeWith(keychain: FakeKeychain): (deps: SecretsRuntimeDeps) => SecretsRuntime {
  const shim: ResolvedBinary = {
    name: "security",
    path: keychain.securityPath,
    version: "fake",
    source: "system",
  };
  return (deps) =>
    createSecretsRuntime({
      ...deps,
      os: {
        ...deps.os,
        resolveBinary: (name, options, signal) =>
          name === "security"
            ? Promise.resolve(ok(shim))
            : deps.os.resolveBinary(name, options, signal),
      },
    });
}

/** 연결 하나. 서비스와 앱 안이 같은 모양이다 */
interface Link {
  readonly connection: HostConnection;
  readonly events: EventCollector;
  /** add·set·rotate 값 입력. 서비스는 로컬 채널, 앱 안은 맡긴 수단이다 */
  enter(action: SecretEntryAction, name: SecretName, value: string): Promise<{ started: boolean }>;
  /** 값 보기. 서비스는 로컬 채널과 tty-confirm, 앱 안은 offerReveal이다 */
  reveal(name: SecretName): Promise<{ started: boolean; value: string }>;
  stop(): Promise<void>;
}

async function startInAppLink(keychain: FakeKeychain, frames: string[]): Promise<Link> {
  const host: InProcessHost = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    secretsRuntime: runtimeWith(keychain),
  });
  const connection = createHostConnection(recorded(host.client, frames));
  await connection.request("host.hello", HELLO_PARAMS);
  const events = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  return {
    connection,
    events,
    async enter(action, name, value) {
      host.secretOutOfBand.offerEntry({ name, action, source: sourceOf(value) });
      return connection.request("secret.beginEntry", { name, action });
    },
    async reveal(name) {
      const shown: string[] = [];
      host.secretOutOfBand.offerReveal({
        name,
        reauth: { method: "tty-confirm", verifiedAt: Date.now() },
        show: (view) => {
          shown.push(view.text());
          return Promise.resolve();
        },
      });
      const started = await connection.request("secret.beginReveal", { name });
      return { started: started.started, value: shown.join("") };
    },
    async stop() {
      await connection.close();
      await host.close();
    },
  };
}

async function startServiceLink(keychain: FakeKeychain, frames: string[]): Promise<Link> {
  const runtime = scratchRuntimeDir();
  const started = await startService({
    runtimeDir: runtime.dir,
    assemble: {
      devChecks: true,
      defaultGroups: false,
      secretsRuntime: runtimeWith(keychain),
    },
    time: manualTime(),
    handleSignals: false,
    startupGraceMs: 0,
    idleGraceMs: 60_000,
  });
  if (!started.started) {
    runtime.dispose();
    throw new Error("the service did not start");
  }
  const handle: ServiceHandle = started.handle;
  const transport = await connectServiceTransport({
    kind: "unix",
    path: handle.registration.socket,
  });
  if (!transport.ok) {
    await handle.shutdown("stop");
    runtime.dispose();
    throw new Error(`cannot connect to the service: ${transport.error.kind}`);
  }
  const connection = createHostConnection(recorded(transport.value, frames));
  await connection.request("host.hello", HELLO_PARAMS);
  const events = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  return {
    connection,
    events,
    async enter(action, name, value) {
      const entry = channelWith({ value });
      try {
        return await connection.request("secret.beginEntry", {
          name,
          action,
          channel: entry.path,
        });
      } finally {
        entry.dispose();
      }
    },
    async reveal(name) {
      const out = channelWith({ collect: true });
      try {
        const shown = await connection.request("secret.beginReveal", {
          name,
          channel: out.path,
          reauth: "tty-confirm",
        });
        if (shown.started) await out.done;
        return { started: shown.started, value: out.received.join("") };
      } finally {
        out.dispose();
      }
    },
    async stop() {
      await connection.close();
      await handle.shutdown("stop");
      runtime.dispose();
    },
  };
}

interface Harness {
  readonly home: EngineHome;
  readonly key: KeySource;
  readonly keychain: FakeKeychain;
  readonly frames: string[];
  readonly link: Link;
}

/** sops 자식에게 넘어가는 HOME도 임시 디렉터리로 돌린다. 되돌리는 함수를 돌려준다 */
function redirectHome(root: string): () => void {
  const prior = process.env["HOME"];
  const fake = join(root, "home");
  mkdirSync(fake, { recursive: true, mode: 0o700 });
  process.env["HOME"] = fake;
  return () => {
    if (prior === undefined) delete process.env["HOME"];
    else process.env["HOME"] = prior;
  };
}

/** 임시 홈 파일 어디에도 값의 평문이 없는지 본다(로그, 감사, 설정, 열쇠 파일, sops 파일). 소켓 같은 특수 파일은 건너뛴다 */
function filesHold(dir: string, value: string): boolean {
  for (const entry of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const path = join(dir, entry);
    if (!statSync(path).isFile()) continue;
    if (readFileSync(path).includes(value)) return true;
  }
  return false;
}

function leaked(h: Harness, value: string): boolean {
  if (h.frames.some((frame) => frame.includes(value))) return true;
  if (JSON.stringify(h.link.events.events).includes(value)) return true;
  return filesHold(h.home.root, value);
}

async function withHost(
  runtime: RuntimeKind,
  key: KeySource,
  body: (h: Harness) => Promise<void>,
): Promise<void> {
  const home = useEngineHome();
  const restoreHome = redirectHome(home.root);
  const keychain = fakeKeychain();
  const frames: string[] = [];
  try {
    writeUserSettings(home, { "l0.secrets.ageKey.source": key });
    const link =
      runtime === "service"
        ? await startServiceLink(keychain, frames)
        : await startInAppLink(keychain, frames);
    try {
      await body({ home, key, keychain, frames, link });
    } finally {
      await link.stop();
    }
  } finally {
    keychain.dispose();
    restoreHome();
    home.dispose();
  }
}

/** 시험(test)의 기대: 등록되어 있고 풀리며 길이와 해시 앞 8자가 값과 같다 */
async function expectHolds(link: Link, name: SecretName, value: string): Promise<void> {
  const tested = await link.connection.request("secret.test", { name });
  expect(tested).toMatchObject({
    state: "registered",
    decryptable: true,
    length: value.length,
    sha256Prefix: prefixOf(value),
  });
}

/** (A)~(D)의 한 번 흐름: add, test, set, test, rotate, test, reveal, rm */
async function matrixFlow(h: Harness): Promise<void> {
  const { link } = h;
  expect(await link.enter("add", NAME, FIRST)).toEqual({ started: true });
  await expectHolds(link, NAME, FIRST);
  // 양성 대조: 열쇠가 실제로 선택한 쪽에 있다(다른 쪽에는 없다)
  expect(h.keychain.holds()).toBe(h.key === "keychain");
  expect(existsSync(join(h.home.root, "config", "secrets", "age", "keys.txt"))).toBe(
    h.key === "file",
  );

  expect(await link.enter("set", NAME, SECOND)).toEqual({ started: true });
  await expectHolds(link, NAME, SECOND);

  expect(await link.enter("rotate", NAME, ROTATED)).toEqual({ started: true });
  await expectHolds(link, NAME, ROTATED);

  expect(await link.reveal(NAME)).toEqual({ started: true, value: ROTATED });
  // 양성 대조: 프레임 기록이 실제 요청을 잡고, 임시 홈 검사는 sops 파일(암호문)을 읽는다
  expect(h.frames.some((frame) => frame.includes("secret.beginReveal"))).toBe(true);
  expect(filesHold(h.home.root, "ENC[")).toBe(true);

  expect(await link.connection.request("secret.remove", { name: NAME })).toEqual({
    removed: true,
  });
  const listed = await link.connection.request("secret.list", {});
  expect(listed.secrets.some((secret) => secret.name === NAME)).toBe(false);

  for (const value of [FIRST, SECOND, ROTATED]) {
    expect(leaked(h, value)).toBe(false);
  }
}

const COMBOS: readonly {
  readonly label: string;
  readonly runtime: RuntimeKind;
  readonly key: KeySource;
}[] = [
  { label: "A", runtime: "service", key: "file" },
  { label: "B", runtime: "service", key: "keychain" },
  { label: "C", runtime: "in-app", key: "file" },
  { label: "D", runtime: "in-app", key: "keychain" },
];

for (const combo of COMBOS) {
  sopsTest(
    `(${combo.label}) ${combo.runtime} mode + ${combo.key}: add, test, set, test, rotate, test, reveal and rm; no value in frames, events or files`,
    () => withHost(combo.runtime, combo.key, matrixFlow),
    120_000,
  );
}

// (E): file → keychain 옮기기. 서비스와 앱 안에서 각각
for (const runtime of ["service", "in-app"] as const) {
  sopsTest(
    `(E) ${runtime} mode: keys.move file → keychain keeps the registered secret decryptable and removes the old file key`,
    () =>
      withHost(runtime, "file", async (h) => {
        const { link } = h;
        expect(await link.enter("add", NAME, FIRST)).toEqual({ started: true });
        expect(await link.connection.request("secret.keyStatus", {})).toMatchObject({
          source: "file",
          in: "file",
        });

        expect(await link.connection.request("secret.keyMove", { to: "keychain" })).toMatchObject({
          moved: true,
          created: true,
          oldRemoved: true,
          source: "keychain",
        });
        expect(await link.connection.request("secret.keyStatus", {})).toMatchObject({
          source: "keychain",
          in: "keychain",
        });

        // 옮긴 뒤에도 기존 시크릿이 풀린다. 옛 쪽 열쇠 파일은 없고 키 저장소에 항목이 생겼다
        await expectHolds(link, NAME, FIRST);
        expect(existsSync(join(h.home.root, "config", "secrets", "age", "keys.txt"))).toBe(false);
        expect(h.keychain.holds()).toBe(true);

        // 옮긴 뒤 쓴 값도 같은 길로 풀리고 값 보기도 된다
        expect(await link.enter("set", NAME, MOVED)).toEqual({ started: true });
        await expectHolds(link, NAME, MOVED);
        expect(await link.reveal(NAME)).toEqual({ started: true, value: MOVED });

        for (const value of [FIRST, MOVED]) {
          expect(leaked(h, value)).toBe(false);
        }
      }),
    120_000,
  );
}
