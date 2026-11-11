import { t, type MessageId } from "@fresnel/client/i18n";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { THEME_PREFS, type ThemePref } from "../../appearance-prefs.ts";

// 테마 고르기(DP-86 [결정: 2026-11-11 사용자]). 시스템·라이트·다크를 작은 창 모형 타일 셋으로 고른다(macOS 화면 모드, GitHub 테마 카드).
// 모형은 그 테마의 실제 색(caustic 토큰 값: bg.app, surface.base, border.subtle, text, accent)으로 고정해 그린다. 지금 앱 테마와 상관없이
// 라이트 타일은 늘 밝고 다크 타일은 늘 어둡다. 시스템 타일은 왼쪽 반이 라이트, 오른쪽 반이 다크다.
// 타일은 radiogroup의 radio다. ←→↑↓로 옮기며 고르고, 고른 타일만 탭 순서에 든다. caustic에 모형을 담는 고르기 부품이 없어
// (ChoiceGroup card는 고른 카드를 잉크로 뒤집는다) 맨 `<button role="radio">`를 이 파일 하나에서만 쓴다.

/** 테마마다 모형의 색(oklch). 값은 caustic `tokens.mjs`의 라이트·다크 값이다 */
const PALETTE: Readonly<
  Record<"light" | "dark", { app: string; surface: string; edge: string; ink: string; dim: string }>
> = {
  light: {
    app: "bg-[oklch(0.975_0_0)]",
    surface: "bg-[oklch(0.995_0_0)]",
    edge: "border-[oklch(0.12_0_0/0.08)]",
    ink: "bg-[oklch(0.12_0_0)]",
    dim: "bg-[oklch(0.12_0_0/0.14)]",
  },
  dark: {
    app: "bg-[oklch(0.135_0_0)]",
    surface: "bg-[oklch(0.18_0_0)]",
    edge: "border-[oklch(1_0_0/0.08)]",
    ink: "bg-[oklch(0.97_0_0)]",
    dim: "bg-[oklch(1_0_0/0.16)]",
  },
};

const LABEL: Readonly<Record<ThemePref, MessageId>> = {
  system: "desktop.settings.appearance.theme.system",
  light: "desktop.settings.appearance.theme.light",
  dark: "desktop.settings.appearance.theme.dark",
};

/** 한 테마의 작은 창: 왼쪽 막대(28%), 머리 줄, 본문 줄 셋, 잉크 점 하나 */
function Window(props: {
  readonly mode: "light" | "dark";
  readonly className?: string;
}): ReactNode {
  const c = PALETTE[props.mode];
  return (
    <div aria-hidden className={`flex h-full min-w-0 ${c.app} ${props.className ?? ""}`}>
      <div className="grid w-[28%] flex-none content-start gap-1 px-1.5 pt-2.5">
        <span className={`h-1 w-3/4 rounded-full ${c.dim}`} />
        <span className={`h-1 w-1/2 rounded-full ${c.dim}`} />
        <span className={`h-1 w-2/3 rounded-full ${c.dim}`} />
      </div>
      <div
        className={`mt-1.5 me-0 flex min-w-0 flex-1 flex-col gap-1 rounded-ss-md border-s border-t ${c.edge} ${c.surface} px-2 pt-2`}
      >
        <span className={`h-1 w-2/5 rounded-full ${c.ink}`} />
        <span className={`h-1 w-4/5 rounded-full ${c.dim}`} />
        <span className={`h-1 w-3/5 rounded-full ${c.dim}`} />
        <span className={`mt-auto mb-2 ms-auto size-2 rounded-full ${c.ink}`} />
      </div>
    </div>
  );
}

function Preview(props: { readonly theme: ThemePref }): ReactNode {
  if (props.theme === "system") {
    return (
      <div className="relative h-full">
        <Window mode="light" />
        <div className="absolute inset-y-0 end-0 w-1/2 overflow-hidden">
          <div className="absolute inset-y-0 end-0 w-[200%]">
            <Window mode="dark" />
          </div>
        </div>
      </div>
    );
  }
  return <Window mode={props.theme} />;
}

const ARROW_STEP: ReadonlyMap<string, number> = new Map([
  ["ArrowRight", 1],
  ["ArrowDown", 1],
  ["ArrowLeft", -1],
  ["ArrowUp", -1],
]);

export function ThemePicker(props: {
  readonly value: ThemePref;
  readonly onChange: (theme: ThemePref) => void;
  readonly labelId: string;
}): ReactNode {
  const refs = useRef(new Map<ThemePref, HTMLButtonElement>());
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = ARROW_STEP.get(event.key);
    if (step === undefined) return;
    event.preventDefault();
    const index = THEME_PREFS.indexOf(props.value);
    const next = THEME_PREFS[(index + step + THEME_PREFS.length) % THEME_PREFS.length];
    if (next === undefined) return;
    props.onChange(next);
    refs.current.get(next)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={props.labelId}
      data-slot="theme-picker"
      className="grid grid-cols-3 gap-3"
      onKeyDown={onKey}
    >
      {THEME_PREFS.map((theme) => {
        const checked = theme === props.value;
        return (
          <button
            key={theme}
            ref={(el) => {
              if (el === null) refs.current.delete(theme);
              else refs.current.set(theme, el);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-theme-option={theme}
            data-state={checked ? "checked" : "unchecked"}
            onClick={() => {
              props.onChange(theme);
            }}
            className="group/theme grid min-w-0 cursor-pointer gap-2 rounded-lg border-0 bg-transparent p-0 text-start outline-none"
          >
            <span
              className={`block h-18 overflow-hidden rounded-lg transition-[box-shadow] ${
                checked
                  ? "shadow-[0_0_0_2px_var(--cs-color-accent-solid)]"
                  : "shadow-[0_0_0_1px_var(--cs-color-border-default)] group-hover/theme:shadow-[0_0_0_1px_var(--cs-color-border-strong)]"
              } group-focus-visible/theme:shadow-focus`}
            >
              <Preview theme={theme} />
            </span>
            <span
              className={`text-ui ${checked ? "font-medium text-text-primary" : "text-text-secondary"}`}
            >
              {t(LABEL[theme])}
            </span>
          </button>
        );
      })}
    </div>
  );
}
