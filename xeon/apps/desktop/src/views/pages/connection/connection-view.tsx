import { t, type Locale } from "@fresnel/client/i18n";
import {
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  ListDescription,
  ListDescriptionRow,
} from "@caustic/react";
import { useId, type ReactNode } from "react";
import type { RemoteScreen } from "../../../app/remote/use-remote-controller.ts";
import type { EngineState } from "../../../state/engine/index.ts";
import type { TargetNotice } from "../../../state/ui/index.ts";
import type { ConnectionState, ReconnectLine } from "./connection-model.ts";
import type { RowProbe } from "./connection-probe-model.ts";
import type { ConnectionScreenHandlers } from "./connection-handlers.ts";
import type { SectionContext } from "./connection-sections.ts";
import { ConnectionHero } from "./connection-hero.tsx";
import { KeepOnSection } from "./keep-on-section.tsx";
import { ComputersSection } from "./computers-section.tsx";
import { ReachSection } from "./reach-section.tsx";
import { DevicesSection } from "./devices-section.tsx";
import { ScreenHeader } from "../../shell/screen-header.tsx";
export type { ConnectionScreenHandlers } from "./connection-handlers.ts";

// 설정 "원격" 화면(P-08, DP-112~116)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 한 열 720px(표 구역 폭). 위에서부터 요약 카드(지금 쓰는 컴퓨터), 하려는 일 셋(계속 켜 두기, 다른 컴퓨터에 연결, 휴대폰·브라우저에서
// 쓰기), 등록된 기기, 맨 아래 진단 복사 한 줄이다. 구역 사이 40px은 `SettingSection`이 준다. 시안: `_notes/design/dz/dzRW-design.md`.

const ROWS_CLASS =
  "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

export interface ConnectionScreenViewProps {
  readonly state: ConnectionState;
  readonly engine: EngineState | null;
  readonly locale: Locale;
  readonly handlers: ConnectionScreenHandlers;
  /** 이 컴퓨터의 원격 접속 컨트롤러. 엔진이 다른 컴퓨터에 붙어 있으면 null이다 */
  readonly remote?: RemoteScreen | null;
  /** 브라우저로 들어온 화면이다 */
  readonly web?: boolean;
  /** 1초 시계(연결 코드 남은 시간) */
  readonly nowMs?: number;
  /** 글 복사 */
  readonly copy?: (text: string) => void;
  /** 설정 구역 안에 실을 때 참이다. 머리와 자기 스크롤 칸 없이 본문 열만 그린다(설정 열이 폭과 스크롤을 맡는다) */
  readonly embedded?: boolean;
  /** 앱을 켤 때 마지막 대상으로 붙지 못해 이 컴퓨터로 돌아온 알림 */
  readonly targetNotice?: TargetNotice | null;
  /** 요약 카드의 다시 붙기 줄 */
  readonly reconnect?: readonly ReconnectLine[];
  /** 저장된 컴퓨터 카드의 연결 시험 상태 */
  readonly rowProbe?: RowProbe | null;
  /** 확인 대화 상자를 포털 없이 제자리에 그린다(서버 렌더 시험용) */
  readonly inline?: boolean;
}

export function ConnectionScreenView(props: ConnectionScreenViewProps): ReactNode {
  const { state, handlers } = props;
  const headingId = useId();
  const inline = props.inline ?? false;
  const context: SectionContext = {
    state,
    engine: props.engine,
    locale: props.locale,
    handlers,
    remote: props.remote ?? null,
    web: props.web ?? false,
    nowMs: props.nowMs ?? 0,
    copy: props.copy ?? handlers.copyCommand,
  };
  const body = (
    <div data-slot="remote-page" className="mx-auto grid w-full max-w-180">
      <ConnectionHero
        {...context}
        reconnect={props.reconnect ?? []}
        targetNotice={props.targetNotice ?? null}
      />
      <KeepOnSection {...context} />
      <ComputersSection {...context} rowProbe={props.rowProbe ?? null} />
      <ReachSection {...context} />
      <DevicesSection {...context} />
      <div className="flex items-center pt-10">
        <Button size="sm" variant="ghost" className="-ms-2" onClick={handlers.copyDiagnostics}>
          {t("desktop.connection.status.copyDiagnostics")}
        </Button>
      </div>
    </div>
  );
  if (props.embedded === true) {
    return (
      <div data-slot="connection-embedded">
        {body}
        <StopDialog state={state} handlers={handlers} inline={inline} />
        <SwitchDialog state={state} handlers={handlers} inline={inline} />
      </div>
    );
  }
  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title={t("desktop.connection.title")} titleId={headingId} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">{body}</div>
      <StopDialog state={state} handlers={handlers} inline={inline} />
      <SwitchDialog state={state} handlers={handlers} inline={inline} />
    </section>
  );
}

/**
 * 대상 바꾸기 확인. 도는 턴이나 승인 대기가 있을 때만 열린다(`switchNeedsConfirm`). 이 기기의 서비스가 계속 도는 경우에는
 * 그 말을 한 줄 더한다.
 */
function SwitchDialog(props: {
  readonly state: ConnectionState;
  readonly handlers: ConnectionScreenHandlers;
  readonly inline: boolean;
}): ReactNode {
  const { state, handlers, inline } = props;
  const ask = state.switchAsk;
  return (
    <Dialog
      kind="alert"
      size="sm"
      inline={inline}
      open={ask !== null}
      onOpenChange={(open) => {
        if (!open) handlers.switchCancel();
      }}
      title={t("desktop.connection.switch.title")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.connection.switch.cancel")}
            </Button>
          </DialogClose>
          <DialogAction onClick={handlers.switchConfirm}>
            {t("desktop.connection.switch.confirm")}
          </DialogAction>
        </>
      }
    >
      {ask === null ? null : (
        <div className="grid gap-2 text-ui text-text-secondary">
          {ask.impact.liveTurns > 0 ? (
            <p className="m-0">
              {t("desktop.connection.switch.body.turns", { count: ask.impact.liveTurns })}
            </p>
          ) : null}
          {ask.impact.waitingApprovals > 0 ? (
            <p className="m-0">
              {t("desktop.connection.switch.body.approvals", {
                count: ask.impact.waitingApprovals,
              })}
            </p>
          ) : null}
          {ask.impact.keepsRunning ? (
            <p className="m-0">{t("desktop.connection.switch.body.keepsRunning")}</p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function StopDialog(props: {
  readonly state: ConnectionState;
  readonly handlers: ConnectionScreenHandlers;
  readonly inline: boolean;
}): ReactNode {
  const { state, handlers, inline } = props;
  const host = state.status.kind === "ready" ? state.status.snapshot.host : null;
  const connections = host === null ? 0 : host.connections;
  const liveTurns = host === null ? 0 : host.liveTurns;
  return (
    <Dialog
      kind="alert"
      size="sm"
      inline={inline}
      tone="danger"
      open={state.stopConfirm}
      onOpenChange={(open) => {
        if (!open) handlers.setStopConfirm(false);
      }}
      title={t("desktop.connection.stopDialog.title")}
      description={t("desktop.connection.stopDialog.body", { count: connections })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.connection.stopDialog.keep")}
            </Button>
          </DialogClose>
          <DialogAction onClick={handlers.confirmStop}>
            {t("desktop.connection.stopDialog.confirm")}
          </DialogAction>
        </>
      }
    >
      <ListDescription variant="ghost" size="sm" className={ROWS_CLASS}>
        <ListDescriptionRow term={t("desktop.connection.status.liveTurns")}>
          {liveTurns}
        </ListDescriptionRow>
      </ListDescription>
    </Dialog>
  );
}
