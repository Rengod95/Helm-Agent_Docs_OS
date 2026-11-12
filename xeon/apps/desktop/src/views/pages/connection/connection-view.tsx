import { t, type Locale } from "@fresnel/client/i18n";
import {
  Alert,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  ListDescription,
  ListDescriptionRow,
} from "@caustic/react";
import { useId, type ReactNode } from "react";
import type { EngineState } from "../../../state/engine/index.ts";
import type { TargetNotice } from "../../../state/ui/index.ts";
import type { ConnectionState, ReconnectLine } from "./connection-model.ts";
import type { RowProbe } from "./connection-probe-model.ts";
import { ConnectionSection } from "./connection-status.tsx";
import type { ConnectionScreenHandlers } from "./connection-handlers.ts";

import { HostSection } from "./connection-host-section.tsx";
import { ScreenHeader } from "../../shell/screen-header.tsx";
import { UpdateCheckNote } from "../../update-parts.tsx";
export type { ConnectionScreenHandlers } from "./connection-handlers.ts";

// 연결 화면(P-08)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 예외는 진단 구역의 업데이트 한 줄이다. 그 줄만 `UpdateContext`를 읽어 상태 칸과 같은 정본을 본다(`UpdateCheckNote`).
// 한 열이고 내용은 720px 폭에 가운데 맞춘다. 맨 위는 "호스트" 섹션이고, 이 기기에 연결했을 때만 그 아래에 "실행 방식"과
// "다른 기기 접속"(`serviceSections`, 외부 접근이 켜졌을 때 두 번째가 보인다)이 이어지고, 맨 아래에 "진단"이 온다. 섹션 사이는 `gap-10`이다.

const ROWS_CLASS =
  "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

export interface ConnectionScreenViewProps {
  readonly state: ConnectionState;
  readonly engine: EngineState | null;
  readonly locale: Locale;
  readonly handlers: ConnectionScreenHandlers;
  /** "실행 방식"과 "다른 기기 접속" 섹션. 이 기기 대상일 때만 그린다(원격 대상에서는 그리지 않는다). 상태를 읽는 동안에도 그리지 않는다 */
  readonly serviceSections?: ReactNode;
  /** 설정 구역 안에 실을 때 참이다. 머리와 자기 스크롤 칸 없이 본문 열만 그린다(설정 열이 폭과 스크롤을 맡는다) */
  readonly embedded?: boolean;
  /** 앱을 켤 때 마지막 대상으로 붙지 못해 이 컴퓨터로 돌아온 알림. 맨 위에 닫을 수 있는 줄로 보인다 */
  readonly targetNotice?: TargetNotice | null;
  /** 현재 호스트 카드의 다시 붙기 줄 */
  readonly reconnect?: readonly ReconnectLine[];
  /** 저장된 호스트 줄의 연결 시험 상태 */
  readonly rowProbe?: RowProbe | null;
}

export function ConnectionScreenView(props: ConnectionScreenViewProps): ReactNode {
  const { state, engine, locale, handlers, serviceSections } = props;
  const headingId = useId();
  // 이 기기의 서비스 쪽 덩어리(실행 방식, 다른 기기 접속, 진단)는 이 기기 대상이고 상태를 읽은 뒤에만 보인다
  const serviceShown = state.engineTarget.kind === "local" && state.status.kind !== "loading";
  const notice = props.targetNotice ?? null;
  const body = (
    <div className="mx-auto grid w-full max-w-180 gap-10">
      {notice === null ? null : (
        <TargetNoticeLine notice={notice} onDismiss={handlers.dismissTargetNotice} />
      )}
      <HostSection
        state={state}
        engine={engine}
        locale={locale}
        handlers={handlers}
        reconnect={props.reconnect ?? []}
        rowProbe={props.rowProbe ?? null}
      />
      {serviceShown ? serviceSections : null}
      {serviceShown ? (
        <DiagnosticsSection
          handlers={handlers}
          busy={state.busy}
          restarting={engine?.kind === "restarting"}
        />
      ) : (
        <UpdateCheckNote />
      )}
    </div>
  );
  if (props.embedded === true) {
    return (
      <div data-slot="connection-embedded">
        {body}
        <StopDialog state={state} handlers={handlers} />
        <SwitchDialog state={state} handlers={handlers} />
      </div>
    );
  }
  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title={t("desktop.connection.title")} titleId={headingId} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">{body}</div>
      <StopDialog state={state} handlers={handlers} />
      <SwitchDialog state={state} handlers={handlers} />
    </section>
  );
}

/** 앱을 켤 때 마지막 대상으로 붙지 못해 이 컴퓨터로 돌아왔다는 알림. 닫을 수 있다 */
function TargetNoticeLine(props: {
  readonly notice: TargetNotice;
  readonly onDismiss: () => void;
}): ReactNode {
  const { notice, onDismiss } = props;
  return (
    <Alert
      tone="warning"
      size="sm"
      variant="outline"
      className="text-ui"
      dismissible
      dismissLabel={t("desktop.connection.dismiss")}
      onDismiss={onDismiss}
    >
      {t("desktop.connection.lastTarget.fellBack", { name: notice.name })}
    </Alert>
  );
}

/**
 * 대상 바꾸기 확인. 도는 턴이나 승인 대기가 있을 때만 열린다(`switchNeedsConfirm`). 이 기기의 서비스가 계속 도는 경우에는
 * 그 말을 한 줄 더한다.
 */
function SwitchDialog(props: {
  readonly state: ConnectionState;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const ask = state.switchAsk;
  return (
    <Dialog
      kind="alert"
      size="sm"
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

/**
 * 진단: 엔진 다시 시작과 진단 복사, 그 아래 업데이트 상태 한 줄. 맨 아래에 작게 둔다. 엔진 다시 시작은 쓰기가 가는 동안 잠그고,
 * 다시 뜨는 동안 단추에 진행을 보인다.
 */
function DiagnosticsSection(props: {
  readonly handlers: Pick<ConnectionScreenHandlers, "restart" | "copyDiagnostics">;
  readonly busy: boolean;
  readonly restarting: boolean;
}): ReactNode {
  const { handlers, busy, restarting } = props;
  return (
    <ConnectionSection title={t("desktop.connection.diagnostics.heading")}>
      <div className="grid content-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            loading={restarting}
            disabled={busy}
            onClick={handlers.restart}
          >
            {t("desktop.connection.status.restart")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handlers.copyDiagnostics}>
            {t("desktop.connection.status.copyDiagnostics")}
          </Button>
        </div>
        <UpdateCheckNote />
      </div>
    </ConnectionSection>
  );
}

function StopDialog(props: {
  readonly state: ConnectionState;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const host = state.status.kind === "ready" ? state.status.snapshot.host : null;
  const connections = host === null ? 0 : host.connections;
  const liveTurns = host === null ? 0 : host.liveTurns;
  return (
    <Dialog
      kind="alert"
      size="sm"
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
