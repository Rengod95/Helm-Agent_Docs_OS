import { Button, ComboboxRow, Menu, MenuItem, MenuSeparator } from "@caustic/react";
import { Check, FolderOpen, LockOpen, Pencil, RotateCcw, Shield } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ModelThinkingLevel } from "@fresnel/contracts/conversation";
import { THINKING_LEVELS, type PermissionMode } from "@fresnel/contracts/services";
import type { ModelEntry } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { modelKeyOf } from "./denied-model-model.ts";
import { modelOptionsOf } from "./model-usage.ts";
import { ModelPicker } from "./pages/shared/model-picker.tsx";
import {
  permissionModeOptionsOf,
  permissionModeToneOf,
  type PermissionChipView,
} from "./permission-mode-model.ts";
import { THINKING_LEVEL_LABEL_IDS, thinkingLevelOf } from "./thinking-level-model.ts";

// 입력창 아래 칩 셋(L4.desktop-ux DP-101 [결정: 2026-11-11 사용자]): 권한 모드, 모델, 추론 수준.
// 칩은 폼 표준의 sm 단추(높이 28, DP-132 [결정: 2026-11-12 사용자] "한 스케일 낮게")를 ghost로 쓰고, 글은 13 보통 굵기 tertiary,
// 좌우 8, 앞 아이콘 14와 글 사이 4다. chevron·배경·테두리 없이 hover만 `neutral.hover`. 칩 글은 이름만 짧게 둔다(모델 가격·문맥 창, 모드 설명은 열리는 목록 안).
// 아이콘: 권한 모드만 둔다. 모드는 도구가 묻지 않고 실행되는지를 정하는 상태라 글만으로는 한눈에 구분되지 않고(특히 모두 허용의 위험 색과 함께),
// 모델·추론 수준은 이름 자체가 값이라 아이콘이 정보를 더하지 않는다(사용자: 추론 수준 아이콘 제거).

/** 세 칩이 같은 클래스를 쓴다. 높이는 `size="sm"`(28)이 정한다 */
const COMPOSER_CHIP_CLASS =
  "min-w-0 gap-1 px-2 font-normal text-text-tertiary hover:bg-neutral-hover hover:text-text-secondary [&_svg]:size-3.5 [&_svg]:shrink-0";

/** 모드마다 앞 아이콘 14 */
function modeIcon(mode: PermissionMode): ReactNode {
  switch (mode) {
    case "default":
      return <Shield aria-hidden />;
    case "acceptEdits":
      return <Pencil aria-hidden />;
    case "bypass":
      return <LockOpen aria-hidden />;
    default:
      return assertNever(mode, "PermissionMode");
  }
}

/** 칩에 보이는 짧은 이름 */
const MODE_CHIP_ID: Readonly<Record<PermissionMode, MessageId>> = {
  default: "desktop.composer.mode.default",
  acceptEdits: "desktop.composer.mode.acceptEdits",
  bypass: "desktop.composer.mode.bypass",
};

/** 메뉴 줄의 한 줄 설명 */
const MODE_HINT_ID: Readonly<Record<PermissionMode, MessageId>> = {
  default: "desktop.composer.mode.default.hint",
  acceptEdits: "desktop.composer.mode.acceptEdits.hint",
  bypass: "desktop.composer.mode.bypass.hint",
};

export function permissionModeChipText(mode: PermissionMode): string {
  return t(MODE_CHIP_ID[mode]);
}

/** 메뉴 줄 안: 이름(13) 아래 설명(12 tertiary). 설명은 자르지 않고 줄을 바꾼다 */
function MenuText(props: { readonly title: string; readonly hint: string }): ReactNode {
  return (
    <span className="grid min-w-0 gap-0.5 py-0.5 text-start">
      <span className="truncate">{props.title}</span>
      <span className="text-ui-sm text-text-tertiary">{props.hint}</span>
    </span>
  );
}

/**
 * 권한 모드 칩. 메뉴는 묻기, 편집 자동 허용, 그리고 허락되면 모두 허용(`permissionModeOptionsOf`). 모두 허용은 위험 색이다.
 * `writeAccess`(이 대화에서 샌드박스 밖 쓰기를 계속 허용함, DP-205)면 모드 이름 뒤에 폴더 아이콘 14(사이 4)를 붙이고,
 * 메뉴 맨 아래 구분선 뒤에 누를 수 없는 설명 줄(12 tertiary)을 둔다. 철회 동작은 없다(엔진에 방법이 없다).
 * 칩 자리는 늘 있다(DP-213): `mode`가 null이면 읽는 중이라 "승인 모드" 글의 비활성 칩이고, `note`가 있으면(읽기 실패, 모르는 값)
 * 기본 모드 글에 점선 밑줄을 긋고 이유를 툴팁(title)과 메뉴 맨 위 설명 줄로 말한다. 그때는 메뉴의 어느 모드도 골라져 있지 않고, 실패면 "다시 읽기"가 있다
 */
export function PermissionModeChip(props: {
  readonly mode: PermissionMode | null;
  readonly bypassAllowed: boolean;
  readonly disabled: boolean;
  readonly writeAccess?: boolean;
  readonly note?: PermissionChipView["note"];
  readonly onRetry?: () => void;
  readonly onChange: (mode: PermissionMode) => void;
}): ReactNode {
  const { mode } = props;
  if (mode === null) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled
        aria-busy
        data-composer-chip="mode"
        data-state="loading"
        aria-label={t("desktop.composer.approvalMode.loading")}
        className={COMPOSER_CHIP_CLASS}
      >
        <Shield aria-hidden />
        <span className="truncate">{t("desktop.composer.mode.loading")}</span>
      </Button>
    );
  }
  const note =
    props.note === undefined || props.note === null
      ? null
      : t(props.note.id, props.note.value === undefined ? undefined : { value: props.note.value });
  const writeAccess = props.writeAccess === true;
  const chipLabel = `${t("desktop.composer.approvalMode.label")}: ${permissionModeChipText(mode)}`;
  const danger = note === null && permissionModeToneOf(mode) === "danger";
  const label = [chipLabel, writeAccess ? t("desktop.composer.writeAccess.label") : null, note]
    .filter((part) => part !== null)
    .join(", ");
  return (
    <Menu
      size="sm"
      side="top"
      align="end"
      aria-label={t("desktop.composer.approvalMode.label")}
      className="w-80"
      trigger={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={props.disabled}
          data-composer-chip="mode"
          data-state={note === null ? "ready" : "unsure"}
          aria-label={label}
          title={note ?? undefined}
          className={`${COMPOSER_CHIP_CLASS} ${danger ? "text-danger-text hover:text-danger-text" : ""}`}
        >
          {modeIcon(mode)}
          <span
            className={
              note === null
                ? "truncate"
                : "truncate underline decoration-dotted decoration-1 underline-offset-4"
            }
          >
            {permissionModeChipText(mode)}
          </span>
          {writeAccess ? <FolderOpen aria-hidden data-slot="write-access-mark" /> : null}
        </Button>
      }
    >
      {note === null ? null : (
        <>
          <p
            data-slot="mode-note"
            className="m-0 px-2 py-1.5 text-ui-sm text-text-secondary [overflow-wrap:anywhere]"
          >
            {note}
          </p>
          {props.onRetry === undefined ||
          props.note?.id !== "desktop.composer.approvalMode.failed" ? null : (
            <MenuItem
              icon={<RotateCcw aria-hidden />}
              onSelect={() => {
                props.onRetry?.();
              }}
            >
              {t("desktop.composer.approvalMode.retry")}
            </MenuItem>
          )}
          <MenuSeparator />
        </>
      )}
      {permissionModeOptionsOf(mode, props.bypassAllowed).map((option) => {
        const selected = note === null && option.selected;
        return (
          <MenuItem
            key={option.mode}
            role="menuitemradio"
            selected={selected}
            tone={option.mode === "bypass" ? "danger" : "neutral"}
            className="h-auto min-h-control-md items-start py-1.5 [&>[data-slot=menu-icon]]:pt-0.5 [&>[data-slot=menu-label]]:whitespace-normal"
            icon={modeIcon(option.mode)}
            end={selected ? <Check aria-hidden className="size-3.5" /> : undefined}
            onSelect={() => {
              if (!selected) props.onChange(option.mode);
            }}
          >
            <MenuText
              title={permissionModeChipText(option.mode)}
              hint={t(MODE_HINT_ID[option.mode])}
            />
          </MenuItem>
        );
      })}
      {writeAccess ? (
        <>
          <MenuSeparator />
          <p
            data-slot="write-access-note"
            className="m-0 flex items-start gap-2 px-2 py-1.5 text-ui-sm text-text-tertiary [&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0"
          >
            <FolderOpen aria-hidden />
            {t("desktop.composer.writeAccess.note")}
          </p>
        </>
      ) : null}
    </Menu>
  );
}

/** 칩에 보이는 모델 이름: 카탈로그 이름(없으면 참조의 모델 부분) */
export function modelChipText(choices: readonly ModelEntry[], ref: string): string {
  const option = modelOptionsOf(choices, ref, null).find((found) => found.value === ref);
  return option?.label ?? ref.slice(ref.indexOf("/") + 1);
}

/**
 * 모델 칩. 이름만 보이고, 누르면 공용 모델 고르기(`ModelPicker`: 검색, 제공자 묶음, 문맥 창·가격 곁 정보, 403 꼬리표)가 위로 열린다.
 * 대화가 모델을 정했으면 목록 아래 "기본 모델로 되돌리기" 줄이 있다
 */
export function ModelChip(props: {
  /** 지금 쓰는 모델 참조(대화가 정한 모델, 없으면 기본 모델) */
  readonly current: string;
  /** 대화가 모델을 정했는가 */
  readonly chosen: boolean;
  /** 기본 모델. 모르면 null */
  readonly fallback: string | null;
  readonly choices: readonly ModelEntry[];
  readonly disabled: boolean;
  /** 403으로 실패한 모델의 키(`provider/modelId`) */
  readonly denied: Readonly<Record<string, true>>;
  /** 모델 참조를 고르면 그 값, 기본 모델로 돌아가면 null */
  readonly onChange: (model: string | null) => void;
}): ReactNode {
  const text = modelChipText(props.choices, props.current);
  const deniedOf = (ref: string): boolean => {
    const key = modelKeyOf(ref);
    return key !== null && props.denied[key] === true;
  };
  return (
    <ModelPicker
      value={props.current}
      choices={props.choices}
      label={t("desktop.composer.model.label")}
      disabled={props.disabled}
      isDenied={deniedOf}
      onChange={(ref) => {
        props.onChange(ref);
      }}
      trigger={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={props.disabled}
          data-composer-chip="model"
          aria-label={`${t("desktop.composer.model.label")}: ${text}`}
          title={text}
          className={`${COMPOSER_CHIP_CLASS} max-w-48 shrink`}
        >
          <span className="truncate">{text}</span>
        </Button>
      }
      footer={
        props.chosen && props.fallback !== null ? (
          <ComboboxRow
            leading={<RotateCcw aria-hidden className="size-3.5" />}
            onSelect={() => {
              props.onChange(null);
            }}
          >
            {t("desktop.composer.model.useDefault", {
              model: modelChipText(props.choices, props.fallback),
            })}
          </ComboboxRow>
        ) : undefined
      }
    />
  );
}

/** 생각 수준 칩. 값은 이 대화의 `l1.models.thinkingLevel`(대화 범위, 다음 turn부터)이다 */
export function ThinkingChip(props: {
  readonly level: ModelThinkingLevel;
  readonly disabled: boolean;
  readonly onChange: (level: ModelThinkingLevel) => void;
}): ReactNode {
  const text = t(THINKING_LEVEL_LABEL_IDS[props.level]);
  return (
    <Menu
      size="sm"
      side="top"
      align="end"
      aria-label={t("desktop.composer.thinking.label")}
      className="w-44"
      trigger={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={props.disabled}
          data-composer-chip="thinking"
          aria-label={`${t("desktop.composer.thinking.label")}: ${text}`}
          className={COMPOSER_CHIP_CLASS}
        >
          <span className="truncate">{text}</span>
        </Button>
      }
    >
      {THINKING_LEVELS.map((level) => (
        <MenuItem
          key={level}
          role="menuitemradio"
          selected={level === props.level}
          end={level === props.level ? <Check aria-hidden className="size-3.5" /> : undefined}
          onSelect={() => {
            const next = thinkingLevelOf(level);
            if (next !== null && next !== props.level) props.onChange(next);
          }}
        >
          {t(THINKING_LEVEL_LABEL_IDS[level])}
        </MenuItem>
      ))}
    </Menu>
  );
}
