// 메트릭·트레이스 화면의 공용 틀: 섹션(제목은 크고 진하게, 아이콘 없음), 판, 칸의 읽기 상태. 인사이트 카드는 `insights.tsx`가 따로 그린다(m6X3).
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { Button, Skeleton } from "@caustic/react";
import type { ReactNode } from "react";
import { InfoTip } from "../info-tip.tsx";
import type { Load } from "./source.ts";

/** 섹션 하나. 섹션 사이는 화면이 간격(gap-10)으로 가른다 */
export function Section(props: {
  readonly id: string;
  readonly title: string;
  readonly info?: string | readonly string[];
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}): ReactNode {
  const titleId = `${props.id}-title`;
  return (
    <section
      aria-labelledby={titleId}
      className={`grid min-w-0 grid-cols-1 gap-3 ${props.className ?? ""}`}
    >
      <div className="flex min-h-7 items-center gap-2">
        <h2 id={titleId} className="text-title-3 leading-5 font-semibold text-text-primary">
          {props.title}
        </h2>
        {props.info === undefined ? null : <InfoTip text={props.info} />}
        {props.actions === undefined ? null : (
          <div className="ml-auto flex items-center gap-1">{props.actions}</div>
        )}
      </div>
      {props.children}
    </section>
  );
}

/** 메트릭·트레이스의 판(m6X3): 알림 토스트와 같은 rounded-2xl(squircle), p-4, gap-3, border-subtle */
export function Card(props: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: "div" | "li";
}): ReactNode {
  const className = `grid min-w-0 grid-cols-1 gap-3 rounded-2xl border border-border-subtle bg-surface-base p-4 ${props.className ?? ""}`;
  return props.as === "li" ? (
    <li className={className}>{props.children}</li>
  ) : (
    <div className={className}>{props.children}</div>
  );
}

/** 칸이 읽히기 전의 자리. 그림의 높이를 미리 잡아 읽은 뒤 화면이 뛰지 않는다 */
export function LoadingBlock(props: {
  readonly height: number;
  readonly label: string;
}): ReactNode {
  return (
    <div
      aria-busy="true"
      aria-label={props.label}
      className="grid grid-cols-1 gap-2"
      style={{ minHeight: props.height }}
    >
      <Skeleton width="38%" height={12} />
      <Skeleton width="100%" height={Math.max(12, props.height - 40)} radius="lg" />
    </div>
  );
}

/** 칸 단위의 실패·미준비·연결 끊김. 장소가 아니라 칸마다 "다시 읽기"를 준다(화면 10.1) */
export function LoadProblem(props: {
  readonly kind: "offline" | "unsupported" | "error";
  readonly onRetry?: () => void;
}): ReactNode {
  const word: Readonly<Record<typeof props.kind, MessageId>> = {
    offline: "desktop.craft.metrics.state.offline",
    unsupported: "desktop.craft.metrics.state.unsupported",
    error: "desktop.craft.metrics.state.error",
  };
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-2xl border border-dashed border-border-default px-4 py-3 text-ui text-text-secondary">
      <span className="min-w-0 flex-1">{t(word[props.kind])}</span>
      {props.kind === "error" && props.onRetry !== undefined ? (
        <Button size="sm" variant="ghost" onClick={props.onRetry}>
          {t("desktop.craft.metrics.state.retry")}
        </Button>
      ) : null}
    </div>
  );
}

/** 칸의 읽기 상태에 따라 내용 또는 상태를 그린다 */
export function Gate<T>(props: {
  readonly load: Load<T>;
  readonly height: number;
  readonly label: string;
  readonly onRetry: () => void;
  readonly children: (value: T) => ReactNode;
}): ReactNode {
  const load = props.load;
  switch (load.kind) {
    case "loading":
      return <LoadingBlock height={props.height} label={props.label} />;
    case "offline":
    case "unsupported":
      return <LoadProblem kind={load.kind} />;
    case "error":
      return <LoadProblem kind="error" onRetry={props.onRetry} />;
    case "ready":
      return props.children(load.value);
    default:
      return assertNever(load, "Load");
  }
}

/** 작은 수치 한 칸(머리 숫자). 값이 없으면 그 사유를 흐리게 */
export function Stat(props: {
  readonly label: string;
  readonly value: string;
  readonly muted?: boolean;
  readonly info?: string;
  readonly mark?: ReactNode;
}): ReactNode {
  return (
    <div className="grid grid-cols-1 min-w-0 gap-1">
      <div className="flex items-center gap-1.5 text-ui-sm text-text-tertiary">
        {props.mark}
        <span className="min-w-0 text-pretty">{props.label}</span>
        {props.info === undefined ? null : <InfoTip text={props.info} />}
      </div>
      <div
        className={`truncate ${props.muted === true ? "text-ui text-text-tertiary" : "text-title-2 leading-7 font-semibold text-text-primary"}`}
      >
        {props.value}
      </div>
    </div>
  );
}
