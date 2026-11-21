import { Input } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { FieldVM, WidgetVM } from "@fresnel/client/settings";
import { useState, type ReactNode } from "react";
import { numberValueOf, type FieldHandlers } from "./settings-model.ts";
import {
  parseQuantity,
  rangeTextOf,
  quantityTextOf,
  type QuantitySuffix,
  type QuantityUnit,
} from "./settings-quantity.ts";
import { isCommitEnter } from "../../ime-enter.ts";
import { FIELD_WIDTH, FORM_CONTROL_SIZE } from "./settings-section.tsx";

// 단위가 붙은 숫자 칸(L4.settings-ui §4.2.1 숫자 [결정: 2026-11-11 사용자]). ± 단추가 없다. 칸 안 글은 값의 크기에 맞는 단위로
// 줄여 보이고(200K, 25, 1) 오른쪽 접미사가 단위다(토큰, MB, 분). "1.5M", "512KB", "90s", "10분"처럼 단위를 붙여 칠 수 있다.
// 친 글이 읽히고 범위 안이면 초안으로 알리고, 칸을 떠나거나 Enter를 누르면 저장한다. Esc는 원래 값으로 되돌린다.

const SUFFIX_TEXT: Readonly<Record<Exclude<QuantitySuffix, "B" | "KB" | "MB" | "GB">, MessageId>> =
  {
    tokens: "desktop.settings.unit.tokens",
    chars: "desktop.settings.unit.chars",
    count: "desktop.settings.unit.count",
    days: "desktop.settings.unit.days",
    seconds: "desktop.settings.unit.seconds",
    minutes: "desktop.settings.unit.minutes",
    hours: "desktop.settings.unit.hours",
  };

/** 접미사 글. 바이트 단위는 기호 그대로다 */
function suffixTextOf(suffix: QuantitySuffix): string {
  if (suffix === "B" || suffix === "KB" || suffix === "MB" || suffix === "GB") return suffix;
  return t(SUFFIX_TEXT[suffix]);
}

type Check =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly message: string };

function checkOf(
  text: string,
  unit: QuantityUnit,
  shown: QuantitySuffix,
  zeroIsNone: boolean,
  widget: Extract<WidgetVM, { readonly kind: "number" }>,
): Check {
  const parsed = parseQuantity(text, unit, shown, zeroIsNone);
  if (!parsed.ok) return { ok: false, message: t("desktop.settings.field.quantity.syntax") };
  const value = parsed.value;
  const below = widget.min !== null && value < widget.min && !(zeroIsNone && value === 0);
  const above = widget.max !== null && value > widget.max;
  return below || above ? { ok: false, message: rangeTextOf(widget) } : { ok: true, value };
}

export function QuantityControl(props: {
  readonly field: FieldVM;
  readonly widget: Extract<WidgetVM, { readonly kind: "number" }>;
  readonly unit: QuantityUnit;
  readonly zeroIsNone: boolean;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const { field, widget, unit, zeroIsNone, handlers } = props;
  const value = numberValueOf(field.value) ?? 0;
  const shown = quantityTextOf(value, unit, zeroIsNone);
  // 치는 동안의 글과 그때 보이던 접미사. 접미사는 치기 시작할 때 묶는다(값이 바뀌어 단위가 바뀌어도 친 글은 그 단위로 읽는다).
  // null이면 값에서 만든 글을 보인다(칸을 떠나면 다시 null)
  const [draft, setDraft] = useState<{
    readonly text: string;
    readonly suffix: QuantitySuffix;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const text = draft?.text ?? shown.text;
  const suffix = draft?.suffix ?? shown.suffix;
  const finish = (): void => {
    if (draft === null) return;
    const check = checkOf(draft.text, unit, draft.suffix, zeroIsNone, widget);
    if (!check.ok) return;
    setDraft(null);
    setMessage(null);
    if (field.dirty || check.value !== value) handlers.change(field.key, check.value);
  };
  return (
    <span className="grid justify-items-end gap-1">
      <Input
        size={FORM_CONTROL_SIZE}
        inputMode="decimal"
        aria-label={field.label}
        containerClassName={FIELD_WIDTH.short}
        className="text-end"
        value={text}
        placeholder={zeroIsNone ? t("desktop.settings.field.quantity.none") : undefined}
        suffix={<span className="text-ui text-text-tertiary">{suffixTextOf(suffix)}</span>}
        disabled={props.disabled}
        invalid={props.invalid || message !== null}
        spellCheck={false}
        onValueChange={(next) => {
          setDraft({ text: next, suffix });
          const check = checkOf(next, unit, suffix, zeroIsNone, widget);
          setMessage(check.ok ? null : check.message);
          if (check.ok) handlers.edit(field.key, check.value);
        }}
        onBlur={finish}
        onKeyDown={(event) => {
          if (isCommitEnter(event)) {
            event.preventDefault();
            finish();
          } else if (event.key === "Escape" && draft !== null) {
            event.preventDefault();
            setDraft(null);
            setMessage(null);
            handlers.discard(field.key);
          }
        }}
      />
      {message === null ? null : (
        <span role="alert" className="text-ui text-danger-text">
          {message}
        </span>
      )}
    </span>
  );
}
