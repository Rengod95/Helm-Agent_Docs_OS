import {
  ChevronRight,
  Clipboard,
  Command,
  Diamond,
  File,
  FileText,
  Folder,
  Globe,
  Lightbulb,
  ListChecks,
  Plug,
  Search,
  Sparkles,
  SquarePen,
  Terminal,
} from "@caustic/react/icons";
import { Badge } from "@caustic/react";
import { assertNever } from "@fresnel/contracts";
import { t } from "@fresnel/client/i18n";
import { useState, type ReactNode } from "react";
import { CallChip } from "../call-chip.tsx";
import { InterventionTags } from "./intervention-tags.tsx";
import type { InterventionTag } from "./intervention-model.ts";
import {
  failureLabelOf,
  failureToneOf,
  type FailureKind,
  type ToolIcon,
  type ToolTarget,
} from "./tool-view-model.ts";

// 도구 줄(dzT2a 시안 3.3). 카드 테두리 없는 28px 한 줄: 아이콘 14 · 동사 13/500 · 대상(경로 칩, 명령 mono, 글) · 꼬리표 · 메타 · 상태.
// 상세가 있으면 줄 전체가 펼침 단추(보이지 않는 덮개)이고, 상세는 아이콘 열 아래로 들여 붙는다. 펼침 상태는 이 부품 한 곳에서만 쥔다.
// 상세 본문은 `Reveal` 경계 안에 둔다. 모션 트랙이 높이 잇기와 들어옴·나감을 이 경계에 입힌다.

export type LineStatus =
  | { readonly kind: "running"; readonly label: string; readonly awaiting: boolean }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly failure: FailureKind }
  /** 상태 칸을 비운다(조용한 줄의 성공, 묶음 머리) */
  | { readonly kind: "none" };

function LineIcon(props: { readonly icon: ToolIcon }): ReactNode {
  const className = "convo-line-icon";
  switch (props.icon) {
    case "read":
      return <FileText aria-hidden className={className} />;
    case "list":
      return <Folder aria-hidden className={className} />;
    case "search":
      return <Search aria-hidden className={className} />;
    case "command":
      return <Terminal aria-hidden className={className} />;
    case "edit":
      return <SquarePen aria-hidden className={className} />;
    case "write":
      return <File aria-hidden className={className} />;
    case "web":
      return <Globe aria-hidden className={className} />;
    case "mcp":
      return <Plug aria-hidden className={className} />;
    case "memory":
      return <Lightbulb aria-hidden className={className} />;
    case "skill":
      return <Sparkles aria-hidden className={className} />;
    case "tasks":
      return <ListChecks aria-hidden className={className} />;
    case "agent":
      return <Diamond aria-hidden className={className} />;
    case "plan":
      return <Clipboard aria-hidden className={className} />;
    case "other":
      return <Command aria-hidden className={className} />;
    default:
      return assertNever(props.icon, "LineIcon");
  }
}

/** 동사 뒤 대상 */
function LineTarget(props: { readonly target: ToolTarget }): ReactNode {
  const { target } = props;
  switch (target.kind) {
    case "path":
      return (
        <span className="convo-path" title={target.path}>
          {target.path}
          {target.suffix === null ? null : (
            <span className="text-text-tertiary">{target.suffix}</span>
          )}
        </span>
      );
    case "command":
      return (
        <span className="convo-line-text convo-mono" title={target.text}>
          <span className="text-text-tertiary">$ </span>
          <span className="text-text-secondary">{target.text.split("\n")[0]}</span>
        </span>
      );
    case "text":
      return target.text === "" ? null : (
        <span
          className={target.mono ? "convo-line-text convo-mono" : "convo-line-text"}
          title={target.text}
        >
          {target.text}
        </span>
      );
    case "none":
      return null;
    default:
      return assertNever(target, "ToolTarget");
  }
}

function StatusCell(props: { readonly status: LineStatus }): ReactNode {
  const { status } = props;
  switch (status.kind) {
    case "running":
      return <CallChip status="running" label={status.label} waiting={status.awaiting} />;
    case "done":
      return <CallChip status="done" />;
    case "failed":
      return (
        <CallChip
          status="failed"
          label={failureLabelOf(status.failure)}
          tone={failureToneOf(status.failure)}
        />
      );
    case "none":
      return null;
    default:
      return assertNever(status, "LineStatus");
  }
}

/** 상태를 읽는 글(화면 낭독용). 칩은 그림이라 aria-hidden이다 */
function statusText(status: LineStatus): string {
  switch (status.kind) {
    case "running":
      return status.label;
    case "done":
      return t("desktop.convo.status.done");
    case "failed":
      return failureLabelOf(status.failure);
    case "none":
      return "";
    default:
      return assertNever(status, "LineStatus");
  }
}

/** 펼침 본문 경계. 지금은 조건부로 그리고, 모션 트랙이 이 부품에 높이 잇기를 입힌다 */
export function Reveal(props: { readonly open: boolean; readonly children: ReactNode }): ReactNode {
  return props.open ? props.children : null;
}

/**
 * 펼침 상태. `want`(설정·상태가 정한 기본)가 바뀌면 그 값으로 다시 정하고, 그 사이에는 사용자가 누른 대로 둔다.
 * 펼침으로 줄 높이가 바뀌는 곳은 이 훅을 쓰는 부품뿐이다(가상 목록이 그 줄을 다시 잰다).
 */
export function useDisclosure(want: boolean): readonly [boolean, () => void] {
  const [open, setOpen] = useState(want);
  const [seen, setSeen] = useState(want);
  if (seen !== want) {
    setSeen(want);
    setOpen(want);
  }
  return [
    open,
    () => {
      setOpen((value) => !value);
    },
  ] as const;
}

export function ToolLine(props: {
  readonly icon: ToolIcon;
  readonly verb: string;
  /** 동사 자리에 도구 이름(mono)을 쓴다 */
  readonly rawName?: boolean;
  readonly quiet?: boolean;
  readonly target: ToolTarget;
  readonly server?: string | null;
  readonly tags?: readonly InterventionTag[];
  /** 대상 뒤 메타(diff 줄 수, 종료 코드·시간) */
  readonly meta?: ReactNode;
  readonly status: LineStatus;
  /** 펼치면 보일 상세. 없으면 줄은 누를 수 없다 */
  readonly detail?: ReactNode;
  readonly open?: boolean;
  readonly onToggle?: () => void;
  /** 줄 아래 늘 보이는 것(실행 중 출력 꼬리, 막힘 이유, 출처 칩) */
  readonly below?: ReactNode;
}): ReactNode {
  const toggle =
    props.detail !== undefined && props.detail !== null && props.onToggle !== undefined;
  const open = toggle && props.open === true;
  const label = [
    props.verb,
    props.target.kind === "none"
      ? ""
      : "text" in props.target
        ? props.target.text
        : props.target.path,
    statusText(props.status),
  ]
    .filter((part) => part !== "")
    .join(" · ");
  return (
    <div className="grid min-w-0">
      <div
        className="convo-line"
        data-toggle={toggle ? "true" : undefined}
        data-open={open ? "true" : undefined}
        data-quiet={props.quiet === true ? "true" : undefined}
      >
        {toggle ? (
          <button
            type="button"
            className="convo-line-hit"
            aria-expanded={open}
            aria-label={label}
            onClick={props.onToggle}
          />
        ) : null}
        <LineIcon icon={props.icon} />
        <span className={props.rawName === true ? "convo-line-verb convo-mono" : "convo-line-verb"}>
          {props.verb}
        </span>
        <span className="convo-line-target">
          {props.server === undefined || props.server === null ? null : (
            <Badge size="xs" mono>
              {props.server}
            </Badge>
          )}
          <LineTarget target={props.target} />
          {props.meta === undefined || props.meta === null ? null : (
            <span className="convo-line-meta">{props.meta}</span>
          )}
          <InterventionTags tags={props.tags ?? []} />
        </span>
        <span className="convo-line-status">
          <StatusCell status={props.status} />
          {toggle ? <ChevronRight aria-hidden className="convo-line-chevron" /> : null}
        </span>
      </div>
      {props.below}
      <Reveal open={open}>
        <div className="convo-detail">{props.detail}</div>
      </Reveal>
    </div>
  );
}
