// 보조 설명 한 줄을 정보 아이콘 뒤에 둔다(DP-58). 올리기, 키보드 초점, 누르기(터치 포함)로 열리고 Escape로 닫힌다.
import { t } from "@fresnel/client/i18n";
import { IconButton, Popover } from "@caustic/react";
import { Info } from "@caustic/react/icons";
import { useId, useState, type ReactNode } from "react";

interface InfoTipProps {
  /** 보조 설명 한 문장 */
  readonly text: string;
  /** 아이콘의 이름(aria-label). 기본은 "설명 보기" */
  readonly label?: string;
}

/**
 * 정보 아이콘 하나와 그 설명. 설명 글은 화면에 늘 놓이지 않고 아이콘을 열 때만 보인다.
 * 스크린 리더는 아이콘의 aria-describedby가 가리키는 숨은 글로 설명을 늘 듣는다.
 * 마우스는 올리면 열리고, 키보드 초점으로도 열린다. 터치는 누르면 열고 다시 누르면 닫힌다.
 * Popover(올리기 방식)가 바깥 누르기와 Escape로 닫는다.
 */
export function InfoTip({
  text,
  label = t("desktop.craft.infoTip.label"),
}: InfoTipProps): ReactNode {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Popover
        trigger="hover"
        size="xs"
        className="craft-glass"
        open={open}
        onOpenChange={setOpen}
        aria-hidden
        anchor={
          <IconButton
            label={label}
            size="xs"
            variant="ghost"
            aria-describedby={id}
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
            <Info />
          </IconButton>
        }
      >
        {text}
      </Popover>
      <span id={id} className="sr-only">
        {text}
      </span>
    </>
  );
}
