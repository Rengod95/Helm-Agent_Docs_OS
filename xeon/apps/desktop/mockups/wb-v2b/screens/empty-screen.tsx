// 빈 상태 "첫 플러그인": 내장(코어, L2 기능, 학습)만 있는 지도. L3 lane 맨 위에 점선 자리와 세 단계 안내,
// 그 자리에서 소켓으로 가는 유령 선이 "그룹을 꽂으면 어디에 이어지는지"를 미리 보인다. 새 그룹은 구성기에서(결정 6).
import { Button } from "@caustic/react";
import { Compass, Download, Plus } from "../../_shell";
import { COL, WORLD, leaseAnchor, postAnchor, socketAnchor } from "../data";
import { hPath, PortGlyph, Wire } from "../parts/kit";
import { RuntimeMap } from "../parts/map";
import { Viewport } from "../parts/viewport";
import { useMock } from "../store";

const VISIBLE = new Set(["core", "web", "knowledge", "work", "dialog", "learning"]);
const SLOT = { x: COL.B.x, y: 40, w: COL.B.w, h: 180 };

export function EmptyScreen() {
  const m = useMock();
  const from = (dy: number) => ({ x: SLOT.x + SLOT.w + 27, y: SLOT.y + dy });
  const steps: [string, string, "cap" | "on" | "drive"][] = [
    ["설치", "새 그룹을 만들거나 가져와요", "cap"],
    ["꽂기", "포트가 훅 소켓에 이어져요", "on"],
    ["켜기", "대화에서 켜면 경계부터 돌아요", "drive"],
  ];
  return (
    <Viewport
      label="런타임 지도 · 빈 상태"
      world={WORLD}
      pad={[56, 24, 20, 28]}
      minK={0.82}
      anchor="center"
      crumbs={[
        {
          label: "런타임 지도",
          icon: <Compass className="size-3.5 text-text-tertiary" emphasis="muted" />,
        },
      ]}
      crumbMeta="내장 6 · 그룹 1"
    >
      <RuntimeMap
        selected={null}
        hover={null}
        mode="normal"
        onSelect={() => {}}
        onHover={() => {}}
        onOpenGroup={() => {}}
        visible={VISIBLE}
      >
        <svg
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
          width={WORLD.w}
          height={WORLD.h}
          aria-hidden
        >
          <Wire
            d={hPath(from(70), socketAnchor("input.agent.before"))}
            type="on"
            look="ghost"
            width={1.25}
          />
          <Wire
            d={hPath(from(70), socketAnchor("tool.call.before"))}
            type="on"
            look="ghost"
            width={1.25}
          />
          <Wire d={hPath(from(98), postAnchor)} type="post" look="ghost" width={1.25} />
          <Wire d={hPath(from(126), leaseAnchor)} type="drive" look="ghost" width={1.5} />
        </svg>
        <div
          className="absolute flex flex-col gap-2 rounded-[12px] p-3"
          style={{
            left: SLOT.x,
            top: SLOT.y,
            width: SLOT.w,
            height: SLOT.h,
            background: "color-mix(in oklab, var(--cs-color-surface-base) 70%, transparent)",
            outline: "1.5px dashed var(--cs-color-border-strong)",
            outlineOffset: -1.5,
          }}
        >
          <span className="text-[13px] font-semibold text-text-primary">
            첫 그룹을 여기에 꽂아요
          </span>
          <ol className="flex flex-col gap-1.5 pe-6">
            {steps.map(([t, d, p], i) => (
              <li key={t} className="flex items-start gap-2">
                <span className="mt-px grid size-4 flex-none place-items-center rounded-full bg-neutral-track font-mono text-[9.5px] text-text-secondary">
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1 text-[11.5px] text-text-primary">
                    {t}
                    <PortGlyph type={p} size={7} />
                  </span>
                  <span className="text-[10.5px] leading-[14px] text-text-tertiary">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-auto flex gap-1.5">
            <Button
              size="xs"
              tone="neutral"
              variant="solid"
              iconStart={<Plus />}
              onClick={() => m.set({ screen: "group", composer: true })}
            >
              새 그룹
            </Button>
            <Button
              size="xs"
              tone="neutral"
              variant="soft"
              iconStart={<Download />}
              onClick={() => m.notify("폴더에서 가져와요")}
            >
              가져오기
            </Button>
          </div>
        </div>
        {/* 슬롯의 출력 포트 미리보기 */}
        {[
          [70, "on", "on"],
          [98, "post", "post"],
          [126, "drive", "drive"],
        ].map(([dy, t, l]) => (
          <span
            key={l as string}
            className="absolute flex h-4 -translate-y-1/2 items-center gap-1 rounded-full bg-surface-base px-1.5 opacity-80 shadow-[0_0_0_1px_var(--block-edge)]"
            style={{ left: SLOT.x + SLOT.w - 27, top: SLOT.y + (dy as number), width: 54 }}
          >
            <span className="flex-1 font-mono text-[9.5px] text-text-tertiary">{l as string}</span>
            <PortGlyph type={t as "on"} size={7} hollow />
          </span>
        ))}
      </RuntimeMap>
    </Viewport>
  );
}
