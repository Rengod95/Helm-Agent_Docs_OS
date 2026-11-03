// 라디오 목록: caustic RadioGroup의 행마다 이름 한 줄. ChoiceGroup "answer"는 고른 행을 통째로 반전(잉크 면)해
// 한 화면에 묶음이 여럿이면(구성 탭 슬롯 넷) 너무 무겁다. 고른 것은 라디오 점과 이름 굵기만으로 보인다(DP-03, DP-29).
import { RadioGroup, RadioGroupItem } from "@caustic/react";
import type { ReactNode } from "react";

export interface RadioRow {
  value: string;
  title: ReactNode;
  disabled?: boolean;
}

export function RadioList({
  label,
  labelledBy,
  value,
  onValueChange,
  rows,
}: {
  label?: string;
  labelledBy?: string;
  value: string;
  onValueChange: (v: string) => void;
  rows: RadioRow[];
}) {
  return (
    <RadioGroup
      size="sm"
      value={value}
      onValueChange={onValueChange}
      {...(label !== undefined ? { "aria-label": label } : {})}
      {...(labelledBy !== undefined ? { "aria-labelledby": labelledBy } : {})}
      className="gap-0"
    >
      {rows.map((r) => (
        <RadioGroupItem key={r.value} value={r.value} disabled={r.disabled ?? false}>
          <span className="grid min-w-0 gap-0 py-1">
            <span
              className={`text-ui-dense ${value === r.value ? "font-semibold text-text-primary" : "text-text-primary"}`}
            >
              {r.title}
            </span>
          </span>
        </RadioGroupItem>
      ))}
    </RadioGroup>
  );
}
