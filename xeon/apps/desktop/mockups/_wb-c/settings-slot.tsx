// settings slot(N-25, ADR-0021 §3.2): 확장 설정 구역의 스키마 필드 아래에 확장이 그린 읽기 전용 부품 하나(확장당 1, declarative만).
// 셸이 그리는 것: 머리 한 줄(확장 이름 연한 글 + "읽기 전용"), 상태 자리표시(읽는 중, 그리지 못함), 오류 경계.
// 플러그인 트리는 그 아래에서 같은 부품·토큰·밀도로 그려진다(DP-22). 입력 부품은 없다: 값을 바꾸는 것은 위 스키마 필드뿐이다.
// 경계는 간격과 연한 머리 글로만 드러낸다(선·상자 없음, DP-42).
// summary="grid"는 요약을 선 격자 지표 칸(LineGridBlock·LineGridMetric, 옛 언어 이식)으로 그린다. 기본은 옛 ListDescription이라
// 옛 화면(c02·c04)의 모습이 그대로 남는다.
import { Button, ListDescription, ListDescriptionRow, Skeleton } from "@caustic/react";
import { extJ, extName, LineGridBlock, LineGridMetric, T } from "../_shell";

export type SlotState = "ok" | "loading" | "invalid";

export function SettingsSlot({
  ext = "helm",
  state = "ok",
  summary = "list",
  onOpenPage,
}: {
  ext?: string;
  state?: SlotState;
  summary?: "list" | "grid";
  onOpenPage?: () => void;
}) {
  return (
    <section
      aria-label={`${extJ(ext, "이", "가")} 그린 ${T.slotSettings} 부분`}
      className="grid gap-1 pt-3"
    >
      <div className="flex min-w-0 items-baseline gap-2 text-ui-xs text-text-tertiary">
        <span>{extJ(ext, "이", "가")} 그린 부분</span>
        <span>· 읽기 전용</span>
      </div>
      {state === "loading" ? (
        <div aria-busy="true" className="grid gap-1.5 py-1">
          <Skeleton height={12} width="40%" />
          <Skeleton height={12} width="28%" />
        </div>
      ) : state === "invalid" ? (
        <p className="m-0 text-ui-sm text-text-secondary">이 부분을 그리지 못했어요</p>
      ) : (
        <>
          {summary === "grid" ? (
            <LineGridBlock columns={3} marks={false} aria-label={`${extName(ext)} 요약`}>
              <LineGridMetric value="4번" metricLabel={`이번 주 ${T.inquiry}`} />
              <LineGridMetric value="2번" metricLabel="적용" />
              <LineGridMetric value="3.2개" metricLabel={`${T.lens} 평균`} />
              <LineGridMetric
                value="실패 사례, 기본 원리"
                metricLabel={`자주 쓴 ${T.lens}`}
                className="col-span-3"
              />
            </LineGridBlock>
          ) : (
            <ListDescription
              variant="ghost"
              size="xs"
              aria-label={`${extName(ext)} 요약`}
              className="max-w-[28rem] rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0"
            >
              <ListDescriptionRow term={`이번 주 ${T.inquiry}`}>4번 · 적용 2</ListDescriptionRow>
              <ListDescriptionRow term={`${T.lens} 평균`}>3.2개 · 최대 설정 4</ListDescriptionRow>
              <ListDescriptionRow term="자주 쓴 렌즈">실패 사례, 기본 원리</ListDescriptionRow>
            </ListDescription>
          )}
          {onOpenPage !== undefined && (
            <Button size="xs" variant="ghost" className="-ms-2 w-fit" onClick={onOpenPage}>
              {extName(ext)} {T.inquiry} 화면 열기
            </Button>
          )}
        </>
      )}
    </section>
  );
}
