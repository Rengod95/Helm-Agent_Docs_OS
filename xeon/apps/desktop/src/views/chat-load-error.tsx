import { Button } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, type ReactNode } from "react";
import { useTranscriptFailure } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { ProblemState } from "./pages/shared/problem-state.tsx";

// 대화를 읽지 못했을 때 대화 기록 자리를 차지하는 오류 상태(L4.desktop-ux DP-102 [결정: 2026-11-11 사용자]).
// 예전에는 "대화를 읽지 못했어요. 엔진이 … [다시 읽기]"가 한 줄에 붙어 있었다. 이제 제목, 원인 한 문장, 단추 줄(다시 읽기, 진단 복사)이다.
// 대화 화면(desktop-registry.tsx)이 기록 상태가 `error`일 때 대화 기록 대신 이 부품을 그린다.

const CAUSE_ID: Readonly<Record<"unavailable" | "failed" | "timeout" | "stale", MessageId>> = {
  unavailable: "desktop.transcript.loadFailed.unavailable",
  failed: "desktop.transcript.loadFailed.failed",
  timeout: "desktop.transcript.loadFailed.timeout",
  stale: "desktop.transcript.loadFailed.stale",
};

export function ChatLoadError(): ReactNode {
  const commands = useCommands();
  const failure = useTranscriptFailure();
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async (): Promise<void> => {
    setCopied(await commands.copyDiagnostics());
  };
  return (
    <ProblemState
      title={t("desktop.transcript.loadFailed.title")}
      cause={failure === null ? null : t(CAUSE_ID[failure])}
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              commands.retryTranscript();
            }}
          >
            {t("desktop.transcript.reloadButton")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              detach(copy(), rethrow);
            }}
          >
            {copied === null
              ? t("desktop.status.copyDiagnosticsButton")
              : copied
                ? t("desktop.status.diagnosticsCopied")
                : t("desktop.status.diagnosticsCopyFailed")}
          </Button>
        </>
      }
    />
  );
}
