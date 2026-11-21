// 대화 화면의 beam 두 곳(DP-107·160 [결정: 2026-11-12 사용자]). 엔진 상태를 읽어 beam.tsx의 부품에 넘긴다.
// 입력창: 턴이 도는 동안 아래 변의 곧은 구간에 빛이 서서 흐르고(돌지 않는다, DP-167), 그 대화에 승인을 기다리는 요청이 있으면 흐름이 멈춰
// 같은 구간이 경고 색 선으로 고정된다. 둥근 모서리의 곡선에는 어느 상태의 빛도 칠하지 않는다(DP-167 개정 2026-11-21 lcQ2).
// Drive 띠가 보이는 동안은 입력창 빛이 꺼지고 띠가 같은 빛을 맡는다(lcM6c, `useComposerBeamYield`).
// 머리 줄: 대화를 불러오는 동안 아래 변을 같은 질감의 선(border-beam line)이 흐른다.

import type { ThreadId } from "@fresnel/contracts/conversation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  useOpenThreadId,
  useOpenThreadRunning,
  useThreadApprovals,
  useTranscriptStatus,
} from "../../state/engine/index.ts";
import { BeamLine, BeamScope, beamStateOf, type BeamState } from "./beam.tsx";

/** 입력창 상자(composer.tsx의 Textarea 바깥 칸) */
const COMPOSER_BOX = ".composer-box";

/** 입력창 빛을 Drive 띠에 넘기는 신호(lcM6c). 띠가 보이는 동안 입력창 안의 띠가 true를 알리고, 입력창 빛은 꺼진다 */
const DriveBeamYield = createContext<((yielded: boolean) => void) | null>(null);

/**
 * Drive 띠가 보이는 동안 입력창 빛을 끈다. 빛은 띠가 맡는다(`BeamBand`). 띠가 사라지면(언마운트 포함) 입력창 빛이 돌아온다.
 * 감싼 `ComposerBeam`이 없으면 아무것도 하지 않는다
 */
export function useComposerBeamYield(yielded: boolean): void {
  const report = useContext(DriveBeamYield);
  useEffect(() => {
    if (report === null) return undefined;
    report(yielded);
    return () => {
      report(false);
    };
  }, [report, yielded]);
}

/** 입력창 빛의 상태. Drive 띠가 빛을 맡았으면 꺼진다. 아니면 턴이 돌면 run, 승인을 기다리면 wait(전과 같다) */
export function composerBeamStateOf(input: {
  readonly running: boolean;
  readonly awaitingApproval: boolean;
  readonly driveBand: boolean;
}): BeamState {
  if (input.driveBand) return "off";
  return beamStateOf(input);
}

function ComposerBeamFor(props: {
  readonly threadId: ThreadId;
  readonly children: ReactNode;
}): ReactNode {
  const running = useOpenThreadRunning();
  const approvals = useThreadApprovals(props.threadId);
  const [driveBand, setDriveBand] = useState(false);
  return (
    <BeamScope
      target={COMPOSER_BOX}
      state={composerBeamStateOf({ running, awaitingApproval: approvals > 0, driveBand })}
      className="flex flex-none flex-col"
    >
      <DriveBeamYield value={setDriveBand}>{props.children}</DriveBeamYield>
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
