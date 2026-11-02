// 프로필 쌓기(구성기 3): 층마다 띠 하나, 띠 안에 확장 블록. 블록마다 켜기·끄기·그대로(프로필 enable·disable·둘 다 아님, §6.28).
// 순서가 뜻을 가지는 곳만 끌어 옮긴다: 주도 칸(x.primitives.activeDriveGroup, 한 그룹 또는 자동)과
// first·chain 훅의 핸들러 순서(같은 tier 안에서만, loadIndex [제안: 런타임에 순서 입력이 없음]).
// 오른쪽 "실효 스택"은 맥락 대화의 지금 값과 프로필을 합친 결과다. 적용은 settings.set(session) 여러 번, 다음 단계 경계.
import {
  Badge,
  Button,
  GraphNode,
  ListDescription,
  ListDescriptionRow,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectOption,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  FlaskConical,
  GripVertical,
  Lock,
  RotateCw,
  threads,
  useShell,
} from "../../_shell";
import { chainOrder, stackBands, type Pick, type StackItem } from "../fixtures";
import { useMock } from "../store";

const NOW: Record<StackItem["now"], string> = {
  enabled: "켜짐",
  disabled: "꺼짐",
  auto_disabled: "자동 꺼짐",
};

function Band({
  layer,
  title,
  children,
  note,
}: {
  layer: string;
  title: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section
      aria-label={`${layer} ${title}`}
      className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 py-1.5"
    >
      <div className="grid content-start pt-1">
        <span className="font-mono text-mono-sm text-text-secondary">{layer}</span>
        <span className="text-ui-xs text-text-tertiary">{title}</span>
      </div>
      <div className="grid gap-1">
        <div className="flex flex-wrap gap-2">{children}</div>
        {note !== undefined && <p className="m-0 text-ui-xs text-text-tertiary">{note}</p>}
      </div>
    </section>
  );
}

function Chip({
  children,
  drag = false,
  off = false,
}: {
  children: ReactNode;
  drag?: boolean;
  off?: boolean;
}) {
  return (
    <span
      className={`inline-flex h-7 items-center gap-1 rounded-md bg-surface-base px-2 text-ui-xs shadow-[inset_0_0_0_1px_var(--cs-color-border-default)] ${off ? "text-text-tertiary line-through" : "text-text-primary"}`}
    >
      {drag && <GripVertical aria-hidden className="size-icon-xs cursor-grab text-text-tertiary" />}
      {children}
    </span>
  );
}

function ItemBlock({ it, pick, onPick }: { it: StackItem; pick: Pick; onPick: (p: Pick) => void }) {
  const changes =
    (pick === "on" && it.now !== "enabled") || (pick === "off" && it.now === "enabled");
  return (
    <GraphNode
      x={0}
      y={0}
      width={212}
      className="relative top-0 left-0"
      title={it.name}
      meta={<span className="font-mono text-mono-sm">{it.tier}</span>}
      variant={it.locked !== undefined ? "soft" : "outline"}
    >
      <p className="m-0 truncate text-ui-xs text-text-tertiary">
        지금 {NOW[it.now]}
        {changes && <span className="text-text-primary"> → {pick === "on" ? "켜짐" : "꺼짐"}</span>}
        {it.points !== undefined && ` · ${it.points}`}
      </p>
      {it.locked !== undefined ? (
        <span className="inline-flex items-center gap-1 text-ui-xs text-text-tertiary">
          <Lock aria-hidden className="size-icon-xs" />
          {it.locked}
        </span>
      ) : (
        <SegmentedControl
          size="xs"
          value={pick}
          onValueChange={(v) => onPick(v as Pick)}
          aria-label={`${it.name} 프로필 값`}
        >
          <SegmentedControlItem value="on">켜기</SegmentedControlItem>
          <SegmentedControlItem value="off">끄기</SegmentedControlItem>
          <SegmentedControlItem value="keep">그대로</SegmentedControlItem>
        </SegmentedControl>
      )}
    </GraphNode>
  );
}

const after = (it: StackItem, p: Pick) =>
  p === "on" ? "켜짐" : p === "off" ? "꺼짐" : NOW[it.now];

export function ProfileStack() {
  const m = useMock();
  const shell = useShell();
  const ctx = threads.find((t) => t.id === shell.contextThreadId)?.title ?? null;
  const all = stackBands.flatMap((b) => b.items);
  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries(all.map((i) => [i.name, i.pick])),
  );
  const changed = all.filter((i) => after(i, picks[i.name] ?? "keep") !== NOW[i.now]);
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      style={{
        backgroundImage: "radial-gradient(var(--cs-color-canvas-dot) 1px, transparent 1.2px)",
        backgroundSize: "20px 20px",
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_18rem] gap-6 px-3 pb-8 max-[1000px]:grid-cols-1">
        <div className="grid content-start">
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <Select size="xs" defaultValue="explore" aria-label="프로필" className="w-44">
              <SelectOption value="explore">탐구 중심</SelectOption>
              <SelectOption value="quiet">조용히</SelectOption>
              <SelectOption value="review-trial">review 테스트</SelectOption>
            </Select>
            <span className="text-ui-xs text-text-tertiary">
              층마다 쌓아요 · 위가 바깥 tier예요
            </span>
          </div>

          <Band
            layer="drive"
            title="주도"
            note="activeDriveGroup은 한 그룹이에요. 비우면 먼저 요청한 그룹이 받아요. 바꾸면 다음 경계에 지금 주도를 회수해요."
          >
            <span className="inline-flex items-center gap-2 rounded-lg bg-neutral-well/70 p-1 pe-2">
              <Chip drag>
                <RotateCw aria-hidden className="size-icon-xs text-text-tertiary" />
                helm
              </Chip>
              <span className="text-ui-xs text-text-tertiary">activeDriveGroup</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-ui-xs text-text-tertiary">
              후보
              <Chip off>review</Chip>
              <span>이 프로필에서 꺼요</span>
            </span>
          </Band>

          {stackBands.map((b) => (
            <Band key={b.layer} layer={b.layer} title={b.title}>
              {b.items.map((it) => (
                <ItemBlock
                  key={it.name}
                  it={it}
                  pick={picks[it.name] ?? "keep"}
                  onPick={(p) => setPicks((o) => ({ ...o, [it.name]: p }))}
                />
              ))}
            </Band>
          ))}

          <Band
            layer="order"
            title="first 순서"
            note={
              <>
                tool.call.before 핸들러는 tier → 로드 순서 → 등록 순서로 돌아요. 같은 tier 안에서만
                옮길 수 있어요.{" "}
                <Badge size="sm" variant="soft" tone="warning">
                  런타임에 순서 입력 없음
                </Badge>
              </>
            }
          >
            {chainOrder.map((t, i) => (
              <span key={t.tier} className="inline-flex items-center gap-1.5">
                {i > 0 && <ArrowRight aria-hidden className="size-icon-xs text-text-tertiary" />}
                <span className="inline-flex items-center gap-1 rounded-lg bg-neutral-well/70 p-1">
                  <span className="px-1 font-mono text-mono-sm text-text-tertiary">{t.tier}</span>
                  {t.items.length === 0 && (
                    <span className="px-1 text-ui-xs text-text-tertiary">없음</span>
                  )}
                  {t.items.map((n) => (
                    <Chip
                      key={n}
                      drag={t.fixed !== true && !(t.removed ?? []).includes(n)}
                      off={(t.removed ?? []).includes(n)}
                    >
                      {t.fixed === true && (
                        <Lock aria-hidden className="size-icon-xs text-text-tertiary" />
                      )}
                      {n}
                    </Chip>
                  ))}
                </span>
              </span>
            ))}
          </Band>
        </div>

        <aside aria-labelledby="eff" className="grid content-start gap-2 self-start pt-1">
          <div className="grid gap-0.5">
            <h2 id="eff" className="m-0 text-ui-sm font-semibold text-text-primary">
              실효 스택
            </h2>
            <span className="text-ui-xs text-text-tertiary">
              {ctx === null ? "대화를 고르면 계산해요" : `${ctx}에 적용하면`}
            </span>
          </div>
          <ListDescription variant="ghost" size="xs">
            {changed.map((i) => (
              <ListDescriptionRow key={i.name} term={i.name}>
                <span className="inline-flex items-center gap-1">
                  <span className="text-text-tertiary">{NOW[i.now]}</span>
                  <ArrowRight aria-hidden className="size-icon-xs text-text-tertiary" />
                  {after(i, picks[i.name] ?? "keep")}
                </span>
              </ListDescriptionRow>
            ))}
            <ListDescriptionRow term="drive">helm · 그대로</ListDescriptionRow>
            <ListDescriptionRow term="ext.helm.maxLenses">
              <span className="inline-flex items-center gap-1">
                <span className="text-text-tertiary">3</span>
                <ArrowRight aria-hidden className="size-icon-xs text-text-tertiary" />4
              </span>
            </ListDescriptionRow>
            <ListDescriptionRow term="켜지는 훅">on 9 · drive 1</ListDescriptionRow>
          </ListDescription>
          <p className="m-0 text-ui-xs text-text-tertiary">
            그대로인 {all.length - changed.length}개는 대화 값을 건드리지 않아요. 켜기·끄기는 다음
            단계 경계에 적용돼요.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button
              size="sm"
              tone="accent"
              variant="solid"
              disabled={ctx === null}
              onClick={() => m.notify("다음 단계 경계에 적용해요")}
            >
              이 대화에 적용
            </Button>
            <Button
              size="sm"
              variant="soft"
              iconStart={<FlaskConical />}
              onClick={() => m.notify("테스트 대화를 만들고 적용했어요")}
            >
              테스트 대화로
            </Button>
            <Button size="sm" variant="ghost" onClick={() => m.notify("저장했어요")}>
              저장
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
