import { Select, SelectOption } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { FieldVM, WidgetVM } from "@fresnel/client/settings";
import type { SettingKey } from "@fresnel/contracts/settings";
import { useState, type ReactNode } from "react";
import { numberValueOf, type FieldHandlers } from "./settings-model.ts";
import { QuantityControl } from "./settings-quantity-field.tsx";
import type { QuantityUnit } from "./settings-quantity.ts";
import { FIELD_WIDTH, FORM_CONTROL_SIZE } from "./settings-section.tsx";

// 항목 줄의 조작부 모양을 키로 고르는 표(DP-86~89 [결정: 2026-11-11 사용자]). 값의 형만으로 고르던 것(select, 숫자 칸)을
// 내용에 맞게 바꾸는 키만 여기에 적는다. 표에 없는 키는 `settings-field.tsx`의 기본 모양 그대로다.
//   - SEGMENTED_KEYS: 이름이 짧은 선택지 2~4개 → segmented sm(드롭다운으로 숨기지 않는다)
//   - PRESET_OF_KEY:  "제한 없음 / 30일 / 90일 / 1년 / 직접 입력"처럼 흔한 값을 고르고, 직접 입력일 때만 단위 칸을 붙인다
//   - PLACEHOLDER_OF_KEY: 빈 글 칸의 자리표시(비워 두면 무엇이 쓰이는지)

/** 선택지가 4개 이하이면 segmented로 그리는 키 */
export const SEGMENTED_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
  "l4.desktop.window.closeBehavior",
  "l0.process.lockFallback.default",
  "l2.schedule.entries.directCreate",
  "l0.os.log.level",
  // 권한·샌드박스·MCP(DP-109~111)
  "l0.sandbox.onUnavailable",
  "l2.web.policy.unseenUrl",
  "x.loading-trust.defaultProjectTrust",
  "l2.mcp.approvalMode",
  // gitleaks generic-api-key가 이 키 이름과 다음 줄을 비밀 값으로 읽어 목록 끝에 둔다(오탐)
  "l0.sandbox.credentialFiles",
]);

/** segmented로 그릴 선택지 수의 상한 */
export const SEGMENTED_MAX = 4;

/** 빈 칸의 자리표시. 셸 경로는 엔진 기본(`platform-exec` `bashConfig`)이 /bin/bash다. 환경 변수 목록은 이름만 받는다 */
export const PLACEHOLDER_OF_KEY: ReadonlyMap<SettingKey, MessageId> = new Map<
  SettingKey,
  MessageId
>([
  ["l0.exec.shell", "desktop.settings.field.shell.placeholder"],
  // 값은 이름=값이 아니라 넘길 변수의 이름 목록이다(l0.exec.envAllowlist.extra)
  ["l0.exec.envAllowlist.extra", "desktop.settings.field.envAllowlist.placeholder"],
]);

interface Preset {
  readonly value: number;
  readonly label: MessageId;
}

/** 고르기 값이 있는 숫자 키. 0은 "제한 없음"이다(`settings-quantity.ts` ZERO_IS_NONE) */
export const PRESET_OF_KEY: ReadonlyMap<SettingKey, readonly Preset[]> = new Map<
  SettingKey,
  readonly Preset[]
>([
  [
    "l1.persistence.retention.maxAgeDays",
    [
      { value: 0, label: "desktop.settings.preset.none" },
      { value: 30, label: "desktop.settings.preset.days30" },
      { value: 90, label: "desktop.settings.preset.days90" },
      { value: 365, label: "desktop.settings.preset.year1" },
    ],
  ],
  [
    "l1.persistence.retention.maxCount",
    [
      { value: 0, label: "desktop.settings.preset.none" },
      { value: 100, label: "desktop.settings.preset.count100" },
      { value: 500, label: "desktop.settings.preset.count500" },
      { value: 1000, label: "desktop.settings.preset.count1000" },
    ],
  ],
]);

const CUSTOM = "custom";

/**
 * 고르기 + 직접 입력. 값이 고르기 값 가운데 하나면 select만 보이고, "직접 입력"을 고르거나 값이 고르기 밖이면 select 옆(8px)에
 * 단위 칸(96, `QuantityControl`)이 같은 줄에 붙는다. 고르기는 고르는 즉시 저장한다.
 */
export function PresetQuantity(props: {
  readonly field: FieldVM;
  readonly widget: Extract<WidgetVM, { readonly kind: "number" }>;
  readonly presets: readonly Preset[];
  readonly unit: QuantityUnit;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const { field, presets, handlers } = props;
  const value = numberValueOf(field.value) ?? 0;
  const known = presets.some((preset) => preset.value === value);
  const [custom, setCustom] = useState(!known);
  const showCustom = custom || !known;
  return (
    <span data-slot="preset-quantity" className="flex items-start gap-2">
      <Select
        size={FORM_CONTROL_SIZE}
        aria-label={field.label}
        value={showCustom ? CUSTOM : String(value)}
        disabled={props.disabled}
        className={FIELD_WIDTH.medium}
        onValueChange={(next) => {
          if (next === CUSTOM) {
            setCustom(true);
            return;
          }
          const preset = presets.find((candidate) => String(candidate.value) === next);
          if (preset === undefined) return;
          setCustom(false);
          handlers.change(field.key, preset.value);
        }}
      >
        {presets.map((preset) => (
          <SelectOption key={preset.value} value={String(preset.value)}>
            {t(preset.label)}
          </SelectOption>
        ))}
        <SelectOption value={CUSTOM}>{t("desktop.settings.preset.custom")}</SelectOption>
      </Select>
      {showCustom ? (
        <QuantityControl
          field={field}
          widget={props.widget}
          unit={props.unit}
          zeroIsNone
          disabled={props.disabled}
          invalid={props.invalid}
          handlers={handlers}
        />
      ) : null}
    </span>
  );
}
