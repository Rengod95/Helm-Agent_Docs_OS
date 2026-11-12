import { Button, IconButton, Input } from "@caustic/react";
import { FolderOpen, Plus, X } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { isCommitEnter } from "../../ime-enter.ts";
import { FIELD_WIDTH, FORM_CONTROL_SIZE, RowNote } from "../settings/settings-section.tsx";

// 목록 편집기(DP-110 [결정: 2026-11-11 사용자]). 글 값 여러 개(경로, 도메인)를 고치는 앱 공용 부품이다. 샌드박스의 쓰기 폴더·보호 경로·
// 막을 도메인, 스킬 경로가 같은 모양을 쓴다(입력+추가와 태그 입력이 섞이지 않게). 순수 표시 부품이고 값과 쓰기는 props다.
//   목록 상자 1px border.subtle, 반경 8. 값 줄 36px = 값(mono 12) + 지우기(ghost 28, 줄 hover·초점에서만 보임), 줄 사이 1px.
//   빈 상자  한 줄 안내(13 tertiary).
//   추가 줄  상자 아래 8px: 입력(28, 전폭) · [폴더 고르기](경로일 때) · [추가]. 모두 28px. Enter로도 더한다. 검사 실패는 그 아래 RowNote.

export interface ListEditorProps {
  /** 목록의 접근성 이름 */
  readonly label: string;
  readonly items: readonly string[];
  readonly emptyText: string;
  readonly draft: string;
  readonly placeholder: string;
  readonly error: string | null;
  readonly disabled?: boolean | undefined;
  readonly onDraft: (text: string) => void;
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
  readonly removeLabel: (item: string) => string;
  readonly addLabel: string;
  /** 주면 "폴더 고르기" 단추가 생긴다. 고른 경로는 부르는 쪽이 넣는다 */
  readonly onPick?: (() => void) | undefined;
  readonly pickLabel?: string | undefined;
}

export function ListEditor(props: ListEditorProps): ReactNode {
  const disabled = props.disabled === true;
  return (
    <div data-slot="list-editor" className="grid min-w-0 gap-2">
      <ul
        aria-label={props.label}
        className="m-0 grid min-w-0 list-none overflow-hidden rounded-lg p-0 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] [&>*+*]:border-t [&>*+*]:border-border-subtle"
      >
        {props.items.length === 0 ? (
          <li className="flex min-h-9 items-center px-3 text-ui text-text-tertiary">
            {props.emptyText}
          </li>
        ) : (
          props.items.map((item, index) => (
            <li
              key={item}
              data-slot="list-editor-item"
              className="group/litem flex min-h-9 min-w-0 items-center gap-2 ps-3 pe-1 transition-colors hover:bg-neutral-hover focus-within:bg-neutral-hover"
            >
              <span
                title={item}
                className="min-w-0 flex-1 truncate font-mono text-mono text-text-primary"
              >
                {item}
              </span>
              <IconButton
                size={FORM_CONTROL_SIZE}
                variant="ghost"
                label={props.removeLabel(item)}
                disabled={disabled}
                className="opacity-0 group-focus-within/litem:opacity-100 group-hover/litem:opacity-100 focus-visible:opacity-100"
                onClick={() => {
                  props.onRemove(index);
                }}
              >
                <X />
              </IconButton>
            </li>
          ))
        )}
      </ul>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          size={FORM_CONTROL_SIZE}
          containerClassName={FIELD_WIDTH.full}
          className="font-mono"
          aria-label={props.placeholder}
          placeholder={props.placeholder}
          value={props.draft}
          spellCheck={false}
          disabled={disabled}
          onValueChange={props.onDraft}
          onKeyDown={(event) => {
            if (isCommitEnter(event)) props.onAdd();
          }}
        />
        {props.onPick === undefined ? null : (
          <Button
            size={FORM_CONTROL_SIZE}
            variant="outline"
            disabled={disabled}
            onClick={props.onPick}
          >
            <FolderOpen aria-hidden />
            {props.pickLabel}
          </Button>
        )}
        <Button
          size={FORM_CONTROL_SIZE}
          variant="outline"
          disabled={disabled}
          onClick={props.onAdd}
        >
          <Plus aria-hidden />
          {props.addLabel}
        </Button>
      </div>
      {props.error === null ? null : <RowNote tone="danger">{props.error}</RowNote>}
    </div>
  );
}
