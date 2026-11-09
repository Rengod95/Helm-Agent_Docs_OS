// 게이트웨이 조립 시험: 실제 상태 파일, 실제 Unix 소켓의 가짜 서비스, 임시 UI 폴더로 `createWebApp`을 시작하고 멈춘다.
// 확인: 루프백 포트 보고, /login 200, 인증 없는 `/` 302, 기기 폐기 때 그 기기의 푸시 구독만 지워짐(실제 저장소와 실제 `revokeDevice`),
// 알림 원천이 서비스에 `host.hello`를 보냄, 환경 문제(소켓이나 UI가 없음)는 종료코드 2 값으로 돌아온다.
import { afterEach, describe, expect, test } from "bun:test";
import { attemptAsync } from "@fresnel/contracts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebApp, type WebApp, type WebAppConfig } from "../../../src/web/main/app.ts";
import type { WebOptions } from "../../../src/web/main/args.ts";
import { describeError } from "../../../src/web/main/errors.ts";
import { cleanupTempDirs, tempDir } from "../support/fixtures.ts";
import { recordingLogger } from "../support/logger.ts";
import {
  receivedBytes,
  rawHttp,
  settle,
  startFakeService,
  type FakeService,
} from "../server/support.ts";
import { waitFor } from "../session/support.ts";

const STATIC_DIR = fileURLToPath(new URL("../../../src/web/static", import.meta.url));
const INDEX =
  '<!doctype html><html><head><title>Fresnel</title></head><body><div id="root"></div></body></html>\n';

const apps: WebApp[] = [];
const services: FakeService[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.stop()));
  await Promise.all(services.splice(0).map((service) => service.close()));
  cleanupTempDirs();
});

interface Fixture {
  readonly root: string;
  readonly config: WebAppConfig;
  readonly service: FakeService;
}

/** 임시 폴더에 서비스 소켓과 UI 폴더를 만들고 시작 설정을 돌려준다 */
async function fixture(overrides: Partial<WebOptions> = {}): Promise<Fixture> {
  const root = tempDir();
  const uiDir = path.join(root, "ui");
  mkdirSync(uiDir, { recursive: true });
  writeFileSync(path.join(uiDir, "index.html"), INDEX);
  const service = await startFakeService(root);
  services.push(service);
  const options: WebOptions = {
    socketPath: service.path,
    stateDir: path.join(root, "state"),
    loopbackPort: 0,
    tls: null,
    uiDir,
    ...overrides,
  };
  const config: WebAppConfig = {
    options,
    staticDir: STATIC_DIR,
    resources: root,
    home: root,
    env: {},
    platform: process.platform,
    arch: process.arch,
    clock: { now: () => Date.now() },
    logger: recordingLogger(),
  };
  return { root, config, service };
}

async function startApp(config: WebAppConfig): Promise<WebApp> {
  const started = await createWebApp(config);
  if (!started.ok) throw new Error(`web app did not start: ${JSON.stringify(started.error)}`);
  apps.push(started.value);
  return started.value;
}

/** 브라우저가 내는 구독 모양(검증은 저장소의 `upsert`가 하지 않는다, 시험 값은 형식만 맞춘다) */
function subscriptionFor(name: string): {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
} {
  return {
    endpoint: `https://push.example.test/${name}`,
    p256dh: Buffer.concat([Buffer.of(0x04), Buffer.alloc(64, 7)]).toString("base64url"),
    auth: Buffer.alloc(16, 9).toString("base64url"),
  };
}

describe("createWebApp", () => {
  test("starts on a free loopback port: /login is served, / redirects without a device, and stop closes the port", async () => {
    const { config } = await fixture();
    const app = await startApp(config);
    const port = app.info.loopbackPort;
    expect(typeof port).toBe("number");
    expect(port).toBeGreaterThan(0);
    expect(app.info.tlsPort).toBeNull();
    expect(app.info.fingerprint).toBeNull();

    const login = await rawHttp({ port: port ?? 0, path: "/login" });
    expect(login.status).toBe(200);
    expect(login.headers["content-type"]).toContain("text/html");

    const root = await rawHttp({ port: port ?? 0, path: "/" });
    expect(root.status).toBe(302);
    expect(root.headers["location"]).toBe("/login");

    const session = await rawHttp({ port: port ?? 0, path: "/api/session" });
    expect(session.status).toBe(401);

    await app.stop();
    apps.splice(apps.indexOf(app), 1);
    const after = await attemptAsync(() => rawHttp({ port: port ?? 0, path: "/login" }));
    expect(after.ok).toBe(false);
  });

  test("the notice source connects to the service and sends host.hello with the push client name", async () => {
    const { config, service } = await fixture();
    await startApp(config);
    await waitFor("the service to see host.hello", () =>
      service.sides.some((side) =>
        receivedBytes(side).toString("utf8").includes('"method":"host.hello"'),
      ),
    );
    const side = service.sides.find((item) =>
      receivedBytes(item).toString("utf8").includes("fresnel-web-push"),
    );
    expect(side).toBeDefined();
  });

  test("revoking a device deletes its push subscriptions and keeps the other devices' subscriptions", async () => {
    const { config } = await fixture();
    const app = await startApp(config);
    const gone = app.auth.createPairingCode();
    const goneDevice = app.auth.redeemPairingCode({
      code: gone.code,
      deviceName: "Old phone",
      kind: "web",
      address: "127.0.0.1",
    });
    const kept = app.auth.createPairingCode();
    const keptDevice = app.auth.redeemPairingCode({
      code: kept.code,
      deviceName: "Desk",
      kind: "web",
      address: "127.0.0.1",
    });
    if (!goneDevice.ok || !keptDevice.ok) throw new Error("pairing failed");

    const removed = subscriptionFor("removed");
    const stays = subscriptionFor("stays");
    expect(app.subscriptions.upsert(goneDevice.value.device.id, removed).ok).toBe(true);
    expect(app.subscriptions.upsert(keptDevice.value.device.id, stays).ok).toBe(true);
    expect(app.subscriptions.listForDevice(goneDevice.value.device.id)).toHaveLength(1);

    const revoked = app.auth.revokeDevice(goneDevice.value.device.id);
    expect(revoked.ok).toBe(true);
    await settle(10);

    expect(app.subscriptions.listForDevice(goneDevice.value.device.id)).toEqual([]);
    expect(
      app.subscriptions.listForDevice(keptDevice.value.device.id).map((item) => item.endpoint),
    ).toEqual([stays.endpoint]);
    const file = path.join(config.options.stateDir, "remote", "push-subscriptions.json");
    expect(existsSync(file)).toBe(true);
    const onDisk = readFileSync(file, "utf8");
    expect(onDisk).not.toContain(removed.endpoint);
    expect(onDisk).toContain(stays.endpoint);
  });

  test("a TLS listener with the self-signed certificate reports its port and a SHA-256 fingerprint", async () => {
    const { config } = await fixture({
      tls: { host: "127.0.0.1", port: 0, hosts: ["127.0.0.1"], certPath: null, keyPath: null },
    });
    const app = await startApp(config);
    expect(app.info.tlsPort).toBeGreaterThan(0);
    expect(app.info.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    const first = app.info.fingerprint;
    await app.stop();
    apps.splice(apps.indexOf(app), 1);
    // 같은 상태 폴더로 다시 시작하면 같은 인증서(같은 지문)를 쓴다
    const again = await startApp({
      ...config,
      options: { ...config.options, loopbackPort: 0 },
    });
    expect(again.info.fingerprint).toBe(first);
  });

  test("a user certificate path that does not exist is an environment failure (exit 2)", async () => {
    const { config } = await fixture({
      tls: {
        host: "127.0.0.1",
        port: 0,
        hosts: ["fresnel.lan"],
        certPath: path.join(tempDir(), "missing-cert.pem"),
        keyPath: path.join(tempDir(), "missing-key.pem"),
      },
    });
    const started = await createWebApp(config);
    expect(started.ok).toBe(false);
    if (started.ok) throw new Error("unexpected start");
    expect(started.error.kind).toBe("tls");
    expect(describeError(started.error).exitCode).toBe(2);
    expect(describeError(started.error).message).toContain("TLS file not found");
  });

  test("a missing service socket is an environment failure (exit 2) and nothing is opened", async () => {
    const { config } = await fixture({ socketPath: path.join(tempDir(), "absent.sock") });
    const started = await createWebApp(config);
    expect(started.ok).toBe(false);
    if (started.ok) throw new Error("unexpected start");
    expect(started.error).toEqual({
      kind: "preflight",
      error: { kind: "socket_missing", path: config.options.socketPath },
    });
    expect(describeError(started.error).exitCode).toBe(2);
  });

  test("a UI folder without index.html is an environment failure (exit 2)", async () => {
    const { config } = await fixture();
    const empty = path.join(tempDir(), "empty-ui");
    mkdirSync(empty, { recursive: true });
    const started = await createWebApp({ ...config, options: { ...config.options, uiDir: empty } });
    expect(started.ok).toBe(false);
    if (started.ok) throw new Error("unexpected start");
    expect(started.error.kind).toBe("preflight");
    expect(describeError(started.error)).toEqual({
      exitCode: 2,
      message: `UI bundle not found (index.html is missing): ${path.join(empty, "index.html")}`,
    });
  });

  test("a state folder that is a file is an environment failure (exit 2)", async () => {
    const { config, root } = await fixture();
    const stateFile = path.join(root, "not-a-folder");
    writeFileSync(stateFile, "x");
    const started = await createWebApp({
      ...config,
      options: { ...config.options, stateDir: stateFile },
    });
    expect(started.ok).toBe(false);
    if (started.ok) throw new Error("unexpected start");
    expect(started.error.kind).toBe("preflight");
    expect(describeError(started.error).exitCode).toBe(2);
  });
});
