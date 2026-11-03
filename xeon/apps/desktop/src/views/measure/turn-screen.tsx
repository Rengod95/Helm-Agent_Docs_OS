// Turn 하나를 읽어 `TurnView`로 그린다. 성능 측정 화면(P-20)과 P-02의 Turn 줄이 같은 부품을 쓴다.
import type { TabLink } from "@fresnel/client/workbench";
import type { ReactNode } from "react";
import { useMeasureRead } from "./measure-read.ts";
import { TurnView } from "./turn-view.tsx";

export function TurnReview(props: {
  readonly threadId: string;
  readonly turnId: string;
  readonly link: TabLink;
}): ReactNode {
  const { threadId, turnId } = props;
  const read = useMeasureRead(`turn:${threadId}:${turnId}`, props.link, (commands) =>
    commands.measure.turn(threadId, turnId),
  );
  return <TurnView read={read} />;
}
