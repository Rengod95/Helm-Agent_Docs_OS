// 테스트 화면(P-19)의 그림. 상태와 명령은 없고 props와 핸들러만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 목록 상태(읽는 중, 빈 목록, 오프라인, 오류)를 먼저 가리고, 값이 있으면 caustic `Table`로 그린다. 고른 행의 상세는 목록 아래에 펼친다.
import { t } from "@fresnel/client/i18n";
import {
  replayVerdictOf,
  type TabRead,
  type TestFilter,
  type TestKindFilter,
  type TestRowVM,
  type TestStatusFilter,
  type TestsUiState,
} from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Select,
  SelectOption,
  Skeleton,
  Table,
  type TableColumn,
} from "@caustic/react";
import { Plus } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { NewTestSheet, RunConfirmDialog, type NewTestHandlers } from "./new-test-sheet.tsx";
import { TestDetail, type TestDetailHandlers } from "./test-detail.tsx";
import {
  durationTextOf,
  KIND_FILTER_TEXT,
  KIND_TEXT,
  noticeTextOf,
  STATE_TEXT,
  STATUS_FILTER_TEXT,
  timeTextOf,
} from "./tests-text.ts";

const MUTED = "m-0 text-ui-sm text-text-tertiary";
const KIND_FILTERS: readonly TestKindFilter[] = ["all", "replay", "testRun"];
const STATUS_FILTERS: readonly TestStatusFilter[] = ["all", "running", "passed", "failed"];

export interface TestsViewHandlers extends TestDetailHandlers {
  readonly select: (testId: string | null) => void;
  readonly filter: (filter: TestFilter) => void;
  readonly openSheet: () => void;
  readonly retry: () => void;
  readonly dismissNotice: () => void;
  readonly sheet: NewTestHandlers;
  readonly confirmRun: () => void;
  readonly cancelRun: () => void;
}

export interface TestsViewProps {
  /** 목록의 읽기 상태. 값이 있으면 전체 기록이다(거르기 전) */
  readonly read: TabRead<readonly ExtTestRecord[]>;
  /** 거른 뒤의 행 */
  readonly rows: readonly TestRowVM[];
  readonly selected: TestRowVM | null;
  readonly ui: TestsUiState;
  /** 엔진에 연결되어 있나. 아니면 "새 시험"이 잠긴다 */
  readonly online: boolean;
  /** 맥락 칸이 시험이나 대화라서 목록을 거른 것인가 */
  readonly scoped: boolean;
  readonly selectedPaused: boolean;
  readonly selectedPhase: string | null;
  readonly handlers: TestsViewHandlers;
}

export function TestsView(props: TestsViewProps): ReactNode {
  const { ui, handlers } = props;
  const ready = props.read.kind === "ready";
  return (
    <section
      aria-labelledby="tests-screen-title"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="tests-screen-title" className="text-ui-strong text-text-primary">
          {t("desktop.tests.title")}
        </h1>
        <Button
          size="sm"
          iconStart={<Plus />}
          disabled={!props.online || ui.sending}
          onClick={handlers.openSheet}
        >
          {t("desktop.tests.newTest")}
        </Button>
      </div>
      {ui.notice === null ? null : (
        <Alert
          tone={
            ui.notice.kind === "failed" || ui.notice.kind === "copyFailed" ? "danger" : "success"
          }
          dismissible
          dismissLabel={t("desktop.tests.sheet.close")}
          onDismiss={handlers.dismissNotice}
        >
          {t(noticeTextOf(ui.notice))}
        </Alert>
      )}
      {ready && props.read.value.length > 0 ? (
        <FilterRow filter={ui.filter} onChange={handlers.filter} />
      ) : null}
      {props.scoped ? <p className={MUTED}>{t("desktop.tests.filter.context")}</p> : null}
      <ListBody {...props} />
      {props.selected === null ? (
        ready && props.read.value.length > 0 ? (
          <p className={MUTED}>{t("desktop.tests.detail.pick")}</p>
        ) : null
      ) : (
        <TestDetail
          row={props.selected}
          paused={props.selectedPaused}
          phase={props.selectedPhase}
          handlers={handlers}
        />
      )}
      <p className={MUTED}>{t("desktop.tests.excluded")}</p>
      <NewTestSheet
        draft={ui.sheet}
        devMode={ui.devMode}
        sending={ui.sending}
        handlers={handlers.sheet}
      />
      <RunConfirmDialog
        params={ui.confirm}
        onConfirm={handlers.confirmRun}
        onCancel={handlers.cancelRun}
      />
    </section>
  );
}

function FilterRow(props: {
  readonly filter: TestFilter;
  readonly onChange: (filter: TestFilter) => void;
}): ReactNode {
  const { filter, onChange } = props;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t("desktop.tests.filter.kind")}>
        <Select
          value={filter.kind}
          onValueChange={(value) => {
            const kind = KIND_FILTERS.find((item) => item === value);
            if (kind !== undefined) onChange({ ...filter, kind });
          }}
        >
          {KIND_FILTERS.map((kind) => (
            <SelectOption key={kind} value={kind}>
              {t(KIND_FILTER_TEXT[kind])}
            </SelectOption>
          ))}
        </Select>
      </Field>
      <Field label={t("desktop.tests.filter.status")}>
        <Select
          value={filter.status}
          onValueChange={(value) => {
            const status = STATUS_FILTERS.find((item) => item === value);
            if (status !== undefined) onChange({ ...filter, status });
          }}
        >
          {STATUS_FILTERS.map((status) => (
            <SelectOption key={status} value={status}>
              {t(STATUS_FILTER_TEXT[status])}
            </SelectOption>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** 목록 본문. 읽는 중, 오프라인, 오류, 빈 목록, 거른 결과 없음, 표를 나눈다 */
function ListBody(props: TestsViewProps): ReactNode {
  const { read, rows, selected, handlers } = props;
  switch (read.kind) {
    case "loading":
      return (
        <div role="status" aria-busy="true" className="grid gap-2">
          <span className="sr-only">{t("desktop.tests.loading")}</span>
          {[0, 1, 2].map((line) => (
            <Skeleton key={line} height={36} />
          ))}
        </div>
      );
    case "offline":
      return <p className={MUTED}>{t("desktop.tests.offline")}</p>;
    case "error":
      return (
        <Alert
          tone="danger"
          action={
            <Button size="xs" variant="outline" onClick={handlers.retry}>
              {t("desktop.tests.retry")}
            </Button>
          }
        >
          {t("desktop.tests.loadFailed")}
        </Alert>
      );
    case "ready":
      return (
        <div className="grid gap-2">
          {read.stale ? <p className={MUTED}>{t("desktop.tests.stale")}</p> : null}
          {read.value.length === 0 ? (
            <EmptyState size="sm" surface="none" title={t("desktop.tests.empty")} />
          ) : rows.length === 0 ? (
            <p role="status" className={MUTED}>
              {t("desktop.tests.emptyFiltered")}
            </p>
          ) : (
            <TestTable rows={rows} selected={selected} onSelect={handlers.select} />
          )}
        </div>
      );
    default:
      return assertNever(read, "TabRead");
  }
}

const TEST_COLUMNS = ["kind", "target", "result", "time", "duration"] as const;
type TestColumnKey = (typeof TEST_COLUMNS)[number];

function testColumnOf(key: string): TestColumnKey | null {
  return TEST_COLUMNS.find((column) => column === key) ?? null;
}

function TestTable(props: {
  readonly rows: readonly TestRowVM[];
  readonly selected: TestRowVM | null;
  readonly onSelect: (testId: string | null) => void;
}): ReactNode {
  const { rows, selected, onSelect } = props;
  const byId = new Map(rows.map((row) => [row.testId, row] as const));
  // 머리글은 그릴 때 고른다. 말투(로케일)가 연결 뒤에 바뀔 수 있다
  const columns: TableColumn[] = [
    { key: "kind", header: t("desktop.tests.col.kind") },
    { key: "target", header: t("desktop.tests.col.target") },
    { key: "result", header: t("desktop.tests.col.result") },
    { key: "time", header: t("desktop.tests.col.time") },
    { key: "duration", header: t("desktop.tests.col.duration"), align: "end" },
  ];
  return (
    <Table
      columns={columns}
      rows={rows.map((row) => ({ id: row.testId }))}
      selectionMode="single"
      selectedKeys={selected === null ? [] : [selected.testId]}
      onRowActivate={(picked) => {
        onSelect(selected?.testId === picked.id ? null : picked.id);
      }}
      renderCell={(picked, column) => {
        const row = byId.get(picked.id);
        const name = testColumnOf(column.key);
        if (row === undefined || name === null) return null;
        return <TestCell row={row} column={name} />;
      }}
    />
  );
}

function TestCell(props: { readonly row: TestRowVM; readonly column: TestColumnKey }): ReactNode {
  const { row, column } = props;
  switch (column) {
    case "kind":
      return t(KIND_TEXT[row.kind]);
    case "target":
      return row.target;
    case "result":
      return resultTextOf(row);
    case "time":
      return timeTextOf(row.startedMs);
    case "duration": {
      if (row.durationMs === null) return "—";
      const text = durationTextOf(row.durationMs);
      return t(text.key, { value: text.value });
    }
    default:
      return assertNever(column, "TestColumnKey");
  }
}

/** 결과 칸의 글. replay는 판정과 통과 수, Test run은 상태다 */
function resultTextOf(row: TestRowVM): string {
  if (row.state === "running") return t(STATE_TEXT.running);
  if (row.replay === null) return t(STATE_TEXT[row.state]);
  const verdict = replayVerdictOf(row.replay);
  const key =
    verdict.kind === "same"
      ? "desktop.tests.result.replayPassed"
      : verdict.kind === "digest-differs"
        ? "desktop.tests.result.replayDiffers"
        : "desktop.tests.result.replayFailed";
  return t(key, { passed: row.replay.passed, commits: row.replay.commits });
}
