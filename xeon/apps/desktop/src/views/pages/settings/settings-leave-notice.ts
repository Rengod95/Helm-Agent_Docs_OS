import { useEffect, useRef } from "react";

// 설정 화면을 떠날 때(다른 화면으로 가기) 저장하지 않은 초안은 사라진다. 구역을 옮길 때와 달리 묻지 않으므로,
// 떠나는 순간 초안이 남아 있었으면 버려졌다는 것을 한 번 알린다. 알리는 방법은 호출하는 쪽이 정한다.

/** 화면이 사라질 때 초안이 `count`개 남아 있었으면 `notify(count)`를 한 번 부른다. `count`는 그릴 때마다 최신 값을 읽는다 */
export function useLeaveDiscardNotice(count: number, notify: (discarded: number) => void): void {
  const latest = useRef({ count, notify });
  useEffect(() => {
    latest.current = { count, notify };
  }, [count, notify]);
  useEffect(
    () => () => {
      if (latest.current.count > 0) latest.current.notify(latest.current.count);
    },
    [],
  );
}
