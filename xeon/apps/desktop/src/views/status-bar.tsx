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

const LINK_TEXT: Readonly<Record<Link["phase"], string>> = {
  offline: "연결 없음",
  connecting: "연결 중",
  syncing: "따라잡는 중",
  live: "연결됨",
  resync: "다시 맞추는 중",
  reset: "다시 읽는 중",
  failed: "연결 복구 실패",
};

const ENGINE_TEXT: Readonly<Record<EngineState["kind"], string>> = {
  starting: "엔진 시작 중",
  running: "엔진 실행 중",
  restarting: "엔진 다시 시작 중",
  stopping: "엔진 끄는 중",
  failed: "엔진 시작 실패",
  stopped: "엔진 꺼짐",
};

const engineText = (kind: EngineState["kind"] | undefined): string =>
  kind === undefined ? "엔진 상태 확인 중" : ENGINE_TEXT[kind];

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
        {engineText(engine?.kind)}
        {engine?.kind === "running"
          ? ` (${engine.source === "sidecar" ? "사이드카" : "서비스"})`
          : ""}
      </span>
      <span>
        {LINK_TEXT[banner.phase]}
        {banner.attempt > 0 ? ` (${banner.attempt}/3)` : ""}
      </span>
      <span>진행 중 {running}</span>
      {approvals > 0 ? <span className="warn">승인 {approvals}</span> : null}
      {connectError === null ? null : <span className="error">연결 실패: {connectError}</span>}
      <span className="grow" />
      {engine?.kind === "failed" ? (
        <button
          type="button"
          onClick={() => {
            void commands.restartEngine();
          }}
        >
          엔진 다시 시작
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
            다시 연결
          </button>
          <button
            type="button"
            onClick={() => {
              void copy();
            }}
          >
            진단 복사
          </button>
          {copied === null ? null : (
            <span className="dim">{copied ? "복사했습니다" : "복사하지 못했습니다"}</span>
          )}
        </>
      ) : null}
    </footer>
  );
}
