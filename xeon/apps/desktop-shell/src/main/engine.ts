// 엔진 모듈(relay.rs의 명령과 engine.rs 감독자를 붙인다, L4.desktop.spec 3.3, 4.1~4.5, 11.5).
// 명령 일곱 개를 등록하고, 감독자를 띄우고, 창이 사라지면 현재 연결을 끊고, 앱이 끝날 때 정상 종료 순서를 돈다.
import { assertNever } from "@fresnel/contracts";
import os from "node:os";
import type { ShellContext, ShellModule } from "./context.ts";
import { desktopSettingsStore } from "./desktop-settings.ts";
import { appLogOf, type AppLog } from "./lib/applog.ts";
import { ownField } from "./lib/narrow.ts";
import { nodeScheduler } from "./lib/scheduler.ts";
import { remoteTokenSource } from "./engine/remote-token.ts";
import { pipedLauncher, type Launcher } from "./engine/launcher.ts";
import { engineConfigFrom, parseTarget, type EngineConfig } from "./engine/policy.ts";
import {
  createChannelSink,
  createRelay,
  MAX_WRITE_BYTES,
  validateBackupDir,
  type Relay,
} from "./engine/relay.ts";
import { fail } from "./engine/state.ts";
import { Supervisor, type ExitAction } from "./engine/supervisor.ts";
import type { EngineClock } from "./engine/wait.ts";
import { serviceAwareLauncher } from "./service-mode.ts";

const relays = new WeakMap<ShellContext, Relay>();

/** 이 ctx의 릴레이. inspect 모듈이 상태를 읽는 데 쓴다 */
export function relayOf(ctx: ShellContext): Relay {
  const existing = relays.get(ctx);
  if (existing !== undefined) return existing;
  const created = createRelay({ kind: "stopped" });
  relays.set(ctx, created);
  return created;
}

export interface EngineDeps {
  readonly launcher: Launcher;
  readonly clock: EngineClock;
  readonly config: EngineConfig;
  readonly log: AppLog;
}

/**
 * 엔진 감독자를 만들고 명령, 창 연결 끊기, 종료 순서를 등록한 뒤 실행 루프를 띄운다.
 * 운영은 `engineModule`이 부르고, 시험은 가짜 launcher와 가짜 시계를 넘긴다.
 */
export function registerEngine(ctx: ShellContext, deps: EngineDeps): Supervisor {
  const relay = relayOf(ctx);
  const supervisor = new Supervisor({
    launcher: deps.launcher,
    relay,
    config: deps.config,
    log: deps.log,
    clock: deps.clock,
  });
  registerCommands(ctx, relay, supervisor);
  ctx.onWindow(onWindowClosed(relay));
  // 종료 순서는 한 번만 돈다. 같은 종료 요청이 다시 와도 진행 중인 순서를 기다린다
  let quitting: Promise<void> | null = null;
  ctx.onQuit(() => {
    if (quitting === null) quitting = quitEngine(supervisor);
    return quitting;
  });
  supervisor.start();
  return supervisor;
}

/** 창이 사라졌을 때 쓰는 최소 면. `BrowserWindow`가 이것을 만족한다(타입만 가져온다) */
export interface ClosableWindow {
  on(event: "closed", listener: () => void): unknown;
}

/** 창이 닫히면 현재 연결을 끊는다. 신용을 기다리는 송신이 남지 않게 한다(Rust의 Destroyed 처리와 같다) */
export function onWindowClosed(relay: Relay): (window: ClosableWindow) => void {
  return (window) => {
    window.on("closed", () => {
      relay.detachCurrent();
    });
  };
}

/** 앱이 끝날 때: 정상 종료 순서를 돌리고, 남은 그룹이 있으면 마지막으로 강제 종료한다 */
async function quitEngine(supervisor: Supervisor): Promise<void> {
  await exitSequence(supervisor);
  supervisor.killRemaining();
}

/** `ExitRequested`의 처리(engine.rs와 main.rs). 복원이 도는 동안은 끝나기를 기다린 뒤 다시 요청한다 */
async function exitSequence(supervisor: Supervisor): Promise<void> {
  const action: ExitAction = supervisor.onExitRequested();
  switch (action) {
    case "allow":
    case "prevent":
      return;
    case "preventUntilRestore":
      await supervisor.waitRestoreEnd();
      await exitSequence(supervisor);
      return;
    case "preventAndShutdown":
      await supervisor.shutdown();
      supervisor.allowExit();
      return;
    default:
      return assertNever(action, "exit action");
  }
}

function registerCommands(ctx: ShellContext, relay: Relay, supervisor: Supervisor): void {
  ctx.handle("engine_attach", (caller, args) => {
    const onBytes = ctx.channel(caller, ownField(args, "onBytes"));
    const onState = ctx.channel(caller, ownField(args, "onState"));
    if (onBytes === null || onState === null) fail("bad-request");
    const attached = relay.attach(createChannelSink(onBytes, onState));
    return { epoch: attached.epoch, state: attached.state };
  });

  // 검사 순서는 relay.rs와 같다: 헤더, 본문 모양, 크기, 세대, 쓰기
  ctx.handle("engine_write", async (_caller, args) => {
    const epoch = epochOf(ownField(args, "headers"));
    if (epoch === null) fail("bad-request");
    const body = ownField(args, "body");
    if (!(body instanceof Uint8Array)) fail("bad-request");
    if (body.length > MAX_WRITE_BYTES) fail("too-large");
    const stale = relay.checkEpoch(epoch);
    if (stale !== null) fail(stale);
    const written = await supervisor.write(body);
    if (!written.ok) fail(written.error);
    return null;
  });

  ctx.handle("engine_ack", (_caller, args) => {
    const epoch = countOf(ownField(args, "epoch"));
    const bytes = countOf(ownField(args, "bytes"));
    if (epoch === null || bytes === null) fail("bad-request");
    relay.ack(epoch, bytes);
    return null;
  });

  // 불리언이 아닌 값은 없는 것으로 본다. `confirmed`가 없으면 거짓이다
  ctx.handle("engine_restart", (_caller, args) => {
    const confirmed = flagOf(ownField(args, "confirmed")) === true;
    const result = supervisor.restartManually(flagOf(ownField(args, "safeMode")), confirmed);
    if (!result.ok) fail(result.error);
    return null;
  });

  ctx.handle("engine_retarget", (_caller, args) => {
    const target = parseTarget(ownField(args, "target"));
    if (target === null) fail("bad-request");
    const result = supervisor.retarget(target);
    if (!result.ok) fail(result.error);
    return null;
  });

  ctx.handle("db_restore", async (_caller, args) => {
    const backupDir = ownField(args, "backupDir");
    if (typeof backupDir !== "string") fail("bad-request");
    const invalid = validateBackupDir(backupDir);
    if (invalid !== null) fail(invalid);
    const result = await supervisor.restoreDatabase(backupDir);
    if (!result.ok) fail(result.error);
    return {
      exitCode: result.value.exitCode,
      stdout: result.value.stdout,
      stderr: result.value.stderr,
    };
  });

  // 현재 세대와 같을 때만 끊는다. 새로고침 뒤 늦게 온 이전 페이지의 호출이 새 연결을 끊지 못한다
  ctx.handle("engine_detach", (_caller, args) => {
    const epoch = countOf(ownField(args, "epoch"));
    if (epoch === null) fail("bad-request");
    relay.detach(epoch);
    return null;
  });
}

/** `x-fresnel-epoch` 헤더의 세대. 10진 정수 문자열이어야 한다. 아니면 null */
function epochOf(headers: unknown): number | null {
  const text = ownField(headers, "x-fresnel-epoch");
  if (typeof text !== "string" || !/^\+?\d+$/u.test(text)) return null;
  return countOf(Number(text));
}

/** 0 이상의 안전한 정수만 받는다 */
function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** 불리언만 받는다. 다른 값은 없는 것이다 */
function flagOf(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** 앱 모듈. 운영 launcher, 노드 시계, 설정 파일 값을 엮는다 */
export const engineModule: ShellModule = {
  name: "engine",
  register(ctx) {
    const log = appLogOf(ctx);
    const settings = desktopSettingsStore(ctx).current();
    const scheduler = nodeScheduler();
    registerEngine(ctx, {
      launcher: serviceAwareLauncher(
        pipedLauncher({
          env: ctx.env,
          platform: ctx.platform,
          arch: process.arch,
          resources: ctx.paths.resources,
          home: os.homedir(),
          log,
          scheduler,
          remoteToken: remoteTokenSource({ platform: ctx.platform, env: ctx.env }),
        }),
        log,
      ),
      clock: { now: () => Date.now(), scheduler },
      config: engineConfigFrom(settings.shutdownGraceMs, settings.restartLimit),
      log,
    });
  },
};
