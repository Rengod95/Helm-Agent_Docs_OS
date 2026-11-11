// 설정 화면(P-09)의 배지 색. 적용 시점의 글자는 client가 `FieldVM`에 이미 담아 준다.

/** 배지 색 한 쌍(바탕, 글자)의 caustic 토큰. 색은 글자와 함께 쓴다(§4.8.1). `Badge`의 `tone` prop은 쓰지 않는다(폐기 표시) */
export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "info" | "agent";

export const TONE_CLASS: Readonly<Record<BadgeTone, string>> = {
  neutral: "bg-neutral-soft text-neutral-text",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  info: "bg-info-soft text-info-text",
  agent: "bg-agent-soft text-agent-text",
};
