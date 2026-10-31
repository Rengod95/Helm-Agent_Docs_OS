// 확장 행의 이름 칸(§6.21 확장 행 부품 [제안] V-16의 표 칸 축약): 이름 + 층 mono 열(DP-31) + 등급 project 배지.
// 누르면 확장 상세(P-17, 1차 시안 W3)로 간다. 이 시안에는 W3가 없어 알림 한 줄로 대신한다.
import { Badge } from "@caustic/react";
import { extByName } from "../fixtures";
import { useMock } from "../store";

export function LayerTag({ layer }: { layer: string }) {
  return (
    <span className="inline-block w-10 shrink-0 font-mono text-mono-sm text-text-tertiary">
      {layer}
    </span>
  );
}

export function ExtCell({ name, link = true }: { name: string; link?: boolean }) {
  const m = useMock();
  const e = extByName(name);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      {e !== undefined && <LayerTag layer={e.layer} />}
      {link ? (
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            m.notify(`${name} 확장 상세로 가요`);
          }}
          className="min-w-0 truncate rounded-xs text-start text-text-primary outline-none hover:underline focus-visible:focus-ring"
        >
          {name}
        </button>
      ) : (
        <span className="min-w-0 truncate">{name}</span>
      )}
      {e?.trust === "project" && (
        <Badge size="xs" tone="outline">
          프로젝트
        </Badge>
      )}
    </span>
  );
}
