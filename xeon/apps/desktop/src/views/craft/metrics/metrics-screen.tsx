// Craft 내비 "메트릭"(C9). 출시 빌드는 실제 엔진을 보인다(그림 칸 + 오른쪽 인사이트 열).
// 개발 빌드는 표본 장면 고르기(`metrics-dev.tsx`)를 얹는다(표본은 출시 빌드에 들지 않는다).
import { lazy, Suspense, type ReactNode } from "react";
import { BUILD_CHECKS } from "../../../app/build.ts";
import { MetricsView } from "./metrics-view.tsx";
import { useMetricsSource } from "./source.ts";

const MetricsDev = BUILD_CHECKS
  ? lazy(() => import("./metrics-dev.tsx").then((m) => ({ default: m.MetricsDev })))
  : null;

export function CraftMetricsScreen(): ReactNode {
  const live = useMetricsSource();
  if (MetricsDev === null) return <MetricsView data={live} />;
  return (
    <Suspense fallback={null}>
      <MetricsDev live={live} />
    </Suspense>
  );
}
