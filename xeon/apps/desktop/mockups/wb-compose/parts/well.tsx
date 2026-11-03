// 크래프트 오른쪽 well의 구성기 탭 둘: "블록"(끌어 놓을 블록 종류, 보기마다 다름)과 "속성"(고른 블록의 상세).
// 팔레트를 왼쪽 패널이 아니라 well에 두는 까닭: 왼쪽 패널은 크래프트 내비와 맥락 칸이 정본이다(§4.9.3).
// 머리는 PageSection(group), 목록은 caustic List, 빈 속성은 EmptyState.
import { EmptyState, List, ListDescription, ListDescriptionRow, ListRow } from "@caustic/react";
import { PageBody, PageSection, T } from "../../_shell";
import { helmBlocks, invalidBlocks, palette, SLOT_LABEL } from "../fixtures";
import { useMock } from "../store";

const title = (t: string) => <span className="text-body">{t}</span>;

export function PaletteTab() {
  const m = useMock();
  const flow = m.view === "flow";
  return (
    <div className="p-2">
      <List variant="ghost" size="xs" aria-label={flow ? "단계 머신 부품" : T.block}>
        {flow
          ? palette.flow.map((p) => (
              <ListRow
                key={p.id}
                draggable
                className="cursor-grab"
                title={title(p.id === "gate" ? T.humanGate : p.title)}
              />
            ))
          : palette.group.map((p) => (
              <ListRow key={p.slot} draggable className="cursor-grab" title={title(p.title)} />
            ))}
      </List>
    </div>
  );
}

export function InspectTab() {
  const m = useMock();
  const blocks = m.group === "lens-review" ? invalidBlocks : helmBlocks;
  const b = blocks.find((x) => x.id === m.selected);
  if (b === undefined)
    return (
      <div className="p-4">
        <EmptyState size="sm" mark={null} title={`${T.block}을 고르면 여기에 보여요`} />
      </div>
    );
  return (
    <PageBody well className="p-4">
      <PageSection level="group" title={b.title}>
        <ListDescription variant="ghost" size="xs">
          <ListDescriptionRow term={T.blockSlot}>{SLOT_LABEL[b.slot]}</ListDescriptionRow>
          {b.points.map((p) => (
            <ListDescriptionRow key={p.point} term={T.extensionPoint}>
              {p.point}
            </ListDescriptionRow>
          ))}
          {b.consumes.map((c) => (
            <ListDescriptionRow key={c.cap} term={T.capability}>
              {c.cap} ← {c.provider ?? "없음"}
            </ListDescriptionRow>
          ))}
          {b.issue !== undefined && (
            <ListDescriptionRow term="검사">{b.issue.text}</ListDescriptionRow>
          )}
        </ListDescription>
      </PageSection>
    </PageBody>
  );
}
