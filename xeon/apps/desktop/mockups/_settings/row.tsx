// 설정 항목 한 줄(FieldVM 하나). caustic에 "라벨 + 키 + 범위·적용 배지 + 컨트롤 + 오류" 묶음 부품이 없어 Field와 Badge로 조합한다.
//   머리 줄: 라벨(500) · 키(mono, 연함, showKey일 때만) ………… 적용 시점(연한 글, 재시작만 warning 배지, "즉시"는 적지 않음)
//   범위 배지는 화면에 그리지 않는다. 범위는 화면 낭독기 문장에만 남긴다.
//   다음 줄: 컨트롤(자기 폭), 그 아래 도움말·오류(caustic Field)
// 줄 사이는 간격만(DP-03), 좌우 여백 없음(DP-07). 배지는 화면 낭독기에 문장으로 읽힌다("사용자 범위, 즉시 적용").
import { Badge, Field } from "@caustic/react";
import { useId, type ReactNode } from "react";
import { Check, L } from "../_shell";

export type Scope = "default" | "user" | "project" | "thread" | "managed";
export type Apply = "now" | "nextTurn" | "restart" | "boundary";

const SCOPE: Record<Scope, string> = {
  default: "기본값",
  user: "사용자",
  project: "프로젝트",
  thread: "대화",
  managed: "관리",
};
const APPLY: Record<Apply, string> = {
  now: "즉시",
  nextTurn: "다음 턴",
  restart: "재시작 필요",
  boundary: "다음 단계 경계",
};

export function ApplyMark({ apply }: { apply: Apply }) {
  // "즉시"는 기본이라 적지 않는다.
  if (apply === "now") return null;
  if (apply === "restart")
    return (
      <Badge size="sm" tone="warning">
        {L(APPLY.restart)}
      </Badge>
    );
  return <span className="text-ui-sm text-text-tertiary">{L(APPLY[apply])}</span>;
}

export function SavedMark() {
  return (
    <span role="status" className="inline-flex items-center gap-1 text-ui-sm text-success-text">
      <Check aria-hidden className="size-icon-sm" />
      저장됨
    </span>
  );
}

export interface SettingRowProps {
  label: ReactNode;
  /** 스키마 키(l1.models.default 등). showKey일 때만 보인다. */
  k?: string | undefined;
  /** 키를 라벨 옆에 보인다(키 찾기 결과). 기본은 숨긴다. */
  showKey?: boolean | undefined;
  scope?: Scope | undefined;
  apply?: Apply | undefined;
  /** 방금 저장: 적용 시점 자리에 "저장됨"이 2초 보인다. */
  saved?: boolean | undefined;
  /** 라벨 옆 배지(폐기 예정, 다른 곳에서 바뀜 등). */
  flag?: ReactNode | undefined;
  hint?: ReactNode | undefined;
  error?: ReactNode | undefined;
  warning?: ReactNode | undefined;
  disabled?: boolean | undefined;
  /** 컨트롤 아래 덧붙임(가려진 범위 값, 잠금 문장). */
  extra?: ReactNode | undefined;
  children?: ReactNode | undefined;
}

export function SettingRow({
  label,
  k,
  showKey = false,
  scope,
  apply,
  saved = false,
  flag,
  hint,
  error,
  warning,
  disabled = false,
  extra,
  children,
}: SettingRowProps) {
  const id = useId();
  const sr = [scope && `${SCOPE[scope]} 범위`, apply && `${APPLY[apply]} 적용`]
    .filter(Boolean)
    .join(", ");
  return (
    <div role="group" aria-labelledby={`${id}-l`} className="grid gap-1.5 py-2">
      <div className="flex min-h-6 min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span id={`${id}-l`} className="shrink-0 text-ui font-medium text-text-primary">
            {label}
            {sr !== "" && <span className="sr-only">, {sr}</span>}
          </span>
          {showKey && k !== undefined && (
            <span className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary">{k}</span>
          )}
          {flag}
        </div>
        <div aria-hidden className="flex flex-none items-center gap-2">
          {saved ? <SavedMark /> : apply !== undefined && <ApplyMark apply={apply} />}
        </div>
      </div>
      {children !== undefined && (
        <Field hint={hint} error={error} warning={warning} disabled={disabled}>
          {children}
        </Field>
      )}
      {extra}
    </div>
  );
}

/** 탭 안 묶음 머리. 긴 탭에서는 스크롤해도 위에 붙는다(FormLayoutSection 머리 고정 대신, 표면 없는 가운데라 bg-app 바탕). */
export function SettingSection({
  title,
  end,
  children,
}: {
  title: ReactNode;
  end?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="pt-3 first:pt-0">
      <div className="sticky top-0 z-[5] flex h-8 items-center gap-2 bg-bg-app">
        <h2 id={id} className="m-0 flex-1 text-ui-sm font-semibold text-text-secondary">
          {title}
        </h2>
        {end}
      </div>
      {children}
    </section>
  );
}
