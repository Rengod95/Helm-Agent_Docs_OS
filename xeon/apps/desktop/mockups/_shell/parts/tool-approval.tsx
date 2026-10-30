// 도구 승인 카드: caustic AgentRequest(kind permission)에 명령 전문, 비밀 핸들, 위험도, 인자를 담는다.
// 트랜스크립트 끝과 끝 영역에 같은 부품으로 보인다. 카드에 초점이 있으면 Y(허용), ⇧Y(이 대화에서 항상), N(거부).
import { AgentRequest, Badge, ListDescription, ListDescriptionRow } from "@caustic/react";
import type { KeyboardEvent } from "react";
import type { ToolApproval } from "../fixtures";

/** 승인 카드 상태. once는 allowed가 되었다가 1초 뒤 gone. */
export type Decision = "pending" | "allowed" | "always" | "denied" | "answered" | "gone";

export interface ToolApprovalCardProps {
  approval: ToolApproval;
  decision: Decision;
  subtitle: string;
  onDecide: (d: "allowed" | "always" | "denied") => void;
  locked?: boolean;
  /** 이미 표면 안(오른쪽 well 카드)에 놓일 때: 상자 없이 간격으로만(DP-03). */
  flat?: boolean;
}

const ACTION_TO_DECISION = { deny: "denied", always: "always", once: "allowed" } as const;

export function ToolApprovalCard({
  approval,
  decision,
  subtitle,
  onDecide,
  locked = false,
  flat = false,
}: ToolApprovalCardProps) {
  if (decision === "gone") return null;
  if (decision !== "pending") {
    const title =
      decision === "denied"
        ? "거부했어요"
        : decision === "always"
          ? "이 대화에서 항상 허용"
          : "허용했어요";
    return (
      <AgentRequest
        kind="permission"
        status={decision === "denied" ? "denied" : "allowed"}
        title={title}
        subtitle={`${approval.tool} · ${approval.command}`}
      />
    );
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).closest("input, textarea, summary")) return;
    if (e.key === "Y" || (e.key === "y" && e.shiftKey)) {
      e.preventDefault();
      onDecide("always");
    } else if (e.key === "y") {
      e.preventDefault();
      onDecide("allowed");
    } else if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      onDecide("denied");
    }
  };

  const extraArgs = Object.entries(approval.args).filter(([k]) => k !== "command");

  return (
    <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
      <legend className="sr-only">도구 승인 요청</legend>
      <AgentRequest
        kind="permission"
        title={
          <>
            <span className="sr-only">도구 승인: </span>
            <span className="font-mono">{approval.tool}</span>
          </>
        }
        subtitle={subtitle}
        tabIndex={-1}
        aria-keyshortcuts="Y Shift+Y N"
        onKeyDown={onKeyDown}
        // 한 단계 깊이만: 패널·무대 위 카드는 그림자 대신 border-subtle 헤어라인 하나.
        shadow="none"
        {...(flat ? { variant: "ghost" as const } : {})}
        className={
          flat
            ? "px-0 py-0 outline-none focus-visible:focus-ring"
            : "shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] outline-none focus-visible:focus-ring"
        }
        actions={[
          { id: "deny", label: "거부", tone: "danger" },
          { id: "always", label: "이 대화에서 항상", tone: "secondary" },
          { id: "once", label: "허용", tone: "primary" },
        ]}
        onAction={(id) => onDecide(ACTION_TO_DECISION[id as keyof typeof ACTION_TO_DECISION])}
      >
        {/* 승인에 필요한 사실은 한 목록(caustic ListDescription)으로: 명령 전문, 위험도, 비밀 핸들, 인자. 이름표는 목록이 맡는다(DP-12). */}
        <ListDescription
          variant="ghost"
          size="xs"
          aria-label="승인 상세"
          // 카드가 이미 좌우 여백을 준다: 행의 좌우 여백은 0(DP-07). 이름표 열은 가장 긴 이름표(timeoutSeconds) 폭만큼.
          className="rounded-none [--cs-size-list-term:7rem] [&_[data-slot=list-description-row]]:px-0"
        >
          <ListDescriptionRow term="명령" mono>
            <span className="whitespace-pre-wrap break-all">{approval.command}</span>
          </ListDescriptionRow>
          <ListDescriptionRow term="위험도">
            <Badge size="xs" tone="warning">
              {approval.risk}
            </Badge>
          </ListDescriptionRow>
          {approval.secrets.map((sec) => (
            <ListDescriptionRow key={sec.env} term="비밀" mono>
              <span className="break-all">
                {sec.env} ← {sec.ref}
              </span>
            </ListDescriptionRow>
          ))}
          {extraArgs.map(([k, v]) => (
            <ListDescriptionRow key={k} term={k} mono>
              {String(v)}
            </ListDescriptionRow>
          ))}
        </ListDescription>
      </AgentRequest>
    </fieldset>
  );
}
