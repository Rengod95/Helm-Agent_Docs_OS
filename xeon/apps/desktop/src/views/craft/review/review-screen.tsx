// Craft 내비 "리뷰"(C5). 플러그인의 설치·갱신·드래프트 승인·제거가 모두 이 화면을 지난다(CLI는 배포하지 않는다).
// 릴리스 빌드는 가 판(목록 + 상세)으로 실제 엔진을 보인다. 개발 빌드는 판 전환기와 표본 장면(`review-dev.tsx`)을 얹는다.
import { lazy, Suspense, type ReactNode } from "react";
import { BUILD_CHECKS } from "../../../app/build.ts";
import { useReviewSource } from "./review-source.ts";
import { ReviewView } from "./review-view.tsx";

const ReviewDev = BUILD_CHECKS
  ? lazy(() => import("./review-dev.tsx").then((m) => ({ default: m.ReviewDev })))
  : null;

export function ReviewScreen(): ReactNode {
  const live = useReviewSource();
  if (ReviewDev === null) {
    return (
      <div className="rv-root flex min-h-0 flex-1 flex-col">
        <ReviewView data={live} layout="split" />
      </div>
    );
  }
  return (
    <Suspense fallback={null}>
      <ReviewDev live={live} />
    </Suspense>
  );
}
