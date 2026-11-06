import { Chip } from "@caustic/react";
import { LocalizedTagInput } from "../../localized-tag-input.tsx";
import type { ReactNode } from "react";
import type { SettingKey } from "@fresnel/contracts/settings";
import { optionLabelOf, optionOf, optionTextOf } from "./settings-model.ts";

// 목록 칸. 열거형 원소(`options`가 있는 목록)는 TagInput이 값 글자를 그대로 보여 주므로(표시 라벨 prop이 없다) 선택지마다 토글 칩 하나를
// 그린다. 칩 글은 `optionLabelOf`(`settings.<키>.option.<값>` 카탈로그)이고 켠 순서가 값의 순서다. 자유 입력 목록은 TagInput 그대로다.

export function SettingTagList(props: {
  readonly settingKey: SettingKey;
  readonly label: string;
  readonly value: readonly string[];
  readonly options: readonly (string | number)[] | null;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly onChange: (next: readonly string[]) => void;
}): ReactNode {
  const { settingKey, options, value, onChange } = props;
  if (options === null) {
    return (
      <LocalizedTagInput
        aria-label={props.label}
        containerClassName="max-w-[28rem]"
        value={[...value]}
        disabled={props.disabled}
        invalid={props.invalid}
        onValueChange={(next) => {
          onChange(next);
        }}
      />
    );
  }
  return (
    <div role="group" aria-label={props.label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const text = optionTextOf(option);
        const on = value.includes(text);
        return (
          <Chip
            key={text}
            size="sm"
            pressed={on}
            disabled={props.disabled}
            onPressedChange={(next) => {
              const known = optionOf(options, text);
              if (known === null) return;
              onChange(next ? [...value, text] : value.filter((item) => item !== text));
            }}
          >
            {optionLabelOf(settingKey, option)}
          </Chip>
        );
      })}
    </div>
  );
}
