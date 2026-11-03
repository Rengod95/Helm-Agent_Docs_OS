// 웹 클라이언트의 브라우저 틀(목업 전용, e05-web-narrow/parts/web.tsx의 BrowserFrame을 옮김). 탭·주소 줄은 브라우저 것이라 앱 화면이 아니다.
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, L2, Lock, RotateCw } from "../../_shell";

const SERVICE = "https://build-box.local:7420";

export function BrowserFrame({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="presentation"
        aria-label={L2("목업 전용 브라우저 틀", "Mockup browser frame")}
        className="grid flex-none bg-bg-inset text-ui-xs text-text-secondary"
      >
        <div className="flex h-8 items-end gap-1 px-2">
          <span className="flex h-7 min-w-0 max-w-56 items-center gap-1.5 rounded-t-lg bg-bg-app px-3 text-text-primary">
            <span aria-hidden className="size-2 flex-none rounded-full bg-neutral-graphic" />
            <span className="truncate">{title}</span>
          </span>
        </div>
        <div className="flex h-9 items-center gap-2 bg-bg-app px-2">
          <ChevronLeft aria-hidden className="size-icon-sm text-text-tertiary" />
          <ChevronRight aria-hidden className="size-icon-sm text-text-tertiary" />
          <RotateCw aria-hidden className="size-icon-sm text-text-tertiary" />
          <span className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-bg-inset px-3">
            <Lock aria-hidden className="size-icon-xs flex-none text-text-tertiary" />
            <span className="truncate font-mono text-mono-sm text-text-secondary">{SERVICE}/</span>
          </span>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col border-t border-border-subtle">
        {children}
      </div>
    </div>
  );
}
