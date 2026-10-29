// 도구 승인 카드: caustic AgentRequest(kind permission)에 명령 전문, 비밀 핸들, 위험도, 인자를 담는다.
// 트랜스크립트 끝과 끝 영역에 같은 부품으로 보인다. 카드에 초점이 있으면 Y(허용), ⇧Y(이 대화에서 항상), N(거부).
import { AgentRequest, Badge, MessageCode } from "@caustic/react";
import type { KeyboardEvent } from "react";
import type { ToolApproval } from "./fixtures";
import { KeyRound } from "./icons";
import { Disclosure } from "./parts/disclosure";
import type { Decision } from "./store";

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
          <span className="flex items-center gap-2">
            <span>
              <span className="sr-only">도구 승인: </span>
              <span className="font-mono">{approval.tool}</span>
            </span>
            <Badge size="xs" tone="warning">
              위험도 {approval.risk}
            </Badge>
          </span>
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
        {/* 명령 전문과 비밀 핸들은 이름표 없이 간격으로만 묶는다($와 열쇠 표시가 무엇인지 말한다). */}
        <div className="grid gap-1.5">
          <MessageCode className="block whitespace-pre-wrap break-all px-2 py-1.5">
            $ {approval.command}
          </MessageCode>
          <ul aria-label="이 호출이 쓸 비밀" className="m-0 grid list-none gap-1 p-0">
            {approval.secrets.map((s) => (
              <li
                key={s.env}
                className="flex min-w-0 items-center gap-1.5 font-mono text-mono-sm text-text-primary"
              >
                <KeyRound aria-hidden className="size-icon-xs shrink-0 text-text-tertiary" />
                <span>{s.env}</span>
                <span aria-label="에서 받음" className="text-text-tertiary">
                  ←
                </span>
                <span className="min-w-0 truncate text-text-secondary">{s.ref}</span>
              </li>
            ))}
          </ul>
        </div>
        <Disclosure summary={`인자 (${extraArgs.length})`}>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-mono-sm">
            {extraArgs.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-text-tertiary">{k}</dt>
                <dd className="m-0 min-w-0 truncate text-text-primary">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      </AgentRequest>
    </fieldset>
  );
}
