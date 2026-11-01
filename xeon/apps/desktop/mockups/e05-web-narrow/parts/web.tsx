// 웹 클라이언트(계획에 없음 7). 목업 전용 브라우저 틀(BrowserFrame, 탭·주소 줄은 브라우저 것이라 앱 화면이 아님)과
// 웹 첫 화면 "서비스 주소와 인증" 한 장(WebLogin). 데스크톱 셸 밖이다: 연결되기 전에는 왼쪽 패널·상태 표시줄이 없다.
import { Alert, Button, Checkbox, Field, Input } from "@caustic/react";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, L2, Lock, RotateCw, T } from "../../_shell";
import type { S } from "../flow";

export const SERVICE = "https://build-box.local:7420";

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

export function WebLogin({
  s,
  onToken,
  onConnect,
}: {
  s: S;
  onToken: (v: string) => void;
  onConnect: () => void;
}) {
  const busy = s.conn === "connecting";
  return (
    <main
      aria-label={L2(`${T.serviceAddress}와 인증`, `${T.serviceAddress} and sign-in`)}
      className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 pt-[12vh]"
    >
      <form
        className="grid w-full max-w-[22rem] gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onConnect();
        }}
      >
        <div className="grid gap-1">
          <h1 className="m-0 font-ui text-title-2 text-text-primary">Xeon</h1>
          <p className="m-0 text-ui-sm text-text-secondary">
            {L2(
              "다른 컴퓨터에서 도는 서비스에 붙어요. 대화와 승인은 그 컴퓨터에 남아요.",
              "Attach to a service running on another computer. Conversations and approvals stay there.",
            )}
          </p>
        </div>
        {s.conn === "unreachable" && (
          <Alert
            tone="danger"
            size="sm"
            actions={[{ label: L2("다시 시도", "Try again"), primary: true, onClick: onConnect }]}
          >
            {L2(
              "build-box.local:7420에 닿지 못했어요. 서비스가 꺼졌거나 같은 네트워크가 아니에요.",
              "Couldn't reach build-box.local:7420. The service is off or you're on another network.",
            )}
          </Alert>
        )}
        <Field label={T.serviceAddress}>
          <Input size="sm" value={SERVICE} readOnly className="font-mono" />
        </Field>
        <Field
          label={T.accessToken}
          hint={L2(
            "토큰은 서비스를 켠 컴퓨터의 Xeon 앱 › 연결 › 웹 접속에서 만들어요.",
            "Create a token in the Xeon app on the service computer › Connection › Web access.",
          )}
          error={
            s.conn === "authFailed"
              ? L2(
                  `토큰이 맞지 않아요. 남은 시도 ${s.left}번, 다 틀리면 10분 동안 막혀요.`,
                  `That token doesn't match. ${s.left} tries left before a 10-minute lock.`,
                )
              : undefined
          }
        >
          <Input
            size="sm"
            type="password"
            value={s.token}
            placeholder="xk_…"
            disabled={busy}
            invalid={s.conn === "authFailed"}
            onChange={(e) => onToken(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-ui-sm text-text-primary">
          <Checkbox defaultChecked />
          {L2("이 브라우저에서 30일 기억하기", "Remember on this browser for 30 days")}
        </label>
        <Button size="md" tone="neutral" variant="solid" type="submit" loading={busy}>
          {busy ? L2("연결 중…", "Connecting…") : L2("연결", "Connect")}
        </Button>
      </form>
    </main>
  );
}
