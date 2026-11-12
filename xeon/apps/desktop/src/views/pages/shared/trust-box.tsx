import type { ReactNode } from "react";

// 확인 값 상자(DP-115 [결정: 2026-11-12 dzRW]). 처음 보는 SSH 호스트 키나 인증서를 믿기 전에 견줄 값을 보인다.
// 우물(bg.inset) 반경 8, 안쪽 12, 사이 8. 위에서부터: 설명 13 secondary · 값 이름 12 tertiary · 값 mono 12 primary(줄바꿈 허용,
// 4자 묶음이면 묶음 사이에서만 끊긴다) · 동작(sm 단추). `tone="danger"`는 저장된 값과 다를 때(설명이 danger 글).

export interface TrustBoxProps {
  /** 무엇을 왜 견주는지 한두 문장 */
  readonly message: ReactNode;
  /** 값 이름("SHA256 · ED25519", "인증서 확인 값") */
  readonly valueLabel: string;
  /** 견줄 값 */
  readonly value: string;
  readonly tone?: "neutral" | "danger" | undefined;
  /** 믿기·바꾸기 단추 */
  readonly actions?: ReactNode | undefined;
  readonly slot?: string | undefined;
}

/** 확인 값을 4자 묶음으로 나눈다(16진수 64자 같은 긴 값). 콜론·공백은 지우고, `SHA256:`처럼 접두사가 있으면 그대로 둔다 */
export function groupedValue(value: string): string {
  if (value.includes(":") && !/^[0-9a-fA-F:]+$/.test(value)) return value;
  const bare = value.replaceAll(":", "").replaceAll(" ", "").toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < bare.length; i += 4) groups.push(bare.slice(i, i + 4));
  return groups.join(" ");
}

export function TrustBox(props: TrustBoxProps): ReactNode {
  const danger = props.tone === "danger";
  return (
    <div
      data-slot={props.slot ?? "trust-box"}
      data-tone={danger ? "danger" : "neutral"}
      className="grid min-w-0 gap-2 rounded-lg bg-bg-inset p-3"
    >
      <p className={`m-0 text-ui ${danger ? "text-danger-text" : "text-text-secondary"}`}>
        {props.message}
      </p>
      <div className="grid min-w-0 gap-0.5">
        <span className="text-ui-sm text-text-tertiary">{props.valueLabel}</span>
        <code className="font-mono text-mono-sm break-words text-text-primary">{props.value}</code>
      </div>
      {props.actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2 pt-1">{props.actions}</div>
      )}
    </div>
  );
}
