// Craft 목적 화면 "트레이스"(C8). 내비 항목이 아니다: 메트릭의 근거 줄, 대화의 "이 턴 기록"이 턴을 정하고 이 화면으로 옮긴다.
// 출시 빌드는 실제 엔진만 보인다. 개발 빌드는 표본 장면 고르기(`trace-dev.tsx`)를 얹는다.
import { lazy, Suspense, type ReactNode } from "react";
import { BUILD_CHECKS } from "../../../app/build.ts";
import { useTraceSource } from "./source.ts";
import { TraceView } from "./trace-view.tsx";

const TraceDev = BUILD_CHECKS
  ? lazy(() => import("./trace-dev.tsx").then((m) => ({ default: m.TraceDev })))
  : null;

export function CraftTraceScreen(): ReactNode {
  const live = useTraceSource();
  if (TraceDev === null) return <TraceView data={live} />;
  return (
    <Suspense fallback={null}>
      <TraceDev live={live} />
    </Suspense>
  );
}
