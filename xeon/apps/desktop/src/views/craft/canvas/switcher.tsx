// 시안 전환기(AGE-31, 개발 빌드만). 창 왼쪽 아래(왼쪽 판의 설정 줄 옆)의 작은 칸: `G2 │ F G H │ A B C D E │ –`.
// 셋째 판 G2와 둘째 판 F·G·H가 앞에 또렷하게 서고, 첫 판 A~E는 비교용으로 흐리게 뒤에 선다. 키보드 1은 G2, 2~4는 F·G·H, 5~9는 A~E, 0은 지금 화면.
// 고른 값은 localStorage에 남아 다시 열어도 그대로다(찍기 도구도 이 키를 미리 정한다). 앞 판의 키와 따로 두어 셋째 판 빌드는 G2로 처음 연다.
// 글자 입력 중에는 숫자 키를 가로채지 않는다.
import { t } from "@fresnel/client/i18n";
import { SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { CANVAS_DESIGNS } from "./registry.tsx";

const KEY = "fresnel.craft.canvasDesign.round3";
const CURRENT = "current";

/** 고른 적이 없으면 첫 칸(셋째 판의 G2)으로 연다 */
function stored(): string {
  const value = localStorage.getItem(KEY);
  if (value !== null && (value === CURRENT || CANVAS_DESIGNS.some((d) => d.id === value)))
    return value;
  return CANVAS_DESIGNS[0]?.id ?? CURRENT;
}

function remember(id: string): void {
  localStorage.setItem(KEY, id);
}

/** 글을 넣는 자리에 초점이 있으면 숫자 키는 그 자리의 것이다 */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable || target.closest("input, textarea, select, [role='textbox']") !== null
  );
}

/** 판 사이의 가는 세로선(칸이 아니라 화면 읽기에서 빠진다) */
function Divider(): ReactNode {
  return (
    <span aria-hidden="true" className="mx-1 h-3.5 w-px shrink-0 self-center bg-border-default" />
  );
}

export function CanvasDesigns(props: { readonly current: ReactNode }): ReactNode {
  const [choice, setChoice] = useState(stored);
  const choose = (id: string): void => {
    remember(id);
    setChoice(id);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || typing(e.target)) return;
      if (!/^[0-9]$/.test(e.key)) return;
      const id = e.key === "0" ? CURRENT : CANVAS_DESIGNS[Number(e.key) - 1]?.id;
      if (id === undefined) return;
      remember(id);
      setChoice(id);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const design = CANVAS_DESIGNS.find((d) => d.id === choice);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {design === undefined ? props.current : <design.Screen key={design.id} />}
      {/* 캔버스 네 귀퉁이는 시안마다 판(자세히 보기, 확대 막대)이 쓰므로 왼쪽 판 바닥에 둔다 */}
      <div
        data-canvas-switcher=""
        className="fixed bottom-2 left-24 z-40 opacity-55 transition-opacity hover:opacity-100 focus-within:opacity-100"
      >
        <SegmentedControl
          size="xs"
          variant="ghost"
          aria-label={t("desktop.craft.canvas.pick")}
          value={design?.id ?? CURRENT}
          onValueChange={choose}
        >
          {CANVAS_DESIGNS.map((d, i) => (
            <Fragment key={d.id}>
              {i > 0 && CANVAS_DESIGNS[i - 1]?.round !== d.round ? <Divider /> : null}
              <SegmentedControlItem
                value={d.id}
                aria-label={t(d.name)}
                title={`${t(d.name)} · ${String(i + 1)}`}
                className={
                  d.round === 1
                    ? "font-mono text-text-tertiary"
                    : "font-mono font-semibold text-text-primary"
                }
              >
                {d.letter}
              </SegmentedControlItem>
            </Fragment>
          ))}
          <Divider />
          <SegmentedControlItem
            value={CURRENT}
            aria-label={t("desktop.craft.canvas.current")}
            title={`${t("desktop.craft.canvas.current")} · 0`}
            className="font-mono text-text-tertiary"
          >
            {"–"}
          </SegmentedControlItem>
        </SegmentedControl>
      </div>
    </div>
  );
}
