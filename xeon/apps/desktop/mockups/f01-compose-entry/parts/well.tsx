// 오른쪽 well 탭 둘: "블록"(부품, 사람 확인에 배지 없음)과 "속성"(고른 블록 또는 사람 확인 노드). wb-compose의 well은 배지와 store에 묶여 있어 데이터만 가져왔다.
import {
  Field,
  Input,
  List,
  ListDescription,
  ListDescriptionRow,
  ListRow,
  EmptyState,
} from "@caustic/react";
import { PageBody, PageSection, T } from "../../_shell";
import { helmBlocks, palette, SLOT_LABEL } from "../../wb-compose/fixtures";
import type { Model } from "../flow";

export const GATE_QUESTION = "찾은 변경을 적용할까요?";

export function PaletteWell({ s }: { s: Model }) {
  const flow = s.view === "flow";
  const items = flow
    ? palette.flow.map((p) => ({ id: p.id, title: p.id === "gate" ? T.humanGate : p.title }))
    : palette.group.map((p) => ({ id: p.slot, title: p.title }));
  return (
    <div className="p-2">
      <List variant="ghost" size="xs" aria-label={flow ? T.phaseMachine : T.block}>
        {items.map((p) => (
          <ListRow
            key={p.id}
            draggable
            className="cursor-grab"
            title={<span className="text-body">{p.title}</span>}
          />
        ))}
      </List>
    </div>
  );
}

export function InspectWell({ s }: { s: Model }) {
  if (s.selected === "gate")
    return (
      <PageBody well className="p-4">
        <PageSection level="group" title={T.humanGate}>
          <Field label={T.approvalQuestion}>
            <Input size="sm" variant="soft" defaultValue={GATE_QUESTION} />
          </Field>
          <ListDescription variant="ghost" size="xs">
            <ListDescriptionRow term="기다리는 동안">{`${T.lead} ${T.leadReturn}`}</ListDescriptionRow>
            <ListDescriptionRow term="답한 뒤">{`${T.lead} ${T.leadRetake}`}</ListDescriptionRow>
          </ListDescription>
        </PageSection>
      </PageBody>
    );
  const b = helmBlocks.find((x) => x.id === s.selected);
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
              {`${c.cap} ← ${c.provider ?? "없음"}`}
            </ListDescriptionRow>
          ))}
        </ListDescription>
      </PageSection>
    </PageBody>
  );
}
