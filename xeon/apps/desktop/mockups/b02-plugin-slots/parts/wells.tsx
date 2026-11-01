// well slot 내용(ADR-0021 §3.2). 셸 틀(머리: 짧은 이름 + 회색 mono id, "크게", 닫기, 폭 320~480)은 _shell/right-panel이 그린다.
// - 선언형 well: 앱이 caustic으로 그린 트리(well 안 테두리 없는 변형, DP-20).
// - 자체 코드 well(taskflow/panel): 셸이 상자 경계와 "자체 코드 화면" 표지 한 줄을 그리고, 그 안은 플러그인 문서.
import { Badge, ListDescription, ListDescriptionRow, Tooltip } from "@caustic/react";
import type { ReactNode } from "react";
import {
  Clock,
  CodeXml,
  Compass,
  Eye,
  FileText,
  GitBranch,
  Globe,
  Lightbulb,
  Target,
  T,
} from "../../_shell";
import { FrameBox } from "../../b01-plugin-frame/parts/frame-host";
import { HelmWell } from "../../wb-opus/screens/helm-well";
import type { WellDecl } from "../data";

export const ICONS: Record<string, ReactNode> = {
  Compass: <Compass />,
  GitBranch: <GitBranch />,
  Eye: <Eye />,
  Lightbulb: <Lightbulb />,
  Globe: <Globe />,
  FileText: <FileText />,
  Target: <Target />,
  Clock: <Clock />,
};

const LD = "rounded-none [&_[data-slot=list-description-row]]:px-0 [--cs-size-list-term:5rem]";

/** 자체 코드 well: 셸 표지 한 줄 + 상자. 안쪽은 플러그인 문서 흉내(토큰 색만, caustic 부품 없음). */
function TaskflowWell({ reason }: { reason: string }) {
  return (
    <div className="grid gap-2">
      <Tooltip side="bottom" align="start" content={reason}>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 justify-self-start rounded-sm text-ui-xs text-text-tertiary outline-none focus-visible:focus-ring"
        >
          <CodeXml emphasis="muted" aria-hidden className="size-icon-xs" />
          {T.viewFrame}
        </button>
      </Tooltip>
      <FrameBox label={`작업 흐름 ${T.viewFrame}`}>
        <div className="grid gap-3 p-3">
          <svg viewBox="0 0 280 96" role="img" aria-label="작업 흐름 그래프" className="w-full">
            {[
              ["M40 30 C80 30, 80 48, 120 48", 0],
              ["M40 66 C80 66, 80 48, 120 48", 1],
              ["M160 48 C200 48, 200 26, 236 26", 2],
              ["M160 48 C200 48, 200 70, 236 70", 3],
            ].map(([d, k]) => (
              <path
                key={k}
                d={String(d)}
                fill="none"
                stroke="var(--cs-color-border-strong)"
                strokeWidth={1.25}
              />
            ))}
            {[
              ["t10", 20, 30, "done"],
              ["t11", 20, 66, "done"],
              ["t12", 140, 48, "doing"],
              ["t13", 256, 26, "todo"],
              ["t14", 256, 70, "todo"],
            ].map(([id, x, y, c]) => (
              <g key={String(id)}>
                <rect
                  x={Number(x) - 20}
                  y={Number(y) - 10}
                  width={40}
                  height={20}
                  rx={10}
                  fill={
                    c === "doing"
                      ? "var(--cs-color-agent-soft)"
                      : c === "done"
                        ? "var(--cs-color-bg-inset)"
                        : "var(--cs-color-surface-raised)"
                  }
                  stroke="var(--cs-color-border-default)"
                />
                <text
                  x={Number(x)}
                  y={Number(y) + 4}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="var(--cs-font-mono)"
                  fill="var(--cs-color-text-primary)"
                >
                  {String(id)}
                </text>
              </g>
            ))}
          </svg>
          <div className="grid gap-1.5 rounded-xl bg-bg-inset p-2">
            <span className="text-ui-xs font-semibold text-text-secondary">진행 1</span>
            <div className="rounded-lg bg-surface-raised p-2 text-ui-xs text-text-primary shadow-1">
              <span className="font-mono text-text-tertiary">t12</span> TTL 경계 시각 재현 시험
            </div>
          </div>
        </div>
      </FrameBox>
    </div>
  );
}

function ReviewWell() {
  return (
    <div className="grid gap-2">
      <p className="m-0 text-ui-xs text-text-tertiary">검토 대기 12건 · 가장 오래된 요청 3일 전</p>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {[
          ["캐시 키 해시 고정", "3일 전", "warning"],
          ["무효화 이벤트 순서", "어제", "neutral"],
          ["시험 시계 주입", "오늘", "neutral"],
        ].map(([t, at, tone]) => (
          <li key={t} className="flex items-baseline gap-2 text-ui-dense">
            <Badge size="sm" tone={tone === "warning" ? "warning" : "neutral"}>
              {at}
            </Badge>
            <span className="truncate text-text-primary">{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SmallWell({ rows }: { rows: [string, string][] }) {
  return (
    <ListDescription variant="ghost" size="xs" aria-label="요약" className={LD}>
      {rows.map(([k, v]) => (
        <ListDescriptionRow key={k} term={k}>
          {v}
        </ListDescriptionRow>
      ))}
    </ListDescription>
  );
}

export function WellContent({ w }: { w: WellDecl }) {
  switch (w.id) {
    case "helm/panel":
      return <HelmWell />;
    case "taskflow/panel":
      return <TaskflowWell reason={w.reason ?? ""} />;
    case "review/queue":
      return <ReviewWell />;
    case "learning/notes":
      return (
        <SmallWell
          rows={[
            ["이번 대화", "규칙 후보 2"],
            ["최근", "시험 시계는 주입"],
          ]}
        />
      );
    case "web-exa/recent":
      return (
        <SmallWell
          rows={[
            ["최근", "ttl cache boundary bug"],
            ["결과", "8개"],
          ]}
        />
      );
    case "acme-notes/side":
      return (
        <SmallWell
          rows={[
            ["고정", "만료 비교 단위"],
            ["노트", "5개"],
          ]}
        />
      );
    case "turn-cost/panel":
      return (
        <SmallWell
          rows={[
            ["이번 턴", "토큰 12.4k · 0.09달러"],
            ["이 대화", "토큰 312k · 2.10달러"],
          ]}
        />
      );
    default:
      return (
        <SmallWell
          rows={[
            ["남은 시간", "18분"],
            ["오늘", "집중 2회"],
          ]}
        />
      );
  }
}
