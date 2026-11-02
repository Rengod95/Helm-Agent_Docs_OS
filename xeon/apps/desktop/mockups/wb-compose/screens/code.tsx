// 블록에서 코드로(구성기 5, 읽기 전용): 왼쪽 블록 쌓기 축약, 가운데 만들 파일 10개(drive 템플릿), 오른쪽 고른 파일의 생성 결과.
// 블록을 고르면 그 블록에서 나온 줄이 올린 면으로 보인다(현재 항목과 같은 raised, 색 없음). 만들기는 ext.scaffold가 없어
// (gap W-27) "fresnel group new lens-review --drive" 명령을 복사하고, 블록 내용은 생성 뒤 채울 패치로 보인다.
import {
  CodeRealization,
  CodeRealizationFile,
  SegmentedControl,
  SegmentedControlItem,
} from "@caustic/react";
import { useState } from "react";
import { codeIndex, helmBlocks, manifestIndex, scaffoldFiles } from "../fixtures";
import { SLOT_ICON } from "../parts/blocks";
import { useMock } from "../store";

const BLOCKS = [
  { id: "scope", slot: "scope" as const, title: "lens-review", op: "scope" },
  ...helmBlocks.map((b) => ({ id: b.id, slot: b.slot, title: b.title, op: b.op })),
];

export function CodeView() {
  const m = useMock();
  const [file, setFile] = useState<"index" | "manifest">("index");
  const lines = file === "index" ? codeIndex : manifestIndex;
  const sel = m.selected ?? "drive";
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[11rem_19rem_minmax(0,1fr)] gap-4 px-3 pb-3 max-[1100px]:grid-cols-[12rem_minmax(0,1fr)] max-[720px]:grid-cols-1">
      <nav aria-label="블록" className="grid content-start gap-0.5">
        <span className="px-2 pb-1 text-ui-xs text-text-tertiary">
          블록 {BLOCKS.length - 1} · 고르면 나온 파일과 줄
        </span>
        {BLOCKS.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-current={sel === b.id ? "true" : undefined}
            onClick={() => m.set({ selected: b.id })}
            className={`flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-start text-ui-dense outline-none focus-visible:focus-ring ${sel === b.id ? "bg-surface-raised text-text-primary shadow-1" : "text-text-secondary hover:bg-control-raised-hover"}`}
          >
            <span
              aria-hidden
              className="inline-grid size-5 flex-none place-items-center rounded-sm bg-neutral-track text-text-tertiary [&_svg]:size-icon-xs"
            >
              {SLOT_ICON[b.slot]}
            </span>
            <span className="min-w-0 flex-1 truncate">{b.title}</span>
            <span className="text-ui-xs text-text-tertiary">{b.op}</span>
          </button>
        ))}
      </nav>

      <div className="min-w-0 max-[1100px]:hidden">
        <CodeRealization
          phases={[
            { id: "blocks", label: "블록" },
            { id: "manifest", label: "매니페스트" },
            { id: "skeleton", label: "뼈대" },
            { id: "check", label: "검사" },
          ]}
          current="skeleton"
          phasesLabel="만드는 단계"
          filesLabel="만들 파일"
          phaseStatusLabels={{ done: "끝남", now: "지금" }}
          target="drive 템플릿"
          targetReadOnly
          targetLabel={(t) => `템플릿 ${t}`}
          downloadLabel="명령 복사"
          onDownload={() => m.notify("fresnel group new lens-review --drive 를 복사했어요")}
          size="sm"
        >
          {scaffoldFiles.map((f) => (
            <CodeRealizationFile
              key={f.path}
              name={f.path}
              className={(f.from as readonly string[]).includes(sel) ? undefined : "opacity-45"}
              {...(f.state === "changed"
                ? { added: f.path === "src/index.ts" ? 29 : f.path.endsWith(".json") ? 28 : 12 }
                : {})}
              addedLabel=" 줄"
            />
          ))}
        </CodeRealization>
      </div>

      <section aria-label="생성 결과" className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-8 flex-none items-center gap-2">
          <SegmentedControl
            size="xs"
            value={file}
            onValueChange={(v) => setFile(v as "index" | "manifest")}
            aria-label="파일"
          >
            <SegmentedControlItem value="index">src/index.ts</SegmentedControlItem>
            <SegmentedControlItem value="manifest">plugin.json</SegmentedControlItem>
          </SegmentedControl>
          <span className="text-ui-xs text-text-tertiary">
            읽기 전용 · 생성 뒤에는 편집기에서 고쳐요
          </span>
        </div>
        <pre className="m-0 min-h-0 flex-1 overflow-auto py-1 font-mono text-mono-sm leading-5">
          {lines.map((l, i) => {
            const on = l.block === sel;
            return (
              <div
                key={i}
                className={`grid grid-cols-[2rem_1.25rem_minmax(0,1fr)] rounded-sm ${on ? "bg-surface-raised shadow-1" : ""}`}
              >
                <span className="select-none pe-2 text-end text-text-tertiary">{i + 1}</span>
                <span
                  aria-hidden
                  className="grid place-items-center text-text-tertiary [&_svg]:size-3"
                >
                  {l.block !== undefined && lines[i - 1]?.block !== l.block
                    ? SLOT_ICON[BLOCKS.find((b) => b.id === l.block)?.slot ?? "scope"]
                    : null}
                </span>
                <code
                  className={`whitespace-pre ${on ? "text-text-primary" : l.block === undefined ? "text-text-tertiary" : "text-text-secondary"}`}
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
