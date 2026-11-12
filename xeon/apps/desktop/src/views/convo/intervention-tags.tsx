import { Button, Popover, PopoverDescription, PopoverTitle } from "@caustic/react";
import { Eye, KeyRound, Shield, ShieldCheck, WandSparkles } from "@caustic/react/icons";
import { assertNever } from "@fresnel/contracts";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { useOpenExtensionRecords } from "../extension-records-link.ts";
import type { InterventionTag, TagIcon } from "./intervention-model.ts";

// 개입 꼬리표(dzT2a 시안 5절). 높이 20, 반경 5, 글 12, 아이콘 12. 누르면 위로 여는 팝오버에 사유와 "기록 보기".

const SHOWN = 3;

function TagGlyph(props: { readonly icon: TagIcon }): ReactNode {
  switch (props.icon) {
    case "wand":
      return <WandSparkles aria-hidden />;
    case "shield":
      return <Shield aria-hidden />;
    case "eye":
      return <Eye aria-hidden />;
    case "key":
      return <KeyRound aria-hidden />;
    case "approval":
      return <ShieldCheck aria-hidden />;
    default:
      return assertNever(props.icon, "TagIcon");
  }
}

function Tag(props: { readonly tag: InterventionTag }): ReactNode {
  const openRecords = useOpenExtensionRecords();
  const { tag } = props;
  const extension = tag.extension;
  return (
    <Popover
      size="sm"
      side="top"
      align="start"
      anchor={
        <button
          type="button"
          className="convo-tag"
          data-tone={tag.tone}
          aria-label={`${tag.title}: ${tag.label}`}
          onClick={(event) => {
            // 꼬리표를 눌러도 줄이 펼쳐지지 않는다
            event.stopPropagation();
          }}
        >
          <TagGlyph icon={tag.icon} />
          {tag.label}
        </button>
      }
    >
      <div className="grid max-w-70 gap-1">
        <PopoverTitle>{tag.title}</PopoverTitle>
        {tag.body === "" ? null : <PopoverDescription>{tag.body}</PopoverDescription>}
        {extension === null ? null : (
          <p className="m-0 font-mono text-footnote text-text-tertiary">{extension}</p>
        )}
        {extension === null || openRecords === null ? null : (
          <div className="-mx-1.5 mt-1">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                openRecords(extension);
              }}
            >
              {t("desktop.item.hookDenial.records")}
            </Button>
          </div>
        )}
      </div>
    </Popover>
  );
}

/** 꼬리표 줄. 셋을 넘으면 "+N" */
export function InterventionTags(props: { readonly tags: readonly InterventionTag[] }): ReactNode {
  if (props.tags.length === 0) return null;
  const shown = props.tags.slice(0, SHOWN);
  const rest = props.tags.length - shown.length;
  return (
    <>
      {shown.map((tag) => (
        <Tag key={tag.key} tag={tag} />
      ))}
      {rest > 0 ? (
        <span className="convo-line-meta">{t("desktop.convo.tag.more", { count: rest })}</span>
      ) : null}
    </>
  );
}
