import { Button } from "@caustic/react";
import { ChevronDown, ChevronRight } from "@caustic/react/icons";
import { useId, useState, type ReactNode } from "react";
import { SettingSection } from "../settings/settings-section.tsx";

// 접는 "고급" 구역(DP-85 [결정: 2026-11-11 사용자]). 자주 바꾸지 않는 설정을 기본으로 접어 두고, 머리 단추로 펼친다.
// 머리는 구역 제목 대신 ghost 단추(chevron 14 + 글 13/500 secondary)다. 펼치면 같은 설정 카드(SettingSection)에 줄이 든다.
// 바뀐 값이 있으면(`forceOpen`) 처음부터 펼친다.

export function FoldedFields(props: {
  readonly title: string;
  /** 접힌 머리 옆 곁 정보("7개") */
  readonly count: number;
  readonly forceOpen?: boolean | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(props.forceOpen === true);
  const id = useId();
  const shown = open || props.forceOpen === true;
  return (
    <div data-slot="folded-fields" className="pt-10">
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={shown}
        aria-controls={id}
        className="-ms-2"
        onClick={() => {
          setOpen((prev) => !prev);
        }}
      >
        {shown ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        <span className="text-text-secondary">{props.title}</span>
        <span className="text-text-tertiary">{props.count}</span>
      </Button>
      {shown ? (
        <div id={id}>
          <SettingSection continues label={props.title}>
            {props.children}
          </SettingSection>
        </div>
      ) : null}
    </div>
  );
}
