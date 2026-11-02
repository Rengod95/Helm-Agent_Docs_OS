// 크래프트 오른쪽 well의 구성기 탭 둘: "블록"(끌어 놓을 블록 종류, 보기마다 다름)과 "속성"(고른 블록·노드의 상세).
// 팔레트를 왼쪽 패널이 아니라 well에 두는 까닭: 왼쪽 패널은 크래프트 내비와 맥락 칸이 정본이다(§4.9.3).
import { ListDescription, ListDescriptionRow } from "@caustic/react";
import { GripVertical } from "../../_shell";
import { helmBlocks, invalidBlocks, palette, SLOT_LABEL } from "../fixtures";
import { SLOT_ICON } from "./blocks";
import { useMock } from "../store";

function Row({
  icon,
  title,
  hint,
  meta,
}: {
  icon?: React.ReactNode;
  title: string;
  hint: string;
  meta?: string;
}) {
  return (
    <li
      draggable
      className="group/pal flex min-h-10 cursor-grab items-center gap-2 rounded-md px-1.5 py-1 hover:bg-control-raised-hover"
    >
      <span
        aria-hidden
        className="inline-grid size-6 flex-none place-items-center rounded-sm bg-neutral-track text-text-tertiary [&_svg]:size-icon-xs"
      >
        {icon ?? <GripVertical />}
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-ui-dense text-text-primary">{title}</span>
        <span className="truncate text-ui-xs text-text-tertiary">{hint}</span>
      </span>
      {meta !== undefined && <span className="text-ui-xs text-text-tertiary">{meta}</span>}
      <GripVertical
        aria-hidden
        className="size-icon-xs text-text-tertiary opacity-0 group-hover/pal:opacity-100"
      />
    </li>
  );
}

export function PaletteTab() {
  const m = useMock();
  const flow = m.view === "flow";
  return (
    <div className="grid gap-1 p-1.5">
      <p className="m-0 px-1.5 pb-1 text-ui-xs text-text-tertiary">
        {flow ? "단계 머신에 끌어 놓고 포트를 이어요" : "그룹 열에 끌어 쌓아요 · drive는 하나만"}
      </p>
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {flow
          ? palette.flow.map((p) => (
              <Row
                key={p.id}
                title={p.title}
                hint={p.hint}
                {...(p.id === "gate" ? { meta: "런타임에 없음" } : {})}
              />
            ))
          : palette.group.map((p) => (
              <Row
                key={p.slot}
                icon={SLOT_ICON[p.slot]}
                title={p.title}
                hint={p.hint}
                meta={p.op}
              />
            ))}
      </ul>
    </div>
  );
}

export function InspectTab() {
  const m = useMock();
  const blocks = m.group === "lens-review" ? invalidBlocks : helmBlocks;
  const b = blocks.find((x) => x.id === m.selected);
  if (b === undefined)
    return <p className="m-0 p-3 text-ui-dense text-text-tertiary">블록을 고르면 여기에 보여요</p>;
  return (
    <div className="grid gap-2 p-3">
      <ListDescription variant="ghost" size="xs">
        <ListDescriptionRow term="슬롯">{SLOT_LABEL[b.slot]}</ListDescriptionRow>
        <ListDescriptionRow term="연산">{b.op}</ListDescriptionRow>
        {b.points.map((p) => (
          <ListDescriptionRow key={p.point} term="훅">
            {p.point} · {p.fold} · 실패 {p.failure}
          </ListDescriptionRow>
        ))}
        {b.consumes.map((c) => (
          <ListDescriptionRow key={c.cap} term="기능" mono>
            {c.cap} {c.mode} ← {c.provider ?? "없음"}
          </ListDescriptionRow>
        ))}
        <ListDescriptionRow term="코드" mono>
          {b.code.file}:{b.code.from}
        </ListDescriptionRow>
        {b.issue !== undefined && (
          <ListDescriptionRow term="검사">{b.issue.text}</ListDescriptionRow>
        )}
      </ListDescription>
    </div>
  );
}
