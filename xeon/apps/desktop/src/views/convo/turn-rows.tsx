import { Button, Tooltip } from "@caustic/react";
import { TriangleAlert } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ItemId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import { useState, type ReactNode } from "react";
import type { ConvoMarker } from "../../state/engine/convo.ts";
import {
  useLeadSegments,
  useOpenThreadRunning,
  useTurnSummaries,
} from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { ReplyActions } from "./message-actions.tsx";
import {
  clockOf,
  leaderNameOf,
  leadMetersOf,
  markerTextOf,
  releaseTextOf,
  stopNoticeOf,
  turnDetailLinesOf,
  turnMetaOf,
} from "./turn-model.ts";

// 턴 발 줄, 멈춘 사유, 변화 표지, 주도 구간 머리·끝(dzT2a 시안 7, 8, 10절).

function StopNoticeRow(props: {
  readonly threadId: ThreadId;
  readonly text: string;
  readonly canContinue: boolean;
  readonly tone: "warning" | "quiet";
}): ReactNode {
  const commands = useCommands();
  const running = useOpenThreadRunning();
  const [busy, setBusy] = useState(false);
  if (props.tone === "quiet") return <p className="convo-note">{props.text}</p>;
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1" role="status">
      <TriangleAlert aria-hidden className="convo-line-icon text-warning-text" />
      <span className="text-ui text-text-secondary">{props.text}</span>
      {props.canContinue ? (
        <Button
          size="xs"
          variant="outline"
          loading={busy}
          disabled={running}
          onClick={() => {
            setBusy(true);
            detach(
              commands
                .sendTurn(
                  props.threadId,
                  t("desktop.convo.stop.continuePrompt"),
                  crypto.randomUUID(),
                )
                .then(() => {
                  setBusy(false);
                  return undefined;
                }),
              rethrow,
            );
          }}
        >
          {t("desktop.convo.stop.continue")}
        </Button>
      ) : null}
    </div>
  );
}

/** 턴 발 줄: 왼쪽 답 동작, 오른쪽 메타(올리면 상세). 멈춘 사유가 있으면 그 위에 안내 줄 */
export function TurnFoot(props: {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly replyId: ItemId | null;
}): ReactNode {
  const turns = useTurnSummaries(props.threadId);
  const summary =
    props.turnId === null ? undefined : turns.find((turn) => turn.turnId === props.turnId);
  const stop = summary === undefined ? null : stopNoticeOf(summary);
  const meta = summary === undefined ? "" : turnMetaOf(summary);
  const lines = summary === undefined ? [] : turnDetailLinesOf(summary);
  if (stop === null && meta === "" && props.replyId === null) return null;
  return (
    <div className="grid gap-1" data-slot="convo-turn-foot">
      {stop === null ? null : (
        <StopNoticeRow
          threadId={props.threadId}
          text={stop.text}
          canContinue={stop.canContinue}
          tone={stop.tone}
        />
      )}
      <div className="-mx-1.5 flex min-h-6 items-center gap-2">
        {props.replyId === null ? null : (
          <ReplyActions threadId={props.threadId} itemId={props.replyId} />
        )}
        {meta === "" ? null : lines.length === 0 ? (
          <span className="convo-line-meta ml-auto px-1.5">{meta}</span>
        ) : (
          <Tooltip
            side="top"
            align="end"
            content={
              <span className="grid gap-0.5">
                {lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            }
          >
            <span className="convo-line-meta ml-auto rounded-xs px-1.5" tabIndex={0}>
              {meta}
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** 변화 표지 한 줄(압축 구분선과 한 벌) */
export function MarkerRow(props: { readonly marker: ConvoMarker }): ReactNode {
  const clock = clockOf(props.marker.at);
  return (
    <div className="convo-divider" role="separator" aria-label={markerTextOf(props.marker)}>
      <span className="flex items-baseline gap-2">
        <span>{markerTextOf(props.marker)}</span>
        {clock === "" ? null : <span className="text-footnote">{clock}</span>}
      </span>
    </div>
  );
}

/** 주도 구간 머리: 표지 + "helm이 이끄는 중" + 한도 칸 */
export function LeadHead(props: {
  readonly threadId: ThreadId;
  readonly leaseId: string;
}): ReactNode {
  const lead = useLeadSegments(props.threadId).find((l) => l.leaseId === props.leaseId);
  if (lead === undefined) return null;
  const name = leaderNameOf(lead.scopeId);
  const meters = leadMetersOf(lead);
  return (
    <div
      className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1"
      data-slot="convo-lead-head"
    >
      <span aria-hidden className="convo-lead-dot" />
      <span className="text-ui-strong text-text-primary">
        {lead.active
          ? t("desktop.convo.lead.active", { name })
          : t("desktop.convo.lead.past", { name })}
      </span>
      {meters.length === 0 ? null : (
        <span className="convo-line-meta flex items-center gap-1.5">
          {meters.map((meter, index) => (
            <span key={meter.text} className={meter.warn ? "convo-meter-warn" : undefined}>
              {index === 0 ? "" : "· "}
              {meter.text}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** 주도 구간 끝: 반납 사유 */
export function LeadEnd(props: {
  readonly threadId: ThreadId;
  readonly leaseId: string;
}): ReactNode {
  const lead = useLeadSegments(props.threadId).find((l) => l.leaseId === props.leaseId);
  if (lead === undefined || lead.active) return null;
  const clock = lead.releasedAt === null ? "" : clockOf(lead.releasedAt);
  return (
    <p
      className="m-0 flex min-h-7 items-center gap-2 text-ui text-text-tertiary"
      data-slot="convo-lead-end"
    >
      <span>{releaseTextOf(lead)}</span>
      {clock === "" ? null : <span className="text-footnote">{clock}</span>}
    </p>
  );
}
