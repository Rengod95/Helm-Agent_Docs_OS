import { ChoiceGroup, ChoiceGroupItem } from "@caustic/react";
import type { ReactNode } from "react";

// 3열 선택 카드 그룹. caustic ChoiceGroup(카드 모양)을 얇게 감싼다: 키보드(화살표로 옮기고 고르기)와 radiogroup 의미는
// ChoiceGroup이 준다. 열 수는 그룹을 감싼 컨테이너 폭으로 정한다. 폭이 32rem 미만이면 한 열이다. 글자는 설명과 제목 모두
// 13px로 맞춘다(caustic 기본 카드 글자는 12px 이하라서 쓰지 않는다).

export interface RadioCardGroupProps {
  /** 고른 카드의 값. 아무것도 고르지 않았으면 빈 문자열이다 */
  readonly value: string;
  /** 카드를 고르면 그 카드의 값을 준다 */
  readonly onValueChange: (value: string) => void;
  /** 모든 카드를 누를 수 없게 한다 */
  readonly disabled?: boolean;
  /** 그룹 이름(aria-label). 스크린 리더가 그룹을 이 이름으로 읽는다 */
  readonly label: string;
  /** `RadioCardItem`들 */
  readonly children: ReactNode;
}

export function RadioCardGroup(props: RadioCardGroupProps): ReactNode {
  const { value, onValueChange, disabled = false, label, children } = props;
  return (
    <div className="@container">
      <ChoiceGroup
        appearance="card"
        columns="3"
        // 카드 안쪽 여백은 sm(10px)로 줄이고, 제목과 설명 사이는 8px로 넓힌다(사용자 2026-11-11)
        size="sm"
        aria-label={label}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (typeof next === "string") onValueChange(next);
        }}
        className="grid-cols-1 @[32rem]:grid-cols-3 [&_[data-slot=choice-group-item]]:gap-y-2 [&_[data-slot=choice-group-title]]:text-ui [&_[data-slot=choice-group-description]]:text-ui"
      >
        {children}
      </ChoiceGroup>
    </div>
  );
}

export interface RadioCardItemProps {
  /** 카드의 값. 그룹의 `value`와 같은 문자열로 맞춘다 */
  readonly value: string;
  /** 아이콘. 제목 앞에 놓이고 장식용이라 스크린 리더는 건너뛴다 */
  readonly icon: ReactNode;
  /** 제목. 13px 600 글자다 */
  readonly title: ReactNode;
  /** 한 줄 설명. 제목 아래 13px 흐린 글자다 */
  readonly description: ReactNode;
  /** 이 카드만 누를 수 없게 한다 */
  readonly disabled?: boolean;
}

/** 카드 하나. 고른 카드에는 선택 표시가 붙는다 */
export function RadioCardItem(props: RadioCardItemProps): ReactNode {
  const { value, icon, title, description, disabled } = props;
  return (
    <ChoiceGroupItem
      value={value}
      icon={icon}
      title={title}
      description={description}
      disabled={disabled}
    />
  );
}
