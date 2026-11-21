// 대화 화면의 beam 두 곳(DP-107·160 [결정: 2026-11-12 사용자]). 엔진 상태를 읽어 beam.tsx의 부품에 넘긴다.
// 입력창: 턴이 도는 동안 아래 변의 곧은 구간에 빛이 서서 흐르고(돌지 않는다, DP-167), 그 대화에 승인을 기다리는 요청이 있으면 흐름이 멈춰
// 같은 구간이 경고 색 선으로 고정된다. 둥근 모서리의 곡선에는 어느 상태의 빛도 칠하지 않는다(DP-167 개정 2026-11-21 lcQ2).
// 머리 줄: 대화를 불러오는 동안 아래 변을 같은 질감의 선(border-beam line)이 흐른다.

import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ReactNode } from "react";
import {
  useOpenThreadId,
  useOpenThreadRunning,
  useThreadApprovals,
  useTranscriptStatus,
} from "../../state/engine/index.ts";
import { BeamLine, BeamScope, beamStateOf } from "./beam.tsx";

/** 입력창 상자(composer.tsx의 Textarea 바깥 칸) */
const COMPOSER_BOX = ".composer-box";

function ComposerBeamFor(props: {
  readonly threadId: ThreadId;
  readonly children: ReactNode;
}): ReactNode {
  const running = useOpenThreadRunning();
  const approvals = useThreadApprovals(props.threadId);
  return (
    <BeamScope
      target={COMPOSER_BOX}
      state={beamStateOf({ running, awaitingApproval: approvals > 0 })}
      className="flex flex-none flex-col"
    >
      {props.children}
    </BeamScope>
  );
}

/** 입력창(과 그 자리의 대체물)을 감싼다. 열린 대화가 없으면 그대로 그린다 */
export function ComposerBeam(props: { readonly children: ReactNode }): ReactNode {
  const threadId = useOpenThreadId();
  if (threadId === null) return props.children;
  return <ComposerBeamFor threadId={threadId}>{props.children}</ComposerBeamFor>;
}

/** 대화 머리 줄을 감싸 그 아래 변에 불러오는 중 선을 붙인다 */
export function ThreadLoadBeam(props: { readonly children: ReactNode }): ReactNode {
  const loading = useTranscriptStatus() === "loading";
  return (
    <div className="relative flex flex-none flex-col">
      {props.children}
      <BeamLine active={loading} />
    </div>
  );
}
