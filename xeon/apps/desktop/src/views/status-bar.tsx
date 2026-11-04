import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { storeFailureOfExitCode } from "@fresnel/contracts/records";
import { useState, type ReactNode } from "react";
import { nativeEntriesOf, originTitleOf } from "../plugin-ui/placements.ts";
import {
  useApprovalCount,
  useEngineState,
  useLinkBanner,
  useRunningCount,
  type EngineState,
  type Link,
} from "../state/engine/index.ts";
import { useConnectError, useSelectedThreadId } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { EntrySurface, screenKeyOf } from "./plugin/plugin-view.tsx";
import { usePluginUiState } from "./plugin/plugin-context.tsx";

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
export function engineTextOf(state: EngineState | null | undefined): MessageId {
  if (state === undefined || state === null) return "desktop.status.engine.checking";
  if (state.kind === "failed" || state.kind === "restarting") {
    const failure = storeFailureOfExitCode(state.lastExit.code);
    if (failure !== undefined) return STORE_FAILURE_TEXT[failure];
  }
  return ENGINE_TEXT[state.kind];
}

/**
 * 확장의 상태 칸. 열린 대화가 있을 때만 그린다(ADR-0021 §3.2). 꺼졌거나 안전 모드인 확장의 칸은 그리지 않는다.
 * 칸 앞에 셸이 확장 이름을 그린다(보고 2). 칸 하나는 선언형 트리를 좁은 자리에 담고 글이 넘치면 줄인다.
 * `NativeTree`에는 읽기 전용 모드가 없어 트리의 버튼과 입력은 그대로 대화형이다. 같은 실행기와 확인 줄을 거친다
 */
function StatusCells(): ReactNode {
  const plugin = usePluginUiState();
  const threadId = useSelectedThreadId();
  if (threadId === null) return null;
  return nativeEntriesOf(plugin.groups.status, plugin.inactive).map((entry) => (
    <div
      key={screenKeyOf(entry)}
      className="flex min-w-0 max-w-[24ch] items-center gap-1 truncate"
      title={originTitleOf(entry)}
      data-status-cell={screenKeyOf(entry)}
    >
      <span className="shrink-0 text-xs text-muted-foreground" data-status-origin={entry.extension}>
        {entry.extension}
      </span>
      <EntrySurface entry={entry} dense />
    </div>
  ));
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
      <StatusCells />
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
