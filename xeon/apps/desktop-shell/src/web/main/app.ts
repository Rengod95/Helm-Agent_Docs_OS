// 게이트웨이 한 벌을 조립하고 시작한다. 순서: 환경 검사 → 상태 파일 열기(기기, 키, 구독) → 인증서 → 게이트웨이 시작 → 알림 원천과 푸시 연결.
// 실패는 `WebAppError` 값으로 돌려준다(던지지 않는다). 시작에 성공하면 `stop()`이 모든 것을 거꾸로 끈다.
import path from "node:path";
import { err, ok, type Clock, type Logger, type Result } from "@fresnel/contracts";
import type { AppLog } from "../../main/lib/applog.ts";
import { engineConfigFrom } from "../../main/engine/policy.ts";
import { nodeScheduler } from "../../main/lib/scheduler.ts";
import { createAuthPort, type AuthPort } from "../auth/auth-port.ts";
import { openPushSubscriptions, removePushOnRevoke, type PushSubscriptions } from "../auth/push.ts";
import { openVapid } from "../auth/vapid.ts";
import { startNoticePush } from "../push/notice-listener.ts";
import { createPushSender } from "../push/sender.ts";
import { createSocketNoticeSource } from "../push/socket-notice-source.ts";
import { createPushService } from "../push/service.ts";
import { createGateway, type GatewayInfo, type TlsListenerOptions } from "../server/gateway.ts";
import { connectServiceSocket } from "../server/service-connection.ts";
import { createTabSessionFactory } from "../session/tab-session.ts";
import { createViewTokens } from "../view/tokens.ts";
import { buildShimSource } from "../shim/build.ts";
import { buildServiceWorkerSource } from "../static/sw-build.ts";
import { prepareTls } from "../tls/store.ts";
import { checkUiDir, prepareStateDir, probeServiceSocket } from "./preflight.ts";
import type { WebAppError } from "./errors.ts";
import type { TlsArgs, WebOptions } from "./args.ts";

/** VAPID `sub`(연락처). 명세에 설정 키가 없어 자리표시자를 둔다. 실제 연락처는 정해지면 바꾼다 */
const PUSH_SUBJECT = "mailto:fresnel@localhost.invalid";

export interface WebAppConfig {
  readonly options: WebOptions;
  /** 로그인 화면 파일(`login.html`, `login.css`)이 있는 폴더 */
  readonly staticDir: string;
  /** 사이드카를 찾는 폴더(`ctx.paths.resources`와 같다) */
  readonly resources: string;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface WebApp {
  readonly info: GatewayInfo;
  readonly auth: AuthPort;
  readonly subscriptions: PushSubscriptions;
  /** 알림 연결, 폐기 연결을 떼고 게이트웨이를 멈춘다. 연결된 탭과 기기 소켓은 닫힌다 */
  stop(): Promise<void>;
}

/** 루프백과 외부 리스너의 TLS 설정. 인증서 파일이 있으면 그것을, 없으면 상태 폴더의 자체 서명을 쓴다 */
function tlsListenerOf(
  args: TlsArgs | null,
  remoteDir: string,
  clock: Clock,
): Result<TlsListenerOptions | null, WebAppError> {
  if (args === null) return ok(null);
  const material = prepareTls({
    dir: path.join(remoteDir, "tls"),
    hosts: args.hosts,
    clock,
    ...(args.certPath === null || args.keyPath === null
      ? {}
      : { userCertificate: { certPath: args.certPath, keyPath: args.keyPath } }),
  });
  if (!material.ok) return err({ kind: "tls", error: material.error });
  return ok({ host: args.host, port: args.port, hosts: args.hosts, material: material.value });
}

/** 게이트웨이를 만들고 시작한다. 성공하면 `WebApp`이다 */
export async function createWebApp(config: WebAppConfig): Promise<Result<WebApp, WebAppError>> {
  const { options, logger, clock } = config;

  const socket = await probeServiceSocket(options.socketPath);
  if (!socket.ok) return err({ kind: "preflight", error: socket.error });
  const ui = checkUiDir(options.uiDir);
  if (!ui.ok) return err({ kind: "preflight", error: ui.error });
  const remote = prepareStateDir(options.stateDir);
  if (!remote.ok) return err({ kind: "preflight", error: remote.error });
  const dir = remote.value;

  const auth = createAuthPort({ dir, clock, logger });
  if (!auth.ok) return err({ kind: "state", error: auth.error });
  const keyring = openVapid({ dir, clock });
  if (!keyring.ok) return err({ kind: "state", error: keyring.error });
  const subscriptions = openPushSubscriptions({ dir, clock });
  if (!subscriptions.ok) return err({ kind: "state", error: subscriptions.error });
  const tls = tlsListenerOf(options.tls, dir, clock);
  if (!tls.ok) return err(tls.error);

  const appLog: AppLog = {
    line: (message) => {
      logger.info("web.tab", { message });
    },
  };
  const views = createViewTokens({ clock });
  const sessions = createTabSessionFactory({
    views,
    env: config.env,
    platform: config.platform,
    arch: config.arch,
    stateDir: options.stateDir,
    resources: config.resources,
    home: config.home,
    socketPath: options.socketPath,
    clock: { now: () => clock.now(), scheduler: nodeScheduler() },
    config: engineConfigFrom(null, null),
    log: appLog,
  });
  const gateway = createGateway({
    auth: auth.value,
    sessions,
    push: createPushService({ keyring: keyring.value, subscriptions: subscriptions.value }),
    shim: buildShimSource,
    uiDir: options.uiDir,
    staticDir: config.staticDir,
    serviceWorkerSource: buildServiceWorkerSource,
    serviceSocketPath: options.socketPath,
    connectService: connectServiceSocket,
    loopback: { port: options.loopbackPort },
    tls: tls.value,
    views,
    clock,
    logger,
  });
  const started = await gateway.start();
  if (!started.ok) return err({ kind: "gateway", error: started.error });

  // 알림 원천은 게이트웨이가 뜬 뒤에 붙인다. 서비스가 없으면 원천이 재연결을 되풀이한다(기다림은 최대 30초)
  const notices = createSocketNoticeSource({ socketPath: options.socketPath, logger });
  const sender = createPushSender({
    keyring: keyring.value,
    subscriptions: subscriptions.value,
    fetch: (input, init) => fetch(input, init),
    subject: PUSH_SUBJECT,
    clock,
    logger,
  });
  const stopNotices = startNoticePush({ source: notices, sender, logger });
  const stopRevokeCleanup = removePushOnRevoke(auth.value, subscriptions.value, (error) => {
    logger.error("push.revoke_cleanup_failed", { reason: error.kind });
  });

  return ok({
    info: started.value,
    auth: auth.value,
    subscriptions: subscriptions.value,
    async stop() {
      stopRevokeCleanup();
      stopNotices();
      notices.close();
      await gateway.stop();
    },
  });
}
