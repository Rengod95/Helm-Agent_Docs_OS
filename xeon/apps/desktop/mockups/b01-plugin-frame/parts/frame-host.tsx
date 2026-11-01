// P-18 셸 틀의 자체 코드 화면(frame) 부분(ADR-0021 §3.4.2, §3.6.6, §3.7). 여기 있는 것은 모두 셸이 그린다:
//   머리 첫 줄(제목, 확장 표시 이름 · id · 등급 · 버전, project 배지, "자체 코드 화면" 표지 + frame.reason 툴팁, "대화로"),
//   프레임 상자 경계, 상자 위 동작 확인 줄(call), 상자 안 셸 자리표시(ready 대기, 무응답, 다리 버전 불일치, 다시 띄움).
// 플러그인 코드는 상자 안(FrameBox children)에서만 그린다. 상자 밖(확인 줄, 승인 카드)은 플러그인이 흉내 낼 수 없다(T-16).
// caustic 빈틈: 프레임 상자(셸 경계 + 안쪽 자리표시)는 caustic에 없다. 토큰으로 만든다.
import { Alert, Badge, Button, Checkbox, EmptyState, Skeleton, Tooltip } from "@caustic/react";
import type { ReactNode } from "react";
import { CodeXml, josa, MessageSquare, Shield, T, WorkbenchHead } from "../../_shell";
import type { PluginExt, ViewDecl } from "../data";

/** 프레임 화면 가운데 폭: 판이 넓어 표 화면(60rem)보다 조금 넓게, 좌우 여백은 한 번(DP-07). */
export const FRAME_WIDTH = "mx-auto w-full max-w-[68rem] px-3";

export const trustLabel = {
  builtin: T.trustBuiltin,
  user: T.trustUser,
  project: T.trustProject,
} as const;

/** 머리 끝 표지: 자체 코드 화면이면 "자체 코드 화면", 막혀서 대체 화면이면 "대체 화면". 툴팁은 frame.reason과 파일 주소. */
export function FrameMarker({
  ext,
  view,
  fallback = false,
}: {
  ext: PluginExt;
  view: ViewDecl;
  fallback?: boolean;
}) {
  const reason = view.frame?.reason ?? "";
  return (
    <Tooltip
      side="bottom"
      align="start"
      content={
        <span className="grid max-w-[22rem] gap-1">
          <span>{reason}</span>
          {!fallback && (
            <span className="font-mono text-mono-sm opacity-70">
              xeon-view://{ext.name}/{ext.version}/{view.frame?.root.replace("./", "")}/
              {view.frame?.entry}
            </span>
          )}
        </span>
      }
    >
      <button
        type="button"
        className="inline-flex flex-none rounded-full outline-none focus-visible:focus-ring"
      >
        <Badge size="sm" tone="neutral" icon={<CodeXml />}>
          {fallback ? T.viewFallback : T.viewFrame}
        </Badge>
      </button>
    </Tooltip>
  );
}

export function ViewHead({
  ext,
  view,
  marker,
  onBackToChat,
}: {
  ext: PluginExt;
  view: ViewDecl;
  /** frame: 자체 코드 화면, fallback: 막혀서 대체 화면, none: 기본 부품 화면 */
  marker: "frame" | "fallback" | "none";
  onBackToChat: () => void;
}) {
  return (
    <WorkbenchHead
      className={FRAME_WIDTH}
      title={view.title}
      meta={
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-mono-sm">
            {ext.name} · {trustLabel[ext.trust]} · {ext.version}
          </span>
          {ext.trust === "project" && (
            <Badge size="sm" tone="warning">
              {T.trustProject} {T.extension}
            </Badge>
          )}
          {marker !== "none" && (
            <FrameMarker ext={ext} view={view} fallback={marker === "fallback"} />
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
  );
}

/** 프레임 상자: 셸이 긋는 경계 하나(ADR-0021 §3.6.8). 안쪽 여백은 플러그인 몫이라 셸은 주지 않는다. */
export function FrameBox({
  label,
  children,
  dim = false,
}: {
  label: string;
  children: ReactNode;
  dim?: boolean;
}) {
  return (
    <section
      role="region"
      aria-label={label}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_var(--cs-color-border-default)]"
    >
      <div className={`flex min-h-0 flex-1 flex-col ${dim ? "opacity-40" : ""}`}>{children}</div>
    </section>
  );
}

/** 상자 안 셸 자리표시(프레임을 내린 뒤 그 자리에). 플러그인 화면이 아니라 셸 글자 단계로 그린다. */
export function FramePlaceholder({
  icon,
  title,
  description,
  diag,
  actions,
  overlay = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  diag?: string;
  actions?: ReactNode;
  /** 흐린 프레임 위에 덮을 때 */
  overlay?: boolean;
}) {
  return (
    <div
      className={
        overlay
          ? "absolute inset-0 grid place-items-center bg-surface-base/40"
          : "grid flex-1 place-items-center"
      }
    >
      <EmptyState
        size="sm"
        surface="none"
        icon={icon}
        title={title}
        description={
          <span className="grid gap-1">
            {description !== undefined && <span>{description}</span>}
            {diag !== undefined && (
              <span className="font-mono text-mono-sm text-text-tertiary">{diag}</span>
            )}
          </span>
        }
        actions={actions}
      />
    </div>
  );
}

/** ready 대기(§3.7 loading): 상자 안 Skeleton. 5초 안에 ready가 없으면 장부에 하나 센다. */
export function FrameLoading({ line }: { line: string }) {
  return (
    <div aria-busy="true" className="grid flex-1 content-start gap-4 p-4">
      <span className="text-ui-xs text-text-tertiary">{line}</span>
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((c) => (
          <div key={c} className="grid content-start gap-2">
            <Skeleton height={14} width="40%" />
            <Skeleton height={56} />
            <Skeleton height={56} />
            {c === 0 && <Skeleton height={56} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 프레임 call 확인 줄(ADR-0021 §3.4): 셸은 프레임 안 누름을 볼 수 없어서 쓰기 동작마다 묻는다. 상자 밖 셸 층. */
export function ConfirmRow({
  ext,
  verb,
  label,
  dontAsk,
  onDontAsk,
  onAllow,
  onDeny,
}: {
  ext: PluginExt;
  verb: string;
  label: string;
  dontAsk: boolean;
  onDontAsk: (v: boolean) => void;
  onAllow: () => void;
  onDeny: () => void;
}) {
  return (
    <Alert
      tone="neutral"
      size="sm"
      icon={<Shield />}
      aria-label={T.frameConfirm}
      action={
        <>
          <label className="me-2 inline-flex cursor-pointer items-center gap-1.5 text-ui-xs text-text-secondary">
            <Checkbox size="sm" checked={dontAsk} onCheckedChange={(v) => onDontAsk(v === true)} />
            이 화면에서 묻지 않기
          </label>
          <Button size="xs" tone="neutral" variant="outline" onClick={onDeny} autoFocus>
            거절
          </Button>
          <Button size="xs" tone="neutral" variant="solid" onClick={onAllow}>
            허용
          </Button>
        </>
      }
    >
      <span className="text-text-primary">
        {josa(ext.display, "이", "가")} {josa(label, "을", "를")} 하려고 해요
      </span>{" "}
      <span className="font-mono text-mono-sm text-text-tertiary">
        ext.{ext.name}.{verb}
      </span>
    </Alert>
  );
}
