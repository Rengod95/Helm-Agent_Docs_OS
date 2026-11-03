// 구성기(크래프트 "구성", 구성·만들기를 합침 — 사용자 결정 6): 부품 · 흐름 · 프로필 세 보기를 같은 시각 언어로. "새 그룹"은 머리 동작.
// 테스트 실행은 흐름 보기의 상태: 위에 주도 사용량과 "다음 경계에서 멈춤"(결정 9) · "한 경계씩".
import { Button, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { ChevronRight as SkipForward, Copy, Pause, Play, Plus } from "../../_shell";
import { WorkbenchHead } from "../../_shell";
import { useMock, type ComposeView } from "../store";
import { Meter, Viewport } from "../parts/kit";
import { CW, ComposeParts } from "./compose-parts";
import { ComposeFlow, FW } from "./compose-flow";
import { ComposeProfile } from "./compose-profile";

export function ComposeScreen() {
  const m = useMock();
  const v = m.composeView;
  const title = v === "profile" ? "프로필 · 탐구 중심" : "Helm";
  const meta =
    v === "parts"
      ? "참고 구성 · 읽기 전용 · 부품 7 · 소켓 6 · 기능 6"
      : v === "flow"
        ? m.trial
          ? "테스트 대화 helm 렌즈 5개 · 실행 중 1:12"
          : "단계 머신 · 단계 4 · 주도 상한 턴 4 · spawn 8 · 토큰 400k"
        : "켜기 2 · 끄기 2 · 설정 1";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkbenchHead
        className="w-full px-3"
        title={
          <span className="inline-flex items-baseline gap-2">
            구성 <span className="text-ui-strong text-text-secondary">{title}</span>
          </span>
        }
        meta={meta}
        actions={
          <span className="flex items-center gap-1.5">
            {v !== "profile" && !m.trial && (
              <Button
                size="xs"
                variant="ghost"
                iconStart={<Copy />}
                onClick={() => m.notify("lens-review로 복제했어요")}
              >
                복제해서 고치기
              </Button>
            )}
            {!m.trial && (
              <Button
                size="xs"
                variant="soft"
                iconStart={<Plus />}
                onClick={() => m.notify("새 그룹: 이름과 템플릿을 고르세요")}
              >
                새 그룹
              </Button>
            )}
            <SegmentedControl
              size="xs"
              aria-label="구성 보기"
              value={v}
              onValueChange={(x) => m.set({ composeView: x as ComposeView, trial: false })}
            >
              <SegmentedControlItem value="parts">부품</SegmentedControlItem>
              <SegmentedControlItem value="flow">흐름</SegmentedControlItem>
              <SegmentedControlItem value="profile">프로필</SegmentedControlItem>
            </SegmentedControl>
          </span>
        }
      />
      {v === "flow" && (
        <div className="mx-3 mb-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl bg-surface-raised px-3 py-1.5 shadow-1">
          {m.trial ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-ui-sm text-text-primary">
                <span className="size-1.5 rounded-full bg-success-solid" /> 테스트 실행 중
              </span>
              <Meter label="턴" used={1} max={4} />
              <Meter label="spawn" used={3} max={8} />
              <Meter label="토큰" used={120} max={400} unit="k" />
              <span className="ms-auto flex gap-1">
                <Button
                  size="xs"
                  variant="soft"
                  iconStart={<Pause />}
                  onClick={() => m.notify("다음 단계 경계에서 멈춰요 · 주도는 유지해요")}
                >
                  다음 경계에서 멈춤
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  iconStart={<SkipForward />}
                  onClick={() => m.notify("한 경계만 진행해요")}
                >
                  한 경계씩
                </Button>
                <Button size="xs" variant="ghost">
                  replay로
                </Button>
              </span>
            </>
          ) : (
            <>
              <span className="text-ui-sm text-text-secondary">
                테스트 대화에서 돌려 보면 같은 흐름 위에 진행이 보여요
              </span>
              <Button
                size="xs"
                variant="soft"
                iconStart={<Play />}
                className="ms-auto"
                onClick={() => m.set({ trial: true, ctx: "x:lens5" })}
              >
                테스트 대화에서 돌려 보기
              </Button>
            </>
          )}
        </div>
      )}
      {v === "parts" && (
        <div className="relative flex min-h-0 flex-1 flex-col px-3">
          <Viewport w={CW.w} h={CW.h} label="Helm 부품" max={1.05}>
            <ComposeParts />
          </Viewport>
        </div>
      )}
      {v === "flow" && (
        <div className="relative flex min-h-0 flex-1 flex-col px-3">
          <Viewport w={FW.w} h={FW.h} label="Helm 흐름" max={1.05}>
            <ComposeFlow trial={m.trial} />
          </Viewport>
        </div>
      )}
      {v === "profile" && <ComposeProfile />}
    </div>
  );
}
