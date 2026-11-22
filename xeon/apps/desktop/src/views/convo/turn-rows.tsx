import { Button, Tooltip } from "@caustic/react";
import { TriangleAlert } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ItemId, ThreadId, TurnId } from "@fresnel/contracts/conversation";
import { Fragment, useState, type ReactNode } from "react";
import type { ConvoMarker } from "../../state/engine/convo.ts";
import {
  useLeadSegments,
  useOpenThreadRunning,
  useTurnSummaries,
} from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { useModelNameOf } from "../model-usage.ts";
import { MetaParts } from "../meta-parts.tsx";
import { ReplyActions } from "./message-actions.tsx";
import { DrivingBy } from "./drive-stack.tsx";
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
  const meta = summary === undefined ? [] : turnMetaOf(summary, nameOf);
  const lines = summary === undefined ? [] : turnDetailLinesOf(summary);
  const invoked = summary?.invoked.length ?? 0;
  if (stop === null && meta.length === 0 && props.replyId === null && invoked === 0) return null;
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
          {meta.length === 0 ? null : lines.length === 0 ? (
            <span className="convo-line-meta inline-flex items-baseline gap-3 px-1.5">
              <MetaParts parts={meta} />
            </span>
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
              <span
                className="convo-line-meta inline-flex items-baseline gap-3 rounded-xs px-1.5"
                tabIndex={0}
              >
                <MetaParts parts={meta} />
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

/**
 * Drive 구간 머리(lcM6g, 사용자 2026-11-21: 보라 점과 왼쪽 띠를 없앴다). 색 없는 조용한 한 줄이다: 지금 Drive 중이면
 * "Driving by authoring"(앞 글 13/400 secondary, 이름 13/500 primary. 물결은 입력창 위 띠만 흐르므로 여기는 멈춰 있다), 끝났으면
 * "authoring의 Drive". 한도 칸("0/4턴", "토큰 0/40만", "위임 0/8", 12 tertiary)은 줄 오른쪽 끝 묶음에 서고 칸 사이는 12다
 * (lcDot, 사용자 2026-11-22 "가운뎃점 절대 쓰지마": 가운뎃점 대신 자리와 간격으로 나눈다. 턴 발 줄의 오른쪽 메타와 같은 끝선,
 * 입력창 위 띠의 턴 수와 같은 문법). 줄들은 28 높이 칸의 세로 가운데에 서고(끝 줄 `LeadEnd`와 같다), 줄 안의 글은 기준선을 맞춘다. 좁으면 한도 묶음이 다음 줄 오른쪽으로 내려간다. 구간의 시작은 이 줄이, 끝은 끝 줄(`LeadEnd`)이 말한다
 */
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
      className="flex min-h-7 min-w-0 flex-wrap content-center items-baseline gap-x-3 gap-y-1"
      data-slot="convo-lead-head"
    >
      {lead.active ? (
        <DrivingBy
          name={name}
          wave={false}
          wordSlot="convo-lead-driving"
          nameSlot="convo-lead-name"
          wordClassName="text-ui"
          nameClassName="text-ui font-medium text-text-primary"
        />
      ) : (
        <span className="text-ui text-text-secondary">
          {t("desktop.convo.lead.past", { name })}
        </span>
      )}
      {meters.length === 0 ? null : (
        <span
          data-slot="convo-lead-meters"
          className="convo-line-meta ms-auto flex items-baseline gap-3 tabular-nums"
        >
          {meters.map((meter, index) => (
            <Fragment key={meter.text}>
              {index === 0 ? null : " "}
              <span
                data-slot="convo-lead-meter"
                className={meter.warn ? "convo-meter-warn whitespace-nowrap" : "whitespace-nowrap"}
              >
                {meter.text}
              </span>
            </Fragment>
          ))}
        </span>
      )}
    </div>
  );
}

/** Drive 구간 끝: 반납 사유(머리 줄과 같은 왼쪽 선, tertiary). 다음 턴과는 아래 24로 떨어진다 */
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
