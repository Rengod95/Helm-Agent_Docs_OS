import { activeLocale, t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { toast } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useRemoteController } from "../../../app/remote/use-remote-controller.ts";
import { serverModeOf, type ServerMode } from "../../../app/remote/remote-model.ts";
import { useCommands } from "../../commands.ts";
import type { ConnectionState } from "./connection-model.ts";
import { RemoteAccessSection } from "./connection-server.tsx";
import { RunModeSection } from "./connection-run-mode.tsx";
import type { ConnectionScreenHandlers } from "./connection-view.tsx";

// "실행 방식"과 "다른 기기 접속" 두 섹션의 연결 부분. 외부 접근 컨트롤러와 연결 명령을 부르는 훅, 연결 코드가 떠 있는 동안의 1초 시계,
// 클립보드 복사, 실행 방식 고르기(컨트롤러의 `selectMode`)를 맡는다. 그림은 두 섹션 파일이 그린다.
// 이 기기 대상일 때만 연결 화면이 이 부분을 붙인다. 고르기가 끝나면 화면 상태를 다시 읽어 서비스 상태 줄을 맞춘다.

/** 두 섹션이 화면에서 받는 동작. 화면 핸들러의 일부다 */
type ServiceSectionsHandlers = Pick<
  ConnectionScreenHandlers,
  "restart" | "setStopConfirm" | "setRemoteRespond" | "refresh"
>;

interface ServiceSectionsContainerProps {
  /** 화면 상태. 이 기기 서비스 상태와 다시 시작 대기를 읽는다 */
  readonly state: ConnectionState;
  readonly handlers: ServiceSectionsHandlers;
}

export function ServiceSectionsContainer(props: ServiceSectionsContainerProps): ReactNode {
  const { state, handlers } = props;
  const commands = useCommands();
  const remote = useRemoteController(commands.remote, commands.connection);
  const serviceRunning = state.service.kind === "running";
  const status = remote.state.status.kind === "ready" ? remote.state.status.value : null;
  const mode = serverModeOf(status, serviceRunning);
  // 마지막으로 고른 실행 방식. 서비스 실패 문장을 고르고, 다시 시도가 같은 방식으로 다시 보낸다
  const [lastChoice, setLastChoice] = useState<ServerMode | null>(null);

  /** 고르기는 컨트롤러의 `selectMode`다. 끝나면 화면 상태를 다시 읽는다(서비스 상태 줄과 멈추기 잠금이 따라간다) */
  const chooseAndRefresh = async (next: ServerMode): Promise<void> => {
    await remote.actions.selectMode(next, serviceRunning);
    handlers.refresh();
  };
  const choose = (next: ServerMode): void => {
    setLastChoice(next);
    detach(chooseAndRefresh(next), rethrow);
  };

  // 시계는 연결 코드가 떠 있는 동안만 1초마다 넘긴다. 발급을 부르는 순간에도 맞춰, 새 코드의 남은 시간이 처음부터 맞게 한다
  const issued = remote.state.pairing.kind === "issued";
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!issued) return undefined;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [issued]);
  const actions = {
    ...remote.actions,
    issuePairing: () => {
      setNowMs(Date.now());
      return remote.actions.issuePairing();
    },
  };

  // 클립보드는 진단 복사와 같은 자리(셸이 넘긴 클립보드)를 쓴다. 성공하면 짧게 알린다
  const copyText = async (text: string): Promise<void> => {
    await commands.secrets.writeClipboard(text);
    toast({ tone: "success", title: t("desktop.connection.status.copied") });
  };
  const copy = (text: string): void => {
    detach(copyText(text), rethrow);
  };

  return (
    <>
      <RunModeSection
        mode={mode}
        state={state}
        remote={remote.state}
        actions={actions}
        lastChoice={lastChoice}
        choose={choose}
        handlers={handlers}
      />
      {status !== null && mode === "service+remote" ? (
        <RemoteAccessSection
          status={status}
          state={state}
          remote={remote.state}
          actions={actions}
          nowMs={nowMs}
          locale={activeLocale()}
          copy={copy}
          setRemoteRespond={handlers.setRemoteRespond}
        />
      ) : null}
    </>
  );
}
