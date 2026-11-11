// 보조 설명을 정보 아이콘 뒤에 둔다(DP-58, DP-60, DP-78). 앱의 정보 아이콘은 이 하나다.
// 올리기, 키보드 초점, 누르기(터치 포함)로 열리고 Escape로 닫힌다.
import { t } from "@fresnel/client/i18n";
import { Popover } from "@caustic/react";
import { Info } from "@caustic/react/icons";
import { useId, useState, type ReactNode } from "react";

interface InfoTipProps {
  /** 보조 설명. 여러 문장이면 배열로 주고, 말풍선에서 한 줄씩 놓인다 */
  readonly text: string | readonly string[];
  /** 아이콘의 이름(aria-label). 기본은 "설명 보기" */
  readonly label?: string;
}

/** 말풍선에 놓을 줄. 빈 줄은 뺀다 */
export function infoLinesOf(text: string | readonly string[]): readonly string[] {
  const lines = typeof text === "string" ? [text] : text;
  return lines.filter((line) => line.trim() !== "");
}

/**
 * 정보 아이콘 하나와 그 설명. 아이콘은 14px이고 둘레에 여백·상자·바탕이 없다. 누르는 영역만 보이지 않는 `::after`로 사방 5px
 * 넓혀 24×24가 된다(글 줄의 높이와 이름표와의 간격은 바뀌지 않는다). 이름표와의 간격은 부모가 4px(`gap-1`)로 준다.
 * 설명 글은 아이콘을 열 때만 보이고, 화면 낭독기는 아이콘의 aria-describedby가 가리키는 숨은 글로 늘 듣는다.
 * 마우스는 올리면 열리고 키보드 초점으로도 열린다. 터치는 누르면 열고 다시 누르면 닫힌다. 설명은 아이콘 위 가운데에 뜬다.
 */
export function InfoTip({
  text,
  label = t("desktop.craft.infoTip.label"),
}: InfoTipProps): ReactNode {
  const id = useId();
  const [open, setOpen] = useState(false);
  const lines = infoLinesOf(text);
  if (lines.length === 0) return null;
  return (
    <>
      <Popover
        trigger="hover"
        size="xs"
        side="top"
        align="center"
        className="craft-glass"
        open={open}
        onOpenChange={setOpen}
        aria-hidden
        anchor={
          <button
            type="button"
            data-slot="info-tip"
            aria-label={label}
            aria-describedby={id}
            className="relative inline-flex size-icon-sm flex-none cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent p-0 text-text-tertiary outline-none after:absolute after:-inset-1.25 after:content-[''] hover:text-text-secondary focus-visible:focus-ring"
            // 터치에는 올리기가 없어서 누르기로 연다. 마우스 누르기는 올리기가 이미 열었으니 맡기지 않는다
            onPointerDown={(e) => {
              if (e.pointerType === "touch") setOpen(!open);
            }}
            // 키보드와 보조 기술이 누른 것(detail 0)만 연다. 마우스와 터치 누르기는 위의 처리가 맡는다
            onClick={(e) => {
              if (e.detail === 0) setOpen(true);
            }}
            // Esc는 이 설명만 닫는다. 창의 Esc 처리(뜬 패널 닫기)까지 가면 읽던 패널이 같이 닫히므로 여기서 멈춘다
            onKeyDown={(e) => {
              if (e.key === "Escape") e.stopPropagation();
            }}
          >
            <Info aria-hidden className="size-icon-sm" />
          </button>
        }
      >
        {lines.length === 1 ? (
          lines[0]
        ) : (
          <span className="grid max-w-72 gap-1 whitespace-normal">
            {lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        )}
      </Popover>
      <span id={id} className="sr-only">
        {lines.join(" ")}
      </span>
    </>
  );
}
