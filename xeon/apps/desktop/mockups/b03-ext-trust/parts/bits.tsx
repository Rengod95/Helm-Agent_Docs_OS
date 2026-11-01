// B03 공용 작은 부품: 신뢰 수준 이름, 연산 이름, 확장 이름(표시 이름 + 회색 mono id, 결정 13·DP-39), ListDescription 여백.
import type { ReactNode } from "react";
import { T } from "../../_shell";
import type { Op, Trust } from "../data";

export const trustName: Record<Trust, string> = {
  builtin: T.trustBuiltin,
  user: T.trustUser,
  project: T.trustProject,
};

export const opName: Record<Op, ReactNode> = {
  on: (
    <>
      {T.opOn} <span className="font-mono text-mono-sm text-text-tertiary">on</span>
    </>
  ),
  post: (
    <>
      {T.opPost} <span className="font-mono text-mono-sm text-text-tertiary">post</span>
    </>
  ),
  drive: (
    <>
      {T.opDrive} <span className="font-mono text-mono-sm text-text-tertiary">drive</span>
    </>
  ),
  storage: "저장",
  resources: "도구·명령 등록",
};

export function ExtLabel({
  display,
  name,
  strong = false,
}: {
  display: string;
  name: string;
  strong?: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className={`truncate text-text-primary ${strong ? "font-medium" : ""}`}>{display}</span>
      <span className="truncate font-mono text-mono-sm text-text-tertiary">{name}</span>
    </span>
  );
}

/** 대화 상자 안 ListDescription: 카드가 좌우 여백을 주므로 행 좌우 0(DP-07, DP-12). */
export const LD =
  "rounded-none [&_[data-slot=list-description-row]]:px-0 [--cs-size-list-term:7rem]";
