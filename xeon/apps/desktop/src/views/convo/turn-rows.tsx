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
import { useModelNameOf } from "../model-usage.ts";
import { ReplyActions } from "./message-actions.tsx";
import { DriveWord } from "./drive-stack.tsx";
import { InvokedMark } from "./one-shot.tsx";
import { profileTitleOf, useProfiles } from "./profile-listing.ts";
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

/**
 * 턴 발 줄: 왼쪽 답 동작, 오른쪽 메타(올리면 상세). 멈춘 사유가 있으면 그 위에 안내 줄.
 * 메타는 이번 턴이 새로 쓴 토큰(출력 + 캐시 안 된 입력)을 앞세우고, 전체(캐시 포함)·비용·모델 참조는 상세에 둔다(DP-145)
 */
export function TurnFoot(props: {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly replyId: ItemId | null;
}): ReactNode {
  const turns = useTurnSummaries(props.threadId);
  const nameOf = useModelNameOf();
  const summary =
    props.turnId === null ? undefined : turns.find((turn) => turn.turnId === props.turnId);
  const stop = summary === undefined ? null : stopNoticeOf(summary);
  const meta = summary === undefined ? "" : turnMetaOf(summary, nameOf);
  const lines = summary === undefined ? [] : turnDetailLinesOf(summary);
  const invoked = summary?.invoked.length ?? 0;
  if (stop === null && meta === "" && props.replyId === null && invoked === 0) return null;
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
        {/* 원샷 표지는 턴 값(단계·시간)과 같은 오른쪽 묶음에 선다. 왼쪽 답 동작은 hover 전에도 자리를 차지한다 */}
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {summary === undefined ? null : <InvokedMark invoked={summary.invoked} />}
          {meta === "" ? null : lines.length === 0 ? (
            <span className="convo-line-meta px-1.5">{meta}</span>
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
              <span className="convo-line-meta rounded-xs px-1.5" tabIndex={0}>
                {meta}
              </span>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

/** 변화 표지 한 줄(압축 구분선과 한 벌) */
export function MarkerRow(props: { readonly marker: ConvoMarker }): ReactNode {
  const nameOf = useModelNameOf();
  const profiles = useProfiles();
  const clock = clockOf(props.marker.at);
  const text = markerTextOf(props.marker, nameOf, (id) => profileTitleOf(profiles, id));
  const { change } = props.marker;
  // 모델 바꿈은 화면 이름으로 적고 참조(`provider/model`)는 hover에 둔다
  const title = change.kind === "model" ? change.model : undefined;
  // 프로필 전환으로 권한이 바뀌었으면 그 줄은 경고색이다(숨기지 않는다)
  const warn = change.kind === "profile" && change.permission !== null;
  return (
    <div className="convo-divider" role="separator" aria-label={text}>
      <span className="flex items-baseline gap-2">
        <span title={title} className={warn ? "text-warning-text" : undefined}>
          {text}
        </span>
        {clock === "" ? null : <span className="text-footnote">{clock}</span>}
      </span>
    </div>
  );
}

/** Drive 구간 머리: 표지 + "helm" + "Driving" 글 + 한도 칸 */
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
      {/* 지금 Drive 중이면 이름 + "Driving" 글(lcM6f: 칩을 없앴다. 띠·카드와 같은 그라데이션 글이고, 물결은 입력창 위 띠만 흐르므로 여기는 멈춰 있다),
          끝났으면 "helm의 Drive" */}
      {lead.active ? (
        <>
          <span className="text-ui-strong text-text-primary">{name}</span>
          <DriveWord
            look="driving"
            text={t("desktop.drive.driving")}
            slot="convo-lead-driving"
            wave={false}
            className="text-ui-sm font-semibold"
          />
        </>
      ) : (
        <span className="text-ui-strong text-text-primary">
          {t("desktop.convo.lead.past", { name })}
        </span>
      )}
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
