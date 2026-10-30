// P-18 플러그인 화면 호스트(ADR-0021 §3.2, §3.5-3, §3.6). 셸이 그리는 것만 여기 있다:
//   머리 첫 줄(h1 제목, 확장 이름 · 등급 · 버전, project 배지, "대화로"), 상태 자리표시(extension_disabled 등), 오류 경계.
// 플러그인 트리는 children으로 받아 머리 아래에 그린다. 플러그인은 이 머리를 바꿀 수 없다.
// 경계 표시: 머리는 셸 글자 단계(h1 + tertiary 메타), 트리 영역은 role="region" "<확장> 화면"이고 h2부터 시작한다(§6.25 접근성).
import { Badge, Button, EmptyState } from "@caustic/react";
import { Component, type ReactNode } from "react";
import { MessageSquare, Package, WB_WIDTH, WorkbenchHead } from "../../_shell";

export type ViewState = "active" | "extension_disabled" | "view_disabled" | "offline";

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <EmptyState size="sm" surface="dashed" title="이 화면을 그리다 멈췄어요" />
    ) : (
      this.props.children
    );
  }
}

export function ViewHost({
  title,
  ext,
  trust,
  version,
  state,
  disabledReason,
  onBackToChat,
  onOpenDetail,
  onReenableView,
  children,
}: {
  title: string;
  ext: string;
  trust: "builtin" | "user" | "project";
  version: string;
  state: ViewState;
  disabledReason?: string;
  onBackToChat: () => void;
  onOpenDetail: () => void;
  onReenableView?: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <WorkbenchHead
        title={title}
        meta={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-mono-sm">
              {ext} · {trust} · {version}
            </span>
            {trust === "project" && (
              <Badge size="sm" tone="warning">
                프로젝트 확장
              </Badge>
            )}
          </span>
        }
        actions={
          <Button
            size="xs"
            tone="neutral"
            variant="outline"
            iconStart={<MessageSquare />}
            onClick={onBackToChat}
          >
            대화로
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 셸 머리와 플러그인 트리 사이는 간격 한 단계(pt-4)로만 나눈다(DP-03). */}
        <div className={`${WB_WIDTH} pt-4 pb-6`}>
          {state === "extension_disabled" ? (
            <EmptyState
              size="sm"
              surface="none"
              icon={<Package />}
              title={`${title.split(" ")[0]}이 꺼져 있어요`}
              description={disabledReason}
              actions={
                <Button size="xs" tone="neutral" variant="outline" onClick={onOpenDetail}>
                  확장 상세 열기
                </Button>
              }
              className="pt-16"
            />
          ) : state === "view_disabled" ? (
            <EmptyState
              size="sm"
              surface="none"
              title="이 화면이 연속 실패해 꺼졌어요"
              actions={
                <Button size="xs" tone="neutral" variant="outline" onClick={onReenableView}>
                  다시 켜기
                </Button>
              }
              className="pt-16"
            />
          ) : (
            <section role="region" aria-label={`${ext} 화면`}>
              <Boundary>{children}</Boundary>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/** invalid 노드 자리표시(ADR-0021 §3.6): 모르는 위젯 노드만 바꾸고 나머지는 그린다. 진단 한 줄. */
export function UnknownWidget({ type, diag }: { type: string; diag: string }) {
  return (
    <div
      role="note"
      className="grid gap-0.5 rounded-lg px-3 py-2.5 text-ui-dense outline outline-1 outline-dashed outline-border-control -outline-offset-1"
    >
      <span className="text-text-secondary">이 앱 버전에서 못 그리는 부품({type})</span>
      <span className="font-mono text-mono-sm text-text-tertiary">{diag}</span>
    </div>
  );
}
