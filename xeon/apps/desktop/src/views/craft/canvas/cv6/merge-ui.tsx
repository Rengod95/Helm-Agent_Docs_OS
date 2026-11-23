// 캔버스의 놓은 자리 고르기, 판 메뉴, 묶음에서 떼기 확인(cvMerge, AGE-72). 엔진 호출은 `merge-source.ts`, 범위는 `merge.ts`가 정한다.
// 고르기와 메뉴는 앱의 메뉴 부품(caustic `Menu`, 대화 줄 ⋯ 메뉴와 같다)이고, 놓은 점이나 판의 오른쪽 위에 선다. 키보드: 화살표, Enter, Esc.
import { t } from "@fresnel/client/i18n";
import {
  Button,
  Dialog,
  DialogClose,
  Menu,
  MenuHeading,
  MenuItem,
  MenuSeparator,
} from "@caustic/react";
import { ChevronLeft, Info, Link2, SquareStack, Unlink } from "@caustic/react/icons";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { useState, type ReactNode } from "react";
import { NoticeLine } from "../../review/review-parts.tsx";
import { PartGlyph } from "./glyphs.tsx";
import { REFUSAL_TEXT, type DropChoices, type Refusal } from "./merge.ts";

/** 화면 점 하나에 선 메뉴. 열린 채로 그리고, 닫히면 `onClose` */
function PointMenu(props: {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Menu
      open
      size="md"
      aria-label={props.label}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      className="min-w-48"
      trigger={
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-0"
          style={{ left: props.x, top: props.y }}
        />
      }
    >
      {props.children}
    </Menu>
  );
}

/** 판 위에 판을 놓은 뒤의 고르기: 합치기, 의존으로 잇기, (같은 자리면) 이 자리로 옮기기 */
export function DropPicker(props: {
  readonly x: number;
  readonly y: number;
  readonly choices: DropChoices;
  readonly onMerge: () => void;
  readonly onLink: () => void;
  readonly onMove: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const { choices } = props;
  return (
    <PointMenu
      x={props.x}
      y={props.y}
      label={t("desktop.craft.canvas.cvMerge.drop.label")}
      onClose={props.onClose}
    >
      {choices.merge ? (
        <MenuItem icon={<SquareStack />} onSelect={props.onMerge} data-drop-choice="merge">
          {t("desktop.craft.canvas.cvMerge.drop.merge")}
        </MenuItem>
      ) : null}
      {choices.link ? (
        <MenuItem icon={<Link2 />} onSelect={props.onLink} data-drop-choice="link">
          {t("desktop.craft.canvas.cvMerge.drop.link")}
        </MenuItem>
      ) : null}
      {choices.reorder ? (
        <>
          {choices.merge || choices.link ? <MenuSeparator /> : null}
          <MenuItem
            icon={<PartGlyph name="layers" size={16} />}
            onSelect={props.onMove}
            data-drop-choice="move"
          >
            {t("desktop.craft.canvas.cvMerge.drop.move")}
          </MenuItem>
        </>
      ) : null}
    </PointMenu>
  );
}

/** 판 메뉴의 한 단계: 할 일, 또는 합칠·기댈 상대 고르기 */
type MenuStep = "actions" | "merge" | "link";

export interface PlateMenuItem {
  /** 할 수 없으면 그 까닭(줄은 꺼진 채 보이고 까닭은 줄 아래 한 줄) */
  readonly refusal: Refusal | null;
  readonly partners: readonly ExtListEntry[];
}

/** 판의 ⋮ 메뉴(마우스 오른쪽 단추, Shift+F10, 메뉴 키로도 연다) */
export function PlateMenu(props: {
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly merge: PlateMenuItem;
  readonly link: PlateMenuItem;
  /** 멤버 판이면 떼기 줄. 아니면 null */
  readonly detach: { readonly refusal: Refusal | null } | null;
  readonly onOpen: () => void;
  readonly onMerge: (partner: string) => void;
  readonly onLink: (partner: string) => void;
  readonly onDetach: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const [step, setStep] = useState<MenuStep>("actions");
  const label = t("desktop.craft.canvas.cvMerge.menu.label", { name: props.name });
  if (step !== "actions") {
    const item = step === "merge" ? props.merge : props.link;
    const pick = step === "merge" ? props.onMerge : props.onLink;
    return (
      <PointMenu x={props.x} y={props.y} label={label} onClose={props.onClose}>
        <MenuItem
          icon={<ChevronLeft />}
          onSelect={(e) => {
            e.preventDefault();
            setStep("actions");
          }}
        >
          {t("desktop.craft.canvas.cvMerge.menu.back")}
        </MenuItem>
        <MenuSeparator />
        <MenuHeading>
          {t(
            step === "merge"
              ? "desktop.craft.canvas.cvMerge.menu.mergePick"
              : "desktop.craft.canvas.cvMerge.menu.linkPick",
          )}
        </MenuHeading>
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {item.partners.length === 0 ? (
            <p className="m-0 px-2 py-1 text-ui-sm text-text-tertiary">
              {t("desktop.craft.canvas.cvMerge.menu.none")}
            </p>
          ) : (
            item.partners.map((e) => (
              <MenuItem
                key={e.name}
                data-menu-partner={e.name}
                onSelect={() => {
                  pick(e.name);
                }}
              >
                <span className="font-mono text-mono-sm">{e.name}</span>
              </MenuItem>
            ))
          )}
        </div>
      </PointMenu>
    );
  }
  return (
    <PointMenu x={props.x} y={props.y} label={label} onClose={props.onClose}>
      <MenuItem icon={<Info />} onSelect={props.onOpen}>
        {t("desktop.craft.canvas.cvMerge.menu.open")}
      </MenuItem>
      <MenuSeparator />
      <RefusableItem
        icon={<SquareStack />}
        refusal={props.merge.refusal}
        word={t("desktop.craft.canvas.cvMerge.menu.merge")}
        onSelect={() => {
          setStep("merge");
        }}
        data="merge"
      />
      <RefusableItem
        icon={<Link2 />}
        refusal={props.link.refusal}
        word={t("desktop.craft.canvas.cvMerge.menu.link")}
        onSelect={() => {
          setStep("link");
        }}
        data="link"
      />
      {props.detach === null ? null : (
        <RefusableItem
          icon={<Unlink />}
          refusal={props.detach.refusal}
          word={t("desktop.craft.canvas.cvMerge.menu.detach")}
          onSelect={props.onDetach}
          keepOpen={false}
          data="detach"
        />
      )}
    </PointMenu>
  );
}

/** 메뉴 줄 하나. 할 수 없으면 꺼진 채 두고 까닭을 줄 아래 한 줄로 보인다(정보 아이콘 뒤가 아니라 보이게) */
function RefusableItem(props: {
  readonly icon: ReactNode;
  readonly refusal: Refusal | null;
  readonly word: string;
  readonly onSelect: () => void;
  /** 참이면 고른 뒤에도 메뉴가 열려 있다(다음 단계로 바뀐다) */
  readonly keepOpen?: boolean;
  readonly data: string;
}): ReactNode {
  return (
    <>
      <MenuItem
        icon={props.icon}
        disabled={props.refusal !== null}
        data-plate-menu={props.data}
        onSelect={(e) => {
          if (props.keepOpen !== false) e.preventDefault();
          props.onSelect();
        }}
      >
        {props.word}
      </MenuItem>
      {props.refusal === null ? null : (
        <p className="m-0 max-w-64 px-2 pb-1 text-ui-sm text-text-tertiary">
          {t(REFUSAL_TEXT[props.refusal])}
        </p>
      )}
    </>
  );
}

/** 묶음에서 떼기 확인: 무엇이 떨어지는지 한 줄(멤버 → 새 플러그인), 원래 쪽이 남는다는 줄, 단추 둘 */
export function DetachConfirm(props: {
  readonly target: { readonly member: string; readonly name: string } | null;
  readonly busy: boolean;
  readonly failure: string | null;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const { target } = props;
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={t("desktop.craft.canvas.cvMerge.detach.ask")}
      size="sm"
    >
      {target === null ? null : (
        <div className="grid gap-3" data-canvas-detach="">
          <p className="m-0 flex min-w-0 items-center gap-2 text-ui text-text-primary">
            <span className="min-w-0 truncate font-mono text-mono-sm">{target.member}</span>
            <span aria-hidden="true" className="shrink-0 text-text-tertiary">
              →
            </span>
            <span className="shrink-0 text-text-secondary">
              {t("desktop.craft.canvas.cvMerge.detach.new")}
            </span>
            <span className="min-w-0 truncate font-mono text-mono-sm">{target.name}</span>
          </p>
          <NoticeLine tone="info">{t("desktop.craft.canvas.cvMerge.detach.keeps")}</NoticeLine>
          {props.failure === null ? null : (
            <div role="alert">
              <NoticeLine tone="danger">{props.failure}</NoticeLine>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                {t("desktop.craft.members.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              variant="solid"
              loading={props.busy}
              onClick={props.onConfirm}
            >
              {t("desktop.craft.split.detach.confirm")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
