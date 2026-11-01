// caustic 빈틈: 입력창 위에 붙는 "실행 제어 띠"(상태 한 줄 + 동작 둘)가 없다. Alert는 알림 모양(tone 면)이라 늘 보이는 제어에 무겁다.
// p02-opus ObserveBand와 같은 면(neutral-well, 헤어라인, 모서리)을 낮게(h-10) 쓰고, 상태 아이콘 하나와 caustic Button만 둔다.
// 주의가 필요한 상태(자동 꺼짐)만 아이콘 면에 tone을 준다(DP-29).
import { Button } from "@caustic/react";
import type { ReactNode } from "react";
import { ToneIcon } from "../../_shell";

export interface BandAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

export function TrialBand({
  icon,
  tone,
  text,
  meta,
  actions,
}: {
  icon: ReactNode;
  tone?: "danger" | "success" | "info";
  text: ReactNode;
  meta?: ReactNode;
  actions: BandAction[];
}) {
  return (
    <div
      role="status"
      data-slot="trial-band"
      className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-neutral-well px-3 py-1.5 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
    >
      {tone !== undefined ? (
        <ToneIcon tone={tone}>{icon}</ToneIcon>
      ) : (
        <span
          aria-hidden
          className="inline-grid size-5 place-items-center text-text-tertiary [&_svg]:size-icon-sm"
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 text-ui-dense text-text-primary">
        {text}
        {meta !== undefined && <span className="ms-2 text-text-tertiary">{meta}</span>}
      </span>
      <span className="flex flex-none items-center gap-1">
        {actions.map((a) => (
          <Button
            key={a.label}
            size="xs"
            tone="neutral"
            variant={a.primary === true ? "solid" : "ghost"}
            disabled={a.disabled}
            onClick={a.onClick}
          >
            {a.label}
          </Button>
        ))}
      </span>
    </div>
  );
}
