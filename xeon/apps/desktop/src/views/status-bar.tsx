import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { storeFailureOfExitCode } from "@fresnel/contracts/records";
import { useState, type ReactNode } from "react";
import {
  useApprovalCount,
  useEngineState,
  useLinkBanner,
  useRunningCount,
  type EngineState,
  type Link,
} from "../state/engine/index.ts";
import { useConnectError } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";

const LINK_TEXT: Readonly<Record<Link["phase"], MessageId>> = {
  offline: "desktop.status.link.offline",
  connecting: "desktop.status.link.connecting",
  syncing: "desktop.status.link.syncing",
  live: "desktop.status.link.live",
  resync: "desktop.status.link.resync",
  reset: "desktop.status.link.reset",
  failed: "desktop.status.link.failed",
};

const ENGINE_TEXT: Readonly<Record<EngineState["kind"], MessageId>> = {
  starting: "desktop.status.engine.starting",
  running: "desktop.status.engine.running",
  restarting: "desktop.status.engine.restarting",
  stopping: "desktop.status.engine.stopping",
  failed: "desktop.status.engine.failed",
  stopped: "desktop.status.engine.stopped",
};

/** 실행 중인 엔진이 어디서 도는지. sidecar는 앱이 띄운 자식이고 service는 `fresnel service`다 */
const SOURCE_TEXT: Readonly<Record<"sidecar" | "service", MessageId>> = {
  sidecar: "desktop.status.engine.sourceEmbedded",
  service: "desktop.status.engine.sourceService",
};

const STORE_FAILURE_TEXT: Readonly<
  Record<NonNullable<ReturnType<typeof storeFailureOfExitCode>>, MessageId>
> = {
  future_version: "desktop.status.engine.storeFutureVersion",
  corrupt: "desktop.status.engine.storeCorrupt",
  migration_failed: "desktop.status.engine.storeMigrationFailed",
};

/** 저장소를 열지 못해 끝난 엔진은 분류별 안내를 보인다(종료 코드 70~72). 그 밖의 종료는 일반 문구다 */
export function engineTextOf(state: EngineState | undefined): MessageId {
  if (state === undefined) return "desktop.status.engine.checking";
  if (state.kind === "failed" || state.kind === "restarting") {
    const failure = storeFailureOfExitCode(state.lastExit.code);
    if (failure !== undefined) return STORE_FAILURE_TEXT[failure];
  }
  return ENGINE_TEXT[state.kind];
}

export function StatusBar(): ReactNode {
  const commands = useCommands();
  const engine = useEngineState();
  const banner = useLinkBanner();
  const running = useRunningCount();
  const approvals = useApprovalCount();
  const connectError = useConnectError();
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async (): Promise<void> => {
    setCopied(await commands.copyDiagnostics());
  };
  return (
    <footer className="statusbar" role="status">
      <span>
        {t(engineTextOf(engine))}
        {engine?.kind === "running" ? ` (${t(SOURCE_TEXT[engine.source])})` : ""}
      </span>
      <span>
        {t(LINK_TEXT[banner.phase])}
        {banner.attempt > 0
          ? ` ${t("desktop.status.link.attempt", { attempt: banner.attempt })}`
          : ""}
      </span>
      <span>{t("desktop.status.running", { count: running })}</span>
      {approvals > 0 ? (
        <span className="warn">{t("desktop.status.approvals", { count: approvals })}</span>
      ) : null}
      {connectError === null ? null : (
        <span className="error">{t("desktop.status.connectFailed", { error: connectError })}</span>
      )}
      <span className="grow" />
      <button
        type="button"
        onClick={() => {
          commands.showScreen("settings");
        }}
      >
        {t("desktop.status.settingsButton")}
      </button>
      {engine?.kind === "failed" ? (
        <button
          type="button"
          onClick={() => {
            detach(commands.restartEngine(), rethrow);
          }}
        >
          {t("desktop.status.restartEngineButton")}
        </button>
      ) : null}
      {banner.phase === "failed" || connectError !== null ? (
        <>
          <button
            type="button"
            onClick={() => {
              commands.reconnect();
            }}
          >
            {t("desktop.status.reconnectButton")}
          </button>
          <button
            type="button"
            onClick={() => {
              detach(copy(), rethrow);
            }}
          >
            {t("desktop.status.copyDiagnosticsButton")}
          </button>
          {copied === null ? null : (
            <span className="dim">
              {copied
                ? t("desktop.status.diagnosticsCopied")
                : t("desktop.status.diagnosticsCopyFailed")}
            </span>
          )}
        </>
      ) : null}
    </footer>
  );
}
