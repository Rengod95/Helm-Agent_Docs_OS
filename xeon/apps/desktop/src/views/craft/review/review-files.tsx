// 리뷰 상세의 "바뀌는 파일"(가운데 읽는 열). 파일 목록과 고른 파일의 본문이다.
// 갱신은 지난 승인 버전(`pluginReview.file`의 `side: "base"`, 목록은 `ReviewItem.baseFiles`)과 새 판을 줄 단위로 견준다(`review-diff.ts`).
// 새 파일과 지운 파일은 한쪽 내용만 기호 없이 보인다(화면 전체가 초록·빨강으로 물들지 않게). 지난 판이 보관소에 없으면(`missing`)
// "보관되어 있지 않아요"라고 알리고 새 내용만 보인다. 결정한 뒤에도 엔진이 본문을 주므로 다시 볼 때도 읽는다.
// 줄 그림은 기존 차이 부품의 재료(caustic `CodeDiffLine`, `codeDiffVariants`, 앱의 `convo-diff` 껍질)를 그대로 쓰고, 덩이 사이에
// 접은 같은 줄 수만 더한다(줄 번호가 실제 파일의 줄 번호라 `FileChangeDiff`의 차례 번호 대신 이 묶음을 쓴다).
import { t, type MessageId } from "@fresnel/client/i18n";
import { Button, cn, CodeDiffLine, codeDiffVariants } from "@caustic/react";
import { ChevronDown, ChevronUp } from "@caustic/react/icons";
import { detach, rethrow } from "@fresnel/contracts";
import type { ReviewFileSide, ReviewItem } from "@fresnel/contracts/wire";
import {
  Fragment,
  useEffect,
  useImperativeHandle,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { indentOf, lineDiffOf, wholeFileRows, type DiffHunk, type DiffRow } from "./review-diff.ts";
import {
  fileRowsOf,
  firstFileOf,
  shortHash,
  shownFilesOf,
  sizeOf,
  stepFile,
  type FileRow,
} from "./review-model.ts";
import type { ReviewData } from "./review-source.ts";

/** 파일 넘기기(키보드 [ ]가 부른다) */
export interface FileHandle {
  step(delta: 1 | -1): void;
}

type SideText =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | {
      readonly status: "ready";
      readonly text: string | null;
      readonly truncated: boolean;
      readonly missing: boolean;
    };

/** 한 파일의 두 쪽. 읽지 않는 쪽(새 파일의 지난 판 등)은 null이다 */
interface FileRead {
  readonly path: string;
  readonly candidate: SideText | null;
  readonly base: SideText | null;
}

/** 한쪽만 보일 때 줄 수 상한. 넘으면 남은 줄 수를 알린다 */
const WHOLE_LINES = 240;

const CHANGE_WORD: Readonly<Record<FileRow["change"], MessageId>> = {
  added: "desktop.craft.review.files.change.added",
  changed: "desktop.craft.review.files.change.changed",
  removed: "desktop.craft.review.files.change.removed",
  same: "desktop.craft.review.files.change.same",
};
const CHANGE_MARK: Readonly<Record<FileRow["change"], string>> = {
  added: "+",
  changed: "~",
  removed: "−",
  same: "·",
};

function sizeText(bytes: number): string {
  const size = sizeOf(bytes);
  return `${String(size.value)} ${size.unit}`;
}

const NOTE = "m-0 text-ui-sm text-text-tertiary";

/** 덩이 사이의 접은 같은 줄 수 한 줄 */
function skipLine(count: number, key: string): ReactNode {
  return count === 0 ? null : (
    <span
      key={key}
      data-slot="review-diff-skip"
      className="block bg-neutral-soft px-3 py-0.5 font-ui text-ui-sm text-text-tertiary"
    >
      {t("desktop.craft.review.files.skipped", { count })}
    </span>
  );
}

type HangStyle = CSSProperties & { readonly "--rv-indent": string };

/** 줄 하나의 글. 넘어간 줄이 코드의 들여쓰기 칸에서 이어지도록 앞 공백 폭을 `--rv-indent`로 넘긴다(`review.css`의 `.rv-line`) */
function HangLine(props: { readonly text: string }): ReactNode {
  const indent = indentOf(props.text);
  if (indent === 0) return <span className="rv-line">{props.text}</span>;
  const style: HangStyle = { "--rv-indent": `${String(indent)}ch` };
  return (
    <span className="rv-line" style={style}>
      {props.text}
    </span>
  );
}

/** 차이 줄 묶음. 덩이 사이에는 접은 같은 줄 수를 한 줄로 둔다 */
function DiffBlock(props: {
  readonly hunks: readonly DiffHunk[];
  readonly trailing: number;
  readonly label: string;
}): ReactNode {
  return (
    <div
      aria-label={props.label}
      role="group"
      className={codeDiffVariants({
        variant: "outline",
        size: "md",
        className: "convo-diff rv-diff rounded-xl",
      })}
    >
      <pre className="m-0 overflow-x-auto py-1">
        {props.hunks.map((hunk, index) => (
          // 덩이는 첫 줄 번호로 가른다(한 파일 안에서 겹치지 않는다)
          <Fragment key={`${String(index)}:${String(hunk.rows[0]?.number ?? 0)}`}>
            {skipLine(hunk.skipped, `skip-${String(index)}`)}
            {hunk.rows.map((row, at) => (
              <CodeDiffLine
                key={`${row.kind}:${String(row.number)}:${String(at)}`}
                kind={row.kind}
                number={row.number}
              >
                <HangLine text={row.text} />
              </CodeDiffLine>
            ))}
          </Fragment>
        ))}
        {skipLine(props.trailing, "skip-end")}
      </pre>
    </div>
  );
}

/** 한쪽 내용만(새 파일, 지운 파일, 지난 판이 없는 갱신, 같은 파일). 기호 없이 앞 줄만 보인다 */
function WholeFile(props: { readonly text: string; readonly label: string }): ReactNode {
  const rows: readonly DiffRow[] = wholeFileRows(props.text, "context");
  const shown = rows.slice(0, WHOLE_LINES);
  return (
    <div className="grid gap-1.5">
      <DiffBlock hunks={[{ skipped: 0, rows: shown }]} trailing={0} label={props.label} />
      {rows.length > shown.length ? (
        <p className={NOTE}>
          {t("desktop.craft.review.files.moreLines", { count: rows.length - shown.length })}
        </p>
      ) : null}
    </div>
  );
}

function Status(props: { readonly word: MessageId; readonly tone?: "danger" }): ReactNode {
  return (
    <p
      role={props.tone === "danger" ? undefined : "status"}
      className={cn(
        "m-0 text-ui",
        props.tone === "danger" ? "text-danger-text" : "text-text-secondary",
      )}
    >
      {t(props.word)}
    </p>
  );
}

/** 고른 파일의 본문. 두 쪽의 읽기 상태를 보고 차이, 한쪽 내용, 알림 가운데 하나를 그린다 */
function FileBody(props: { readonly row: FileRow; readonly read: FileRead | null }): ReactNode {
  const { row, read } = props;
  const label = t("desktop.craft.review.files.bodyLabel", { path: row.path });
  if (read === null || read.path !== row.path)
    return <Status word="desktop.craft.review.files.loading" />;
  const sides = [read.candidate, read.base].filter((side): side is SideText => side !== null);
  if (sides.some((side) => side.status === "loading")) {
    return <Status word="desktop.craft.review.files.loading" />;
  }
  if (sides.some((side) => side.status === "failed")) {
    return <Status word="desktop.craft.review.files.failed" tone="danger" />;
  }
  const cand = read.candidate?.status === "ready" ? read.candidate : null;
  const base = read.base?.status === "ready" ? read.base : null;
  const truncated = (cand?.truncated ?? false) || (base?.truncated ?? false);
  const truncatedNote = truncated ? (
    <p className={NOTE}>{t("desktop.craft.review.files.truncated")}</p>
  ) : null;

  // 지운 파일: 지난 판만 있다
  if (row.change === "removed") {
    if (base === null || base.missing) return <Status word="desktop.craft.review.files.notKept" />;
    if (base.text === null) return <Status word="desktop.craft.review.files.binary" />;
    return (
      <div className="grid gap-1.5">
        <p className={NOTE}>{t("desktop.craft.review.files.removedNote")}</p>
        <WholeFile text={base.text} label={label} />
        {truncatedNote}
      </div>
    );
  }
  if (cand === null || cand.missing) return <Status word="desktop.craft.review.files.notKept" />;
  if (cand.text === null) return <Status word="desktop.craft.review.files.binary" />;

  // 바뀐 파일: 지난 판이 있으면 줄 차이, 없으면 새 내용만
  if (row.change === "changed") {
    if (base === null || base.missing || base.text === null) {
      const why: MessageId =
        base === null
          ? "desktop.craft.review.files.baseUnknownOne"
          : base.missing
            ? "desktop.craft.review.files.baseNotKept"
            : "desktop.craft.review.files.baseBinary";
      return (
        <div className="grid gap-1.5">
          <p className={NOTE}>{t(why)}</p>
          <WholeFile text={cand.text} label={label} />
          {truncatedNote}
        </div>
      );
    }
    const diff = lineDiffOf(base.text, cand.text);
    if (diff.hunks.length === 0) return <Status word="desktop.craft.review.files.sameText" />;
    return (
      <div className="grid gap-1.5">
        <DiffBlock hunks={diff.hunks} trailing={diff.trailing} label={label} />
        {truncatedNote}
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      <WholeFile text={cand.text} label={label} />
      {truncatedNote}
    </div>
  );
}

/** 바뀐 줄 수(+n −m). 두 쪽을 다 읽은 바뀐 파일에만 있다 */
function statOf(row: FileRow, read: FileRead | null): { added: number; removed: number } | null {
  if (row.change !== "changed" || read === null || read.path !== row.path) return null;
  const cand = read.candidate;
  const base = read.base;
  if (cand?.status !== "ready" || base?.status !== "ready") return null;
  if (cand.text === null || base.text === null || base.missing) return null;
  const diff = lineDiffOf(base.text, cand.text);
  return { added: diff.added, removed: diff.removed };
}

export function FilesSection(props: {
  readonly item: ReviewItem;
  readonly data: Pick<ReviewData, "file">;
  readonly fileRef: Ref<FileHandle>;
}): ReactNode {
  const { item, data } = props;
  const rows = fileRowsOf(item);
  const shown = shownFilesOf(rows);
  const same = rows.length - shown.length;
  const [current, setCurrent] = useState<string | null>(() => firstFileOf(rows));
  // 읽은 본문은 경로와 함께 둔다. 고른 경로와 다르면 아직 읽는 중이다(효과 안에서 상태를 바로 바꾸지 않는다)
  const [read, setRead] = useState<FileRead | null>(null);
  const row = rows.find((r) => r.path === current) ?? null;

  useImperativeHandle(props.fileRef, () => ({
    step: (delta) => {
      setCurrent((now) => stepFile(shown, now, delta));
    },
  }));

  const path = row?.path ?? null;
  const wantCandidate = row?.sides.candidate ?? false;
  const wantBase = row?.sides.base ?? false;
  useEffect(() => {
    if (path === null) return undefined;
    let live = true;
    const one = async (side: ReviewFileSide): Promise<SideText> => {
      const got = await data.file(item.itemId, path, side === "base" ? "base" : undefined);
      if (!got.ok) return { status: "failed" };
      return {
        status: "ready",
        text: got.value.text,
        truncated: got.value.truncated,
        missing: got.value.missing === true,
      };
    };
    const run = async (): Promise<void> => {
      const [candidate, base] = await Promise.all([
        wantCandidate ? one("candidate") : Promise.resolve(null),
        wantBase ? one("base") : Promise.resolve(null),
      ]);
      if (live) setRead({ path, candidate, base });
    };
    detach(run(), rethrow);
    return () => {
      live = false;
    };
  }, [data, item.itemId, path, wantCandidate, wantBase]);

  if (item.kind === "remove") return null;
  const stat = row === null ? null : statOf(row, read);
  return (
    <div className="grid gap-3">
      {item.kind === "new" ? (
        <p className={NOTE}>{t("desktop.craft.review.files.noBase")}</p>
      ) : item.baseFiles === undefined ? (
        <p className={NOTE}>{t("desktop.craft.review.files.baseUnknown")}</p>
      ) : (
        <p className={NOTE}>
          {t("desktop.craft.review.files.base", { hash: shortHash(item.baseHash) ?? "" })}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="m-0 text-ui text-text-secondary">{t("desktop.craft.review.files.none")}</p>
      ) : (
        <>
          <ul className="m-0 grid gap-px p-0" aria-label={t("desktop.craft.review.section.files")}>
            {shown.map((r) => {
              const on = r.path === current;
              return (
                <li key={r.path} className="list-none">
                  <button
                    type="button"
                    aria-current={on ? "true" : undefined}
                    onClick={() => {
                      setCurrent(r.path);
                    }}
                    className={cn(
                      "flex h-control-sm w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-ui outline-none focus-visible:shadow-focus",
                      on ? "bg-control-raised" : "hover:bg-neutral-hover",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={`rv-change-${r.change} w-3 shrink-0 text-center font-mono`}
                    >
                      {CHANGE_MARK[r.change]}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-text-primary">
                      {r.path}
                    </span>
                    <span className="shrink-0 text-ui-sm text-text-tertiary">
                      {t(CHANGE_WORD[r.change])}
                    </span>
                    <span className="w-14 shrink-0 text-right text-ui-sm text-text-tertiary">
                      {sizeText(r.bytes)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {same > 0 ? (
            <p className={cn(NOTE, "ps-2")}>
              {t("desktop.craft.review.files.sameCount", { count: same })}
            </p>
          ) : null}
          {row === null ? null : (
            <div className="grid gap-2" aria-live="polite">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate font-mono text-ui-sm text-text-secondary">
                  {row.path}
                </span>
                {stat === null ? null : (
                  <span className="shrink-0 font-mono text-ui-sm tabular-nums">
                    <span className="rv-change-added">+{String(stat.added)}</span>{" "}
                    <span className="rv-change-removed">−{String(stat.removed)}</span>
                  </span>
                )}
                <span className="ms-auto flex shrink-0 items-center">
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={t("desktop.craft.review.files.prev")}
                    title={`${t("desktop.craft.review.files.prev")} · [`}
                    className="w-control-xs px-0"
                    onClick={() => {
                      setCurrent((now) => stepFile(shown, now, -1));
                    }}
                  >
                    <ChevronUp aria-hidden="true" className="size-3.5" />
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={t("desktop.craft.review.files.next")}
                    title={`${t("desktop.craft.review.files.next")} · ]`}
                    className="w-control-xs px-0"
                    onClick={() => {
                      setCurrent((now) => stepFile(shown, now, 1));
                    }}
                  >
                    <ChevronDown aria-hidden="true" className="size-3.5" />
                  </Button>
                </span>
              </div>
              <FileBody row={row} read={read} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
