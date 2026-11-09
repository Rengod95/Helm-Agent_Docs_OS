import { activeLocale, t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { toast } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useRemoteController } from "../../../app/remote/use-remote-controller.ts";
import { useCommands } from "../../commands.ts";
import { ServerModeSection } from "./connection-server.tsx";
import { ConnectionSection } from "./connection-status.tsx";

// 서버 모드 섹션의 연결 부분. 원격 명령과 연결 명령을 부르는 훅, 페어링 코드가 떠 있는 동안의 1초 시계, 클립보드 복사를 맡는다.
// 그림은 `ServerModeSection`이 그린다. 이 기기 대상일 때만 연결 화면이 이 섹션을 붙인다.

interface ServerModeSectionContainerProps {
  /** 이 기기 서비스가 도는가. 연결 화면이 서비스 카드와 같은 값을 넘긴다 */
  readonly serviceRunning: boolean;
}

export function ServerModeSectionContainer(props: ServerModeSectionContainerProps): ReactNode {
  const commands = useCommands();
  const remote = useRemoteController(commands.remote, commands.connection);
  const issued = remote.state.pairing.kind === "issued";
  // 시계는 페어링 코드가 떠 있는 동안만 1초마다 넘긴다. 발급을 부르는 순간에도 맞춰, 새 코드의 남은 시간이 처음부터 맞게 한다
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
    <ConnectionSection title={t("desktop.connection.server.heading")}>
      <ServerModeSection
        state={remote.state}
        serviceRunning={props.serviceRunning}
        nowMs={nowMs}
        locale={activeLocale()}
        actions={actions}
        copy={copy}
      />
    </ConnectionSection>
  );
}
