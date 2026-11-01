// batch A 공용: 트랜스크립트 항목 한 형식과 그리기(목업 전용). 페이지 상태 기계가 이 목록을 만들고 ChatStage 안에서 ItemView로 그린다.
// 런타임 행은 DP-19(흐린 한 줄, 동작 0~1개, 출처 tertiary DP-33), 카드는 승인과 플러그인 card 기여에만(node로 넘긴다).
import { Message } from "@caustic/react";
import type { ReactNode } from "react";
import {
  ArrowRightToLine,
  Bell,
  CircleAlert,
  CircleCheck,
  Clock,
  FlaskConical,
  Hand,
  Layers,
  Lock,
  Pause,
  Play,
  Stop,
  TriangleAlert,
  useShell,
  WandSparkles,
} from "../_shell";
import { ToolRow } from "../p02-opus/parts/tool-row";
import { RuntimeRow, Streamed } from "./chat";

export type RowIcon =
  | "lease"
  | "pause"
  | "play"
  | "step"
  | "flask"
  | "danger"
  | "warn"
  | "ok"
  | "ask"
  | "clock"
  | "stop"
  | "lock"
  | "bell"
  | "author";

export type ChatItem =
  | { k: "user"; text: string; meta?: string }
  | { k: "agent"; text: string; live?: boolean; meta?: string }
  | {
      k: "tool";
      name: string;
      detail: string;
      status: "done" | "failed";
      duration: string;
      output?: string;
    }
  | {
      k: "row";
      text: string;
      source?: string;
      icon?: RowIcon;
      tone?: "danger" | "warning" | "info" | "success";
      action?: { label: string; onClick: () => void; disabled?: boolean };
      live?: boolean;
    }
  | { k: "node"; key: string; node: ReactNode };

const ICON: Record<RowIcon, (muted: boolean) => ReactNode> = {
  lease: (m) => <Layers {...(m ? { emphasis: "muted" as const } : {})} />,
  pause: (m) => <Pause {...(m ? { emphasis: "muted" as const } : {})} />,
  play: (m) => <Play {...(m ? { emphasis: "muted" as const } : {})} />,
  step: (m) => <ArrowRightToLine {...(m ? { emphasis: "muted" as const } : {})} />,
  flask: (m) => <FlaskConical {...(m ? { emphasis: "muted" as const } : {})} />,
  danger: () => <CircleAlert />,
  warn: () => <TriangleAlert />,
  ok: (m) => <CircleCheck {...(m ? { emphasis: "muted" as const } : {})} />,
  ask: (m) => <Hand {...(m ? { emphasis: "muted" as const } : {})} />,
  clock: (m) => <Clock {...(m ? { emphasis: "muted" as const } : {})} />,
  stop: (m) => <Stop {...(m ? { emphasis: "muted" as const } : {})} />,
  lock: (m) => <Lock {...(m ? { emphasis: "muted" as const } : {})} />,
  bell: (m) => <Bell {...(m ? { emphasis: "muted" as const } : {})} />,
  author: (m) => <WandSparkles {...(m ? { emphasis: "muted" as const } : {})} />,
};

export function ItemView({ item }: { item: ChatItem }) {
  const m = useShell();
  switch (item.k) {
    case "user":
      return (
        <div className="grid justify-items-end gap-1">
          <Message author="user">{item.text}</Message>
          {item.meta !== undefined && (
            <span className="text-ui-xs text-text-tertiary">{item.meta}</span>
          )}
        </div>
      );
    case "agent":
      return (
        <Streamed
          text={item.text}
          live={item.live === true}
          {...(item.meta !== undefined ? { meta: item.meta } : {})}
        />
      );
    case "tool":
      return (
        <ToolRow
          name={item.name}
          detail={item.detail}
          status={item.status}
          duration={item.duration}
          output={item.output}
        />
      );
    case "row":
      return (
        <RuntimeRow
          icon={item.icon !== undefined ? ICON[item.icon](item.tone === undefined) : undefined}
          {...(item.tone !== undefined ? { tone: item.tone } : {})}
          {...(item.source !== undefined ? { source: item.source } : {})}
          {...(item.action !== undefined ? { action: item.action } : {})}
          live={item.live === true}
          onOpen={() => m.openEnd("runtime")}
        >
          {item.text}
        </RuntimeRow>
      );
    case "node":
      return <>{item.node}</>;
  }
}

/** 목록을 그린다. 같은 턴의 런타임 행이 이어지면 간격을 좁힌다. */
export function Items({ items }: { items: readonly ChatItem[] }) {
  const groups: ChatItem[][] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (it.k === "row" && last !== undefined && last[0]?.k === "row") last.push(it);
    else groups.push([it]);
  }
  return (
    <>
      {groups.map((g, i) =>
        g.length === 1 && g[0] !== undefined ? (
          <ItemView key={i} item={g[0]} />
        ) : (
          <div key={i} className="grid gap-0.5">
            {g.map((it, j) => (
              <ItemView key={j} item={it} />
            ))}
          </div>
        ),
      )}
    </>
  );
}
