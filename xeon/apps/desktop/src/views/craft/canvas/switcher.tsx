// 시안 전환기(AGE-31, 개발 빌드만). 캔버스 위 오른쪽 끝의 작은 메뉴 "시안 G5"(리뷰 화면의 표본 메뉴와 같은 부품·모양:
// ghost 단추 md + 플라스크·아래 꺾쇠, 메뉴는 끝 맞춤 sm, 고른 칸에 체크, 오른쪽에 키). 캔버스에는 화면 머리가 없으므로
// 왼쪽 위 프로필 요약 띠와 같은 높이(위 12, 높이 40)의 유리 띠에 담아 오른쪽 위에 둔다. 왼쪽 아래 구석은 옆 내비의 설정 줄과
// 아래쪽 띠("다시 시작 대기")에 겹쳐 글자가 가려졌다.
// 메뉴의 묶음: 이번 판 G5, 앞선 판 G4·G3·G2·F·G·H, 첫 판 A~E(비교용), 그리고 지금 화면.
// 키보드 1은 G5, 2는 G4, 3은 G3, 4는 G2, 5~7은 F·G·H, 8~9는 A~B, 0은 지금 화면.
// 고른 값은 localStorage에 남아 다시 열어도 그대로다(찍기 도구도 이 키를 미리 정한다). 앞 판의 키와 따로 두어 여섯째 판 빌드는 G5로 처음 연다.
// 글자 입력 중에는 숫자 키를 가로채지 않는다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { attempt } from "@fresnel/contracts";
import { Button, Kbd, Menu, MenuGroup, MenuHeading, MenuItem, MenuSeparator } from "@caustic/react";
import { Check, ChevronDown, FlaskConical } from "@caustic/react/icons";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { HEADER_CONTROL_SIZE } from "../../shell/screen-header.tsx";
import { CANVAS_DESIGNS, type CanvasDesign } from "./registry.tsx";

const KEY = "fresnel.craft.canvasDesign.round6";
const CURRENT = "current";

function readKey(): string | null {
  const read = attempt(() => localStorage.getItem(KEY));
  return read.ok ? read.value : null;
}

/** 고른 적이 없으면 첫 칸(여섯째 판의 G5)으로 연다 */
function stored(): string {
  const value = readKey();
  if (value !== null && (value === CURRENT || CANVAS_DESIGNS.some((d) => d.id === value)))
    return value;
  return CANVAS_DESIGNS[0]?.id ?? CURRENT;
}

function remember(id: string): void {
  // 저장이 막힌 창(개인 창, 미리 보기)에서는 이번 실행에만 남는다
  attempt(() => {
    localStorage.setItem(KEY, id);
  });
}

/** 글을 넣는 자리에 초점이 있으면 숫자 키는 그 자리의 것이다 */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable || target.closest("input, textarea, select, [role='textbox']") !== null
  );
}

/** 메뉴의 묶음: 이번 판(여섯째), 앞선 판(둘째~다섯째), 첫 판 */
const BANDS: readonly {
  readonly heading: MessageId;
  readonly has: (round: CanvasDesign["round"]) => boolean;
}[] = [
  { heading: "desktop.craft.canvas.band.latest", has: (r) => r >= 6 },
  { heading: "desktop.craft.canvas.band.earlier", has: (r) => r >= 2 && r < 6 },
  { heading: "desktop.craft.canvas.band.first", has: (r) => r === 1 },
];

/** 메뉴 줄의 이름(화면 낭독용): 글자와 이름. 화면에는 둘을 가운뎃점 없이 두 칸으로 나눠 그린다(`RowLabel`) */
function rowName(d: CanvasDesign): string {
  return `${d.letter} ${t(d.name)}`;
}

/** 메뉴 줄의 글: 글자 칸(폭 고정, 모든 줄의 이름이 같은 세로줄에서 시작한다)과 이름 */
function RowLabel(props: { readonly letter: string; readonly name: string }): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="w-6 shrink-0 text-text-tertiary tabular-nums">{props.letter}</span>
      <span className="min-w-0 truncate">{props.name}</span>
    </span>
  );
}

/** 키보드 숫자(1~9, 그다음은 없음) */
function keyOf(index: number): string | null {
  return index < 9 ? String(index + 1) : null;
}

export function CanvasDesigns(props: { readonly current: ReactNode }): ReactNode {
  const [choice, setChoice] = useState(stored);
  const bar = useRef<HTMLDivElement>(null);
  // 시안 안의 위 오른쪽 줄(플러그인 안의 테스트 런·맞춤 단추)이 이 띠 밑에 깔리지 않게, 띠의 폭 + 사이 8을
  // `--canvas-switcher-room`으로 알린다. 시안은 `right: calc(var(--canvas-switcher-room, 0px) + 12px)`로 비킨다(띠가 없는 출시 빌드는 0)
  useEffect(() => {
    const el = bar.current;
    const host = el?.parentElement ?? null;
    // ResizeObserver는 observe 직후 한 번 부르므로 처음 값도 이것이 적는다
    const watch =
      el === null || host === null || typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            host.style.setProperty("--canvas-switcher-room", `${String(el.offsetWidth + 8)}px`);
          });
    if (el !== null) watch?.observe(el);
    return () => {
      watch?.disconnect();
    };
  }, []);
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
  const shown = design?.letter ?? t("desktop.craft.canvas.current");
  const row = (id: string, label: ReactNode, key: string | null): ReactNode => (
    <MenuItem
      key={id}
      role="menuitemradio"
      selected={id === (design?.id ?? CURRENT)}
      icon={id === (design?.id ?? CURRENT) ? <Check /> : <span className="size-4" />}
      end={key === null ? undefined : <Kbd size="sm">{key}</Kbd>}
      onSelect={() => {
        choose(id);
      }}
    >
      {label}
    </MenuItem>
  );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {design === undefined ? props.current : <design.Screen key={design.id} />}
      {/* 캔버스 위 오른쪽: 왼쪽 위 프로필 요약 띠와 같은 높이의 유리 띠. 상세 판(위 56부터)과 겹치지 않는다 */}
      <div
        ref={bar}
        data-canvas-switcher=""
        className="glass glass-shadow-3 rounded-toolbar absolute top-3 right-3 z-40 flex h-10 items-center px-1"
      >
        <Menu
          align="end"
          size="sm"
          trigger={
            <Button
              size={HEADER_CONTROL_SIZE}
              variant="ghost"
              aria-label={`${t("desktop.craft.canvas.pick")}: ${design === undefined ? shown : rowName(design)}`}
              iconStart={<FlaskConical />}
              iconEnd={<ChevronDown />}
              className="text-text-secondary"
            >
              {t("desktop.craft.canvas.trigger", { design: shown })}
            </Button>
          }
        >
          {BANDS.map((band, i) => (
            <Fragment key={band.heading}>
              {i > 0 ? <MenuSeparator /> : null}
              <MenuGroup>
                <MenuHeading>{t(band.heading)}</MenuHeading>
                {CANVAS_DESIGNS.map((d, index) =>
                  band.has(d.round)
                    ? row(d.id, <RowLabel letter={d.letter} name={t(d.name)} />, keyOf(index))
                    : null,
                )}
              </MenuGroup>
            </Fragment>
          ))}
          <MenuSeparator />
          <MenuGroup>
            {row(CURRENT, <RowLabel letter="" name={t("desktop.craft.canvas.current")} />, "0")}
          </MenuGroup>
        </Menu>
      </div>
    </div>
  );
}
