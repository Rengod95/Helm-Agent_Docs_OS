import { CodeDiffLine, codeDiffVariants } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import type { FileChangeRow, FileChangeView } from "./approval-form.ts";

// 파일 변경 그림(edit의 줄 diff, write의 쓸 내용 앞줄). 승인 카드 본문과 트랜스크립트 도구 행이 같이 쓴다.

/** 줄 묶음 하나. 줄 번호는 `first`부터 셈한다. edit은 파일을 읽지 않아 diff 줄의 순서이고, write는 쓸 내용의 줄 번호다 */
function DiffRows(props: {
  readonly rows: readonly FileChangeRow[];
  readonly first: number;
}): ReactNode {
  return (
    <pre className="m-0 overflow-x-auto py-1">
      {props.rows.map((row, index) => {
        // 줄 번호는 이 묶음 안에서 겹치지 않으므로 키로도 쓴다(목록은 바뀌지 않는다)
        const number = props.first + index + 1;
        return (
          <CodeDiffLine key={number} kind={row.kind} number={number}>
            {row.text}
          </CodeDiffLine>
        );
      })}
    </pre>
  );
}

/** edit의 diff. 앞 줄은 바로 보이고 나머지는 "더 보기"로 접는다 */
function EditDiff(props: {
  readonly head: readonly FileChangeRow[];
  readonly rest: readonly FileChangeRow[];
}): ReactNode {
  return (
    <div className={codeDiffVariants({ variant: "outline", size: "md", className: "rounded-xl" })}>
      <DiffRows rows={props.head} first={0} />
      {props.rest.length === 0 ? null : (
        <details className="font-ui text-ui text-text-secondary">
          <summary className="px-3 py-1">
            {t("desktop.approvals.diff.moreRows", { count: props.rest.length })}
          </summary>
          <DiffRows rows={props.rest} first={props.head.length} />
        </details>
      )}
    </div>
  );
}

/** write의 내용 앞부분. 줄은 바뀐 줄이 아니라 쓸 내용이라 기호 없이 그린다 */
function WritePreview(props: {
  readonly head: readonly string[];
  readonly hiddenLines: number;
}): ReactNode {
  return (
    <>
      <div
        className={codeDiffVariants({ variant: "outline", size: "md", className: "rounded-xl" })}
      >
        <DiffRows
          rows={props.head.map((text): FileChangeRow => ({ kind: "context", text }))}
          first={0}
        />
      </div>
      {props.hiddenLines === 0 ? null : (
        <div className="text-ui text-text-secondary">
          {t("desktop.approvals.diff.moreLines", { count: props.hiddenLines })}
        </div>
      )}
    </>
  );
}

/** 파일 변경 그림. edit이면 줄 diff, write면 쓸 내용의 앞줄이다. 경로는 그리지 않는다(부르는 쪽이 머리에 둔다) */
export function FileChangeDiff(props: { readonly view: FileChangeView }): ReactNode {
  const { view } = props;
  return view.kind === "edit" ? (
    <EditDiff head={view.head} rest={view.rest} />
  ) : (
    <WritePreview head={view.head} hiddenLines={view.hiddenLines} />
  );
}
