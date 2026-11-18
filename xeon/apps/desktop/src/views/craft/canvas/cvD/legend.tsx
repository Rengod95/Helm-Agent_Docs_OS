// cvD 노드 문법 설명. 화면에는 그림만 두고, 읽는 법은 정보 단추 뒤에 둔다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { Popover } from "@caustic/react";
import { useState, type ReactElement } from "react";
import { DecisionGlyph, Icon, KIND_COLOR, KindBadge } from "./glyphs.tsx";
import type { Kind } from "./sample.ts";
import { KIND_WORD } from "./words.ts";

const INK = (pct: number): string =>
  `color-mix(in oklab, var(--cs-color-text-primary) ${pct}%, transparent)`;
const SHAPE: Readonly<Record<Kind, string>> = {
  inject: "8px",
  hook: "3px",
  drive: "0",
  tool: "1px",
};
const HEX = "polygon(5px 0, calc(100% - 5px) 0, 100% 50%, calc(100% - 5px) 100%, 5px 100%, 0 50%)";

function MiniShape(props: { readonly kind: Kind }): ReactElement {
  if (props.kind === "drive")
    return (
      <span
        className="relative inline-block h-3.5 w-7"
        style={{ clipPath: HEX, background: INK(40) }}
      >
        <span
          className="absolute inset-px"
          style={{ clipPath: HEX, background: "var(--cs-color-surface-raised)" }}
        />
      </span>
    );
  return (
    <span
      className="inline-block h-3.5 w-7"
      style={{
        borderRadius: SHAPE[props.kind],
        border: `1px solid ${INK(40)}`,
        background: "var(--cs-color-surface-raised)",
      }}
    />
  );
}

function Line(props: { readonly children: ReactElement; readonly text: MessageId }): ReactElement {
  return (
    <li className="flex items-center gap-2.5">
      <span className="flex w-12 shrink-0 items-center justify-center">{props.children}</span>
      <span className="text-[11.5px] text-text-secondary">{t(props.text)}</span>
    </li>
  );
}

export function Legend(): ReactElement {
  const [open, setOpen] = useState(false);
  const kinds: readonly Kind[] = ["drive", "inject", "hook", "tool"];
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      size="md"
      anchor={
        <button
          type="button"
          data-slot="cvd"
          aria-label={t("desktop.craft.canvas.cvD.legend.open")}
          className="inline-flex size-6 items-center justify-center rounded-[8px] text-text-tertiary outline-none hover:bg-[var(--cs-color-fill-hover)] hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-[var(--cs-color-focus-ring)]"
        >
          <Icon name="info" size={14} />
        </button>
      }
    >
      <div className="grid w-[300px] gap-3">
        <ul className="grid grid-cols-2 gap-x-3 gap-y-2">
          {kinds.map((k) => (
            <li key={k} className="flex items-center gap-2">
              <MiniShape kind={k} />
              <KindBadge kind={k} size={16} />
              <span className="text-[11.5px] text-text-secondary">{t(KIND_WORD[k])}</span>
            </li>
          ))}
        </ul>
        <ul className="grid gap-1.5 border-t border-border-subtle pt-3">
          <Line text="desktop.craft.canvas.cvD.legend.trunk">
            <svg width={40} height={14} aria-hidden="true">
              <path d="M2 7H38" stroke={INK(16)} strokeWidth={7} strokeLinecap="round" />
              <path d="M4 6H36" stroke={INK(42)} strokeWidth={1.25} />
            </svg>
          </Line>
          <Line text="desktop.craft.canvas.cvD.legend.hookAt">
            <svg width={40} height={14} aria-hidden="true">
              <path d="M6 7H38" stroke={INK(34)} />
              <path
                d="M6 1.5 11.5 7 6 12.5 0.5 7Z"
                fill="var(--cs-color-bg-canvas)"
                stroke={INK(70)}
                strokeWidth={1.25}
              />
            </svg>
          </Line>
          <Line text="desktop.craft.canvas.cvD.legend.feed">
            <svg width={40} height={14} aria-hidden="true">
              <path d="M8 7H38" stroke={INK(34)} />
              <path d="M2 7l6 -4v8Z" fill={INK(62)} />
              <rect x="22" y="4" width="6" height="6" fill={INK(62)} />
            </svg>
          </Line>
          <Line text="desktop.craft.canvas.cvD.legend.handoff">
            <svg width={40} height={14} aria-hidden="true">
              <path
                d="M2 4C8 4 8 1 14 1H26C32 1 32 4 38 4M38 10C32 10 32 13 26 13H14C8 13 8 10 2 10"
                fill="none"
                stroke={KIND_COLOR.drive}
                strokeWidth={1.4}
                strokeDasharray="4 3"
              />
            </svg>
          </Line>
          <Line text="desktop.craft.canvas.cvD.legend.loop">
            <svg width={40} height={14} aria-hidden="true">
              <path
                d="M38 12H8a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h28"
                fill="none"
                stroke={INK(28)}
                strokeWidth={1.5}
              />
            </svg>
          </Line>
        </ul>
        <ul className="grid gap-1.5 border-t border-border-subtle pt-3">
          <Line text="desktop.craft.canvas.cvD.legend.base">
            <svg
              width={9}
              height={10}
              viewBox="0 0 9 10"
              aria-hidden="true"
              className="text-text-tertiary"
            >
              <rect x="1" y="4.2" width="7" height="5" rx="1" fill="currentColor" />
              <path
                d="M2.6 4.2V3a1.9 1.9 0 0 1 3.8 0v1.2"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.2}
              />
            </svg>
          </Line>
          <Line text="desktop.craft.canvas.cvD.legend.draft">
            <KindBadge kind="hook" draft size={16} />
          </Line>
          <Line text="desktop.craft.canvas.cvD.legend.guard">
            <KindBadge kind="hook" guard size={16} />
          </Line>
          <Line text="desktop.craft.canvas.cvD.legend.decisions">
            <span className="flex gap-1.5 text-text-tertiary">
              <DecisionGlyph decision="block" />
              <DecisionGlyph decision="replace" />
              <DecisionGlyph decision="ask" />
            </span>
          </Line>
          <Line text="desktop.craft.canvas.cvD.legend.keys">
            <span className="font-mono text-[10px] text-text-tertiary">↵ ⌫ ⌥←→</span>
          </Line>
        </ul>
      </div>
    </Popover>
  );
}
