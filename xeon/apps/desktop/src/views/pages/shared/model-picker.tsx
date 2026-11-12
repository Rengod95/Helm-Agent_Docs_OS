import { Combobox, type ComboboxGroupData } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { ModelEntry } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import {
  modelLabelOf,
  modelOptionsOf,
  priceNumberText,
  tokenCountText,
  type ModelOption,
} from "../../model-usage.ts";
import { FIELD_WIDTH, FORM_CONTROL_SIZE } from "../settings/settings-section.tsx";
import { providerNameOf, providerOfRef } from "./provider-names.ts";

// 모델 고르기(L4.desktop-ux DP-84 [결정: 2026-11-11 사용자]). 입력창 모델 select와 같은 줄 자료(`modelOptionsOf`: 호스트 카탈로그,
// 날짜 사본 감춤, 제공자순·새 버전순, 카탈로그 밖의 지금 값)를 caustic `Combobox popup`으로 그린다. 제공자 묶음 머리 아래 줄마다
// 이름과 곁 정보(문맥 창 · 100만 토큰당 입력/출력 가격)다. 트리거는 폼 크기(28px)와 보통 폭(224px)이다.

/** 줄 끝 곁 정보: "200K · $3/$15". 문맥 창이나 가격을 모르면 아는 것만, 둘 다 모르면 null */
export function modelMetaText(option: ModelOption): string | null {
  const parts: string[] = [];
  if (option.contextWindow !== null) parts.push(tokenCountText(option.contextWindow));
  if (option.price !== null && option.price !== "unknown") {
    parts.push(`$${priceNumberText(option.price.input)}/$${priceNumberText(option.price.output)}`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

/** 고르기의 묶음: 제공자마다 하나, 줄 순서는 `modelOptionsOf`를 따른다 */
function modelPickerGroupsOf(
  choices: readonly ModelEntry[],
  current: string | null,
): readonly { readonly provider: string; readonly options: readonly ModelOption[] }[] {
  const groups: { provider: string; options: ModelOption[] }[] = [];
  for (const option of modelOptionsOf(choices, current, null)) {
    const provider = providerOfRef(option.value);
    const group = groups.find((found) => found.provider === provider);
    if (group === undefined) groups.push({ provider, options: [option] });
    else group.options.push(option);
  }
  return groups;
}

export interface ModelPickerProps {
  /** 지금 값(모델 참조). 없으면 null */
  readonly value: string | null;
  readonly choices: readonly ModelEntry[];
  readonly label: string;
  readonly disabled?: boolean | undefined;
  /** 값이 없을 때 트리거 글 */
  readonly placeholder?: string | undefined;
  readonly onChange: (ref: string) => void;
}

/** 닫힌 고르기 단추 안의 글. 목록에 없는 값(꺼진 제공자의 모델)도 이름을 보이고, 비었으면 자리 글 */
function triggerOf(
  label: ReactNode | undefined,
  value: string | null,
  placeholder: string | null,
): ReactNode {
  return (
    <span className="block min-w-0 flex-1 truncate text-start">
      {label !== undefined ? (
        label
      ) : value !== null ? (
        modelLabelOf(value)
      ) : (
        <span className="text-text-tertiary">
          {placeholder ?? t("desktop.modelPicker.placeholder")}
        </span>
      )}
    </span>
  );
}

export function ModelPicker(props: ModelPickerProps): ReactNode {
  const groups: ComboboxGroupData[] = modelPickerGroupsOf(props.choices, props.value).map(
    (group) => ({
      label: providerNameOf(group.provider),
      options: group.options.map((option) => {
        const meta = modelMetaText(option);
        return {
          value: option.value,
          label: option.label,
          ...(meta === null
            ? {}
            : {
                meta: (
                  <span className="font-mono text-mono-sm text-text-tertiary tabular-nums">
                    {meta}
                  </span>
                ),
              }),
        };
      }),
    }),
  );
  const empty = groups.length === 0;
  return (
    <Combobox
      mode="popup"
      size={FORM_CONTROL_SIZE}
      aria-label={props.label}
      popupLabel={props.label}
      searchLabel={t("desktop.modelPicker.search")}
      listLabel={props.label}
      groups={groups}
      popupWidth="lg"
      className={FIELD_WIDTH.medium}
      {...(props.value === null ? {} : { value: props.value })}
      disabled={props.disabled === true || empty}
      emptyMessage={t("desktop.modelPicker.empty")}
      triggerContent={(option) => triggerOf(option?.label, props.value, props.placeholder ?? null)}
      onValueChange={(next) => {
        if (next !== props.value) props.onChange(next);
      }}
    />
  );
}
