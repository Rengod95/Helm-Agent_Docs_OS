import { Button, Input } from "@caustic/react";
import { CircleCheck } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { FORM_CONTROL_SIZE } from "./settings-section.tsx";

// 데이터 구역 "백업과 복원" 두 열 카드의 조각(DP-88 [결정: 2026-11-11 사용자]). 한 열 = 제목(13/500) + 정보 아이콘, 한 문장 설명,
// 폴더 줄(입력 + 고르기, 같은 28px), 바로 채우는 칩, 실행 단추, 진행과 결과. 백업 열과 복원 열이 같은 뼈대를 쓴다.
// 열 둘을 담는 틀은 `DataColumns`다(카드 안을 세로 선 하나로 나눈다. 좁으면 한 열).

export function DataColumns(props: { readonly children: ReactNode }): ReactNode {
  return (
    <div
      data-slot="data-columns"
      className="-m-4 grid grid-cols-2 @max-[34rem]:grid-cols-1 [&>*+*]:border-s [&>*+*]:border-border-subtle @max-[34rem]:[&>*+*]:border-s-0 @max-[34rem]:[&>*+*]:border-t"
    >
      {props.children}
    </div>
  );
}

export function DataColumn(props: {
  readonly slot: string;
  readonly title: string;
  readonly info: readonly string[];
  readonly infoLabel: string;
  readonly description: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div data-slot={props.slot} className="grid min-w-0 content-start gap-3 p-4">
      <div className="grid gap-0.5">
        <span className="inline-flex items-center gap-1">
          <span className="text-ui font-medium text-text-primary">{props.title}</span>
          <InfoTip text={props.info} label={props.infoLabel} />
        </span>
        <span className="text-ui text-text-tertiary">{props.description}</span>
      </div>
      {props.children}
    </div>
  );
}

/** 폴더 줄: 경로 입력(남는 폭) + 고르기 단추. 아래에 바로 채우는 칩(추천 폴더, 방금 만든 백업)이 붙는다 */
export function FolderField(props: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  /** 폴더 고르기 창. 없으면(웹) 단추가 없다 */
  readonly onPick?: (() => void) | undefined;
  /** 누르면 칸을 채우는 제안. 이름표와 채울 경로 */
  readonly suggestions?: readonly { readonly label: string; readonly path: string }[] | undefined;
  readonly invalid?: boolean | undefined;
}): ReactNode {
  const suggestions = (props.suggestions ?? []).filter((item) => item.path !== props.value.trim());
  return (
    <div className="grid gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <Input
          type="text"
          size={FORM_CONTROL_SIZE}
          aria-label={props.label}
          placeholder={props.placeholder}
          value={props.value}
          disabled={props.disabled}
          invalid={props.invalid === true}
          spellCheck={false}
          containerClassName="min-w-0 flex-1"
          onValueChange={props.onChange}
        />
        {props.onPick === undefined ? null : (
          <Button
            variant="outline"
            size={FORM_CONTROL_SIZE}
            disabled={props.disabled}
            onClick={props.onPick}
          >
            {t("desktop.workspace.pickFolderButton")}
          </Button>
        )}
      </div>
      {suggestions.length === 0 ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {suggestions.map((item) => (
            <Button
              key={item.path}
              variant="ghost"
              size="xs"
              disabled={props.disabled}
              title={item.path}
              onClick={() => {
                props.onChange(item.path);
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 끝난 일의 짧은 결과: 체크 아이콘 + 한 문장, 그 아래 경로(mono) 한 줄과 덧붙인 문장들 */
export function DoneLine(props: {
  readonly text: string;
  readonly path?: string | undefined;
  readonly notes?: readonly string[] | undefined;
}): ReactNode {
  return (
    <div role="status" data-slot="data-done" className="grid min-w-0 gap-1">
      <p className="m-0 flex items-start gap-1.5 text-ui text-text-primary">
        <CircleCheck aria-hidden className="mt-0.5 size-icon-sm flex-none text-success-text" />
        <span className="min-w-0">{props.text}</span>
      </p>
      {props.path === undefined ? null : (
        <p
          className="m-0 truncate ps-5 font-mono text-mono-sm text-text-tertiary"
          title={props.path}
        >
          {props.path}
        </p>
      )}
      {(props.notes ?? []).map((note) => (
        <p key={note} className="m-0 ps-5 text-ui text-text-secondary">
          {note}
        </p>
      ))}
    </div>
  );
}

/** 진행 중 한 줄: 막대 대신 문장(진행률을 모른다) */
export function RunningLine(props: { readonly text: string }): ReactNode {
  return (
    <p role="status" className="m-0 text-ui text-text-secondary">
      {props.text}
    </p>
  );
}
