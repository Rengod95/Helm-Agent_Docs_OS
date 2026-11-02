// 블록에서 코드로(구성기 5, 읽기 전용): 왼쪽 블록 목록(ListNavigation), 가운데 만들 파일(drive 템플릿), 오른쪽 고른 파일의 생성 결과.
// 블록을 고르면 그 블록에서 나온 파일만 진하게, 코드 줄은 soft 면으로 보인다(색 없음). 파일 목록은 보기 전용이다.
// caustic 빈틈: CodeRealization은 내려받기 단추가 필수라(downloadLabel, 늘 그림) 단계와 파일 목록을 토큰으로 직접 그린다.
import {
  ListNavigation,
  ListNavigationItem,
  SegmentedControl,
  SegmentedControlItem,
} from "@caustic/react";
import { useState } from "react";
import { ArrowRight, PageSection, T } from "../../_shell";
import { codeIndex, helmBlocks, manifestIndex, scaffoldFiles } from "../fixtures";
import { useMock } from "../store";

const BLOCKS = [
  { id: "register", title: "lens-review" },
  ...helmBlocks.map((b) => ({ id: b.id, title: b.title })),
];
const FILES = ["index", "manifest"] as const;
type FileId = (typeof FILES)[number];
const isFile = (v: string): v is FileId => FILES.some((f) => f === v);

const PHASES = [T.block, T.manifest, T.stageScaffold, T.stageValidate];
/** 이 시안의 작성 중 그룹은 뼈대 단계에 있다. */
const PHASE_NOW = 2;

function Phases() {
  return (
    <ol
      aria-label="만드는 단계"
      className="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0 text-footnote"
    >
      {PHASES.map((p, i) => (
        <li key={p} className="inline-flex items-center gap-1.5">
          {i > 0 && <ArrowRight aria-hidden className="size-icon-xs text-text-tertiary" />}
          <span
            {...(i === PHASE_NOW ? { "aria-current": "step" as const } : {})}
            className={
              i === PHASE_NOW
                ? "font-medium text-text-primary"
                : i < PHASE_NOW
                  ? "text-text-secondary"
                  : "text-text-tertiary"
            }
          >
            {p}
          </span>
        </li>
      ))}
    </ol>
  );
}

function FileList({ selected }: { selected: string }) {
  return (
    <ul aria-label="만들 파일" className="m-0 grid list-none p-0">
      {scaffoldFiles.map((f) => {
        const from: readonly string[] = f.from;
        return (
          <li
            key={f.path}
            className={`truncate border-b border-border-subtle py-2 font-mono text-mono-sm last:border-b-0 ${from.includes(selected) ? "text-text-primary" : "text-text-tertiary"}`}
          >
            {f.path}
          </li>
        );
      })}
    </ul>
  );
}

export function CodeView() {
  const m = useMock();
  const [file, setFile] = useState<FileId>("index");
  const lines = file === "index" ? codeIndex : manifestIndex;
  const sel = m.selected ?? "drive";
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[11rem_16rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-8 px-4 pb-6 max-[1100px]:grid-cols-[11rem_minmax(0,1fr)] max-[720px]:grid-cols-1 max-[720px]:grid-rows-none max-[720px]:overflow-y-auto">
      <PageSection level="group" title={T.block} className="content-start">
        <ListNavigation aria-label={T.block} size="sm">
          {BLOCKS.map((b) => (
            <ListNavigationItem
              key={b.id}
              current={sel === b.id}
              onSelect={() => m.set({ selected: b.id })}
            >
              {b.title}
            </ListNavigationItem>
          ))}
        </ListNavigation>
      </PageSection>

      <PageSection
        level="group"
        title="만들 파일"
        action={<span className="text-footnote text-text-tertiary">{T.drive} 템플릿</span>}
        className="content-start max-[1100px]:hidden"
      >
        <Phases />
        <FileList selected={sel} />
      </PageSection>

      <section
        aria-label="생성 결과"
        className="flex min-h-0 min-w-0 flex-col gap-3 border-s border-border-subtle ps-8 max-[720px]:border-s-0 max-[720px]:ps-0"
      >
        <div className="flex flex-none items-center">
          <SegmentedControl
            size="xs"
            value={file}
            onValueChange={(v) => {
              if (isFile(v)) setFile(v);
            }}
            aria-label="파일"
          >
            <SegmentedControlItem value="index">src/index.ts</SegmentedControlItem>
            <SegmentedControlItem value="manifest">plugin.json</SegmentedControlItem>
          </SegmentedControl>
        </div>
        <pre className="m-0 min-h-0 flex-1 overflow-auto font-mono text-mono-sm leading-5">
          {lines.map((l, i) => {
            const on = l.block === sel;
            return (
              <div
                key={i}
                className={`grid grid-cols-[2.5rem_minmax(0,1fr)] rounded-sm ${on ? "bg-neutral-soft" : ""}`}
              >
                <span className="select-none pe-3 text-end text-text-tertiary">{i + 1}</span>
                <code
                  className={`whitespace-pre ${on ? "text-text-primary" : "text-text-tertiary"}`}
                >
                  {l.text || " "}
                </code>
              </div>
            );
          })}
        </pre>
      </section>
    </div>
  );
}
