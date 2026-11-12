import {
  Button,
  Chip,
  IconButton,
  Input,
  SegmentedControl,
  SegmentedControlItem,
} from "@caustic/react";
import { Lock, Plus, X } from "@caustic/react/icons";
import type { CSSProperties, ReactNode } from "react";
import { isCommitEnter } from "../../ime-enter.ts";
import { FIELD_WIDTH, FORM_CONTROL_SIZE, RowNote } from "../settings/settings-section.tsx";

// 판정 표(DP-109 [결정: 2026-11-11 사용자]). "대상 하나 = 판정 하나"를 고치는 앱 공용 표다. 권한 규칙(도구·패턴), 웹 접근(도메인),
// 신뢰한 폴더(폴더)가 같은 부품을 쓴다. 순수 표시 부품이고 값과 쓰기는 props다.
//   카드   surface.base, 1px border.subtle, 반경 12(설정 카드와 같다). 열은 CSS grid 하나라 머리·줄·추가 줄이 같은 열에 선다.
//   머리   32px, 열 이름 12/500 tertiary.
//   줄     44px(조작부 28 + 위아래 8), 줄 사이 1px. 대상은 mono 13, 판정은 SegmentedControl sm, 끝 칸은 지우기(줄 hover·초점에서만 보임).
//   추가 줄 표 맨 아래 같은 열에: 대상 입력 · 판정 · (덧칸) · "추가". Enter로도 더한다. 오류는 그 아래 RowNote.
//   빈 상태 줄 자리에 한 줄 안내와 예시 칩(누르면 추가 줄이 채워진다. 바로 저장하지 않는다).

export type Verdict = "allow" | "ask" | "deny";

export interface VerdictRow {
  /** 줄의 안정된 키(대상 글, 규칙 id, 경로) */
  readonly key: string;
  /** 대상 칸. 글이면 mono 13으로 그린다 */
  readonly subject: ReactNode;
  /** 대상 칸이 말줄임될 때 보일 전체 글 */
  readonly subjectTitle?: string | undefined;
  readonly verdict: Verdict;
  /** 판정 다음 덧칸들(`extraColumns`와 같은 수) */
  readonly cells?: readonly ReactNode[] | undefined;
  /** 줄 아래 경고 한 줄(겹침 등) */
  readonly note?: ReactNode | undefined;
  /** 판정을 바꿀 수 없는 줄(관리 범위). 판정 글과 잠금 아이콘으로 그린다 */
  readonly locked?: boolean | undefined;
  /** 지울 수 있는가. 기본 참(잠긴 줄은 지울 수 없다) */
  readonly removable?: boolean | undefined;
}

export interface VerdictExample {
  /** 칩 글(대상) */
  readonly subject: string;
  readonly verdict: Verdict;
}

interface VerdictAddRow {
  readonly subject: string;
  readonly placeholder: string;
  readonly verdict: Verdict;
  /** 덧칸 자리의 입력들(`extraColumns`와 같은 수) */
  readonly cells?: readonly ReactNode[] | undefined;
  readonly error: string | null;
  readonly onSubject: (text: string) => void;
  readonly onVerdict: (verdict: Verdict) => void;
  readonly onAdd: () => void;
}

export interface VerdictTableProps {
  /** 표의 접근성 이름 */
  readonly label: string;
  /** 대상 열 이름 */
  readonly subjectHeader: string;
  readonly verdictHeader: string;
  /**
   * 판정 다음 덧칸의 이름과 grid 트랙(예: `minmax(0,1fr)`, `6rem`). 칸이 ghost 입력이면 `inset`으로 머리 글을 입력 글과 같은
   * 자리(안쪽 12px)에 맞춘다
   */
  readonly extraColumns?:
    | readonly {
        readonly header: string;
        readonly track: string;
        readonly inset?: boolean | undefined;
      }[]
    | undefined;
  /** 고를 수 있는 판정(차례대로). 신뢰 폴더는 허용·막기 둘 */
  readonly choices: readonly Verdict[];
  readonly verdictLabel: (verdict: Verdict) => string;
  readonly rows: readonly VerdictRow[];
  readonly onVerdict: (key: string, verdict: Verdict) => void;
  /** 없으면 지우기 칸을 그리지 않는다 */
  readonly onRemove?: ((key: string) => void) | undefined;
  readonly removeLabel?: ((row: VerdictRow) => string) | undefined;
  /** 줄이 없을 때 한 줄 안내 */
  readonly emptyText: string;
  /** 빈 상태 예시 칩. 누르면 추가 줄을 채운다 */
  readonly examples?: readonly VerdictExample[] | undefined;
  readonly onExample?: ((example: VerdictExample) => void) | undefined;
  /** 없으면 추가 줄을 그리지 않는다 */
  readonly add?: VerdictAddRow | undefined;
  readonly addLabel?: string | undefined;
  readonly disabled?: boolean | undefined;
}

const CARD = "rounded-xl bg-surface-base shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]";

/**
 * 끝 칸 폭. 추가 줄의 "추가" 단추(아이콘 14 + 글 두 자 + 좌우 10)가 들어가는 고정 폭이다. 줄마다 따로 그리는 grid라
 * `auto`로 두면 줄마다 폭이 달라 열이 어긋난다. 몸 줄의 지우기 아이콘(28)은 이 칸 오른쪽 끝에 붙는다
 */
const END_TRACK = "4.5rem";

/**
 * 판정 칸 폭. 같은 까닭으로 고정 폭이다: SegmentedControl sm 한 칸이 대략 글 + 좌우 8이라 판정 셋(허용·물어보기·막기)은 9.25rem(실측 145px),
 * 둘(허용·막기)은 6.25rem이다. 영어 이름(Allow·Ask·Deny)은 더 짧다
 */
function verdictTrackOf(count: number): string {
  return count >= 3 ? "9.25rem" : "6.25rem";
}

/** 대상 칸 · 판정 칸 · 덧칸 · 끝 칸의 grid 트랙. 머리·줄·추가 줄이 저마다 grid라 모든 트랙이 내용과 무관한 폭이다 */
function columnsOf(props: VerdictTableProps): CSSProperties {
  const extras = (props.extraColumns ?? []).map((column) => column.track);
  const end = props.onRemove === undefined && props.add === undefined ? [] : [END_TRACK];
  return {
    gridTemplateColumns: [
      "minmax(0,1fr)",
      verdictTrackOf(props.choices.length),
      ...extras,
      ...end,
    ].join(" "),
  };
}

function VerdictControl(props: {
  readonly label: string;
  readonly value: Verdict;
  readonly choices: readonly Verdict[];
  readonly verdictLabel: (verdict: Verdict) => string;
  readonly disabled: boolean;
  readonly onChange: (verdict: Verdict) => void;
}): ReactNode {
  return (
    <SegmentedControl
      size={FORM_CONTROL_SIZE}
      aria-label={props.label}
      value={props.value}
      disabled={props.disabled}
      onValueChange={(next) => {
        const found = props.choices.find((choice) => choice === next);
        if (found !== undefined) props.onChange(found);
      }}
    >
      {props.choices.map((choice) => (
        <SegmentedControlItem key={choice} value={choice}>
          {props.verdictLabel(choice)}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

function Subject(props: { readonly row: VerdictRow }): ReactNode {
  const { row } = props;
  if (typeof row.subject !== "string") return <div className="min-w-0">{row.subject}</div>;
  return (
    <span
      title={row.subjectTitle ?? row.subject}
      className="block min-w-0 truncate font-mono text-mono text-text-primary"
    >
      {row.subject}
    </span>
  );
}

function BodyRow(props: {
  readonly table: VerdictTableProps;
  readonly row: VerdictRow;
  readonly columns: CSSProperties;
}): ReactNode {
  const { table, row } = props;
  const disabled = table.disabled === true;
  const removable = table.onRemove !== undefined && row.removable !== false && row.locked !== true;
  const hasEnd = table.onRemove !== undefined || table.add !== undefined;
  return (
    <div
      role="row"
      data-slot="verdict-row"
      data-verdict={row.verdict}
      className="group/vrow grid min-w-0 gap-1 px-4 py-2 transition-colors hover:bg-neutral-hover focus-within:bg-neutral-hover"
    >
      <div className="grid min-h-7 items-center gap-x-3" style={props.columns}>
        <div role="cell" className="min-w-0">
          <Subject row={row} />
        </div>
        <div role="cell" className="flex items-center">
          {row.locked === true ? (
            <span className="inline-flex items-center gap-1 text-ui text-text-secondary">
              <Lock aria-hidden className="size-icon-xs text-text-tertiary" />
              {table.verdictLabel(row.verdict)}
            </span>
          ) : (
            <VerdictControl
              label={table.verdictHeader}
              value={row.verdict}
              choices={table.choices}
              verdictLabel={table.verdictLabel}
              disabled={disabled}
              onChange={(next) => {
                table.onVerdict(row.key, next);
              }}
            />
          )}
        </div>
        {extraCellsOf(table, row.cells)}
        {hasEnd ? (
          <div role="cell" className="flex justify-end">
            {removable ? (
              <IconButton
                size={FORM_CONTROL_SIZE}
                variant="ghost"
                label={table.removeLabel?.(row) ?? ""}
                disabled={disabled}
                data-slot="verdict-remove"
                className="opacity-0 group-focus-within/vrow:opacity-100 group-hover/vrow:opacity-100 focus-visible:opacity-100"
                onClick={() => {
                  table.onRemove?.(row.key);
                }}
              >
                <X />
              </IconButton>
            ) : null}
          </div>
        ) : null}
      </div>
      {row.note === undefined || row.note === null ? null : (
        <div className="min-w-0">{row.note}</div>
      )}
    </div>
  );
}

function AddRow(props: {
  readonly table: VerdictTableProps;
  readonly add: VerdictAddRow;
  readonly columns: CSSProperties;
}): ReactNode {
  const { table, add } = props;
  const disabled = table.disabled === true;
  return (
    <div role="row" data-slot="verdict-add" className="grid min-w-0 gap-2 px-4 py-2">
      <div className="grid min-h-7 items-center gap-x-3" style={props.columns}>
        <div role="cell" className="min-w-0">
          <Input
            size={FORM_CONTROL_SIZE}
            containerClassName={FIELD_WIDTH.full}
            className="font-mono"
            aria-label={table.subjectHeader}
            placeholder={add.placeholder}
            value={add.subject}
            spellCheck={false}
            disabled={disabled}
            onValueChange={add.onSubject}
            onKeyDown={(event) => {
              if (isCommitEnter(event)) add.onAdd();
            }}
          />
        </div>
        <div role="cell" className="flex items-center">
          <VerdictControl
            label={table.verdictHeader}
            value={add.verdict}
            choices={table.choices}
            verdictLabel={table.verdictLabel}
            disabled={disabled}
            onChange={add.onVerdict}
          />
        </div>
        {extraCellsOf(table, add.cells)}
        <div role="cell" className="flex justify-end">
          <Button
            size={FORM_CONTROL_SIZE}
            variant="outline"
            disabled={disabled}
            onClick={add.onAdd}
          >
            <Plus aria-hidden />
            {table.addLabel}
          </Button>
        </div>
      </div>
      {add.error === null ? null : <RowNote tone="danger">{add.error}</RowNote>}
    </div>
  );
}

export function VerdictTable(props: VerdictTableProps): ReactNode {
  const columns = columnsOf(props);
  const extras = props.extraColumns ?? [];
  const hasEnd = props.onRemove !== undefined || props.add !== undefined;
  return (
    <div
      role="table"
      aria-label={props.label}
      aria-disabled={props.disabled === true ? true : undefined}
      data-slot="verdict-table"
      className={`grid min-w-0 overflow-hidden ${CARD} [&>*+*]:border-t [&>*+*]:border-border-subtle`}
    >
      <div role="row" className="grid h-8 items-center gap-x-3 px-4" style={columns}>
        <span role="columnheader" className="text-ui-sm font-medium text-text-tertiary">
          {props.subjectHeader}
        </span>
        <span role="columnheader" className="text-ui-sm font-medium text-text-tertiary">
          {props.verdictHeader}
        </span>
        {extras.map((column) => (
          <span
            role="columnheader"
            key={column.header}
            className={`text-ui-sm font-medium text-text-tertiary ${column.inset === true ? "ps-3" : ""}`}
          >
            {column.header}
          </span>
        ))}
        {hasEnd ? <span role="columnheader" aria-hidden /> : null}
      </div>
      {props.rows.length === 0 ? (
        <div role="row" data-slot="verdict-empty" className="grid gap-2 px-4 py-3">
          <p role="cell" className="m-0 text-ui text-text-tertiary">
            {props.emptyText}
          </p>
          {props.examples === undefined || props.examples.length === 0 ? null : (
            <div className="flex flex-wrap gap-1.5">
              {props.examples.map((example) => (
                <Chip
                  key={`${example.subject}:${example.verdict}`}
                  size="sm"
                  variant="outline"
                  disabled={props.disabled === true}
                  onClick={() => {
                    props.onExample?.(example);
                  }}
                >
                  <span className="font-mono">{example.subject}</span>
                  <span className="text-text-tertiary">{props.verdictLabel(example.verdict)}</span>
                </Chip>
              ))}
            </div>
          )}
        </div>
      ) : (
        props.rows.map((row) => <BodyRow key={row.key} table={props} row={row} columns={columns} />)
      )}
      {props.add === undefined ? null : <AddRow table={props} add={props.add} columns={columns} />}
    </div>
  );
}

/** 덧칸들. 열 이름이 칸의 키다(열 수와 칸 수가 같다) */
function extraCellsOf(
  table: VerdictTableProps,
  cells: readonly ReactNode[] | undefined,
): ReactNode {
  return (table.extraColumns ?? []).map((column, index) => (
    <div role="cell" key={column.header} className="min-w-0">
      {cells?.[index] ?? null}
    </div>
  ));
}
