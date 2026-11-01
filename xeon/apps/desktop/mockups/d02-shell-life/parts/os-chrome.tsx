// 목업 전용: 앱 밖 OS 화면(N-51 메뉴 막대 아이콘·메뉴, N-52 macOS 앱 메뉴, N-53 OS 알림 배너).
// 실제로는 OS가 그린다(Tauri tray·menu·notification 플러그인). 앱 화면이 아니라는 것을 알 수 있게 "OS 화면" 표지를 달고,
// 색과 모양은 caustic 토큰만 쓴다(실제 OS 모양을 흉내 내지 않는다). 데스크톱에만 있다(웹·모바일 없음).
// 메뉴 항목의 단축키는 OS 메뉴가 스스로 그리는 것이라 여기만 보인다(DP-06은 앱 화면 규칙) — NOTES 질문 1.
import { Menu, MenuItem, MenuSeparator } from "@caustic/react";
import type { ReactNode } from "react";
import {
  Bell,
  CircleAlert,
  CircleCheck,
  Hand,
  josa,
  MessageCircleQuestion,
  T,
  X,
} from "../../_shell";

/** 앱 아이콘 대용(제품 이름 미정이라 글자 하나). */
export function AppGlyph({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={`grid place-items-center rounded-md bg-neutral-solid font-mono text-neutral-on ${
        size === "sm" ? "size-4 text-[10px]" : "size-5 text-mono-sm"
      }`}
    >
      X
    </span>
  );
}

const MAC_MENUS = ["Xeon", "파일", "편집", "보기", "대화", "창", "도움말"];

/** macOS 메뉴 막대(창 위, 화면 맨 위). open: 펼친 메뉴. tray: 오른쪽 아이콘 메뉴. */
export function MacMenuBar({
  open,
  trayOpen,
  trayBadge,
  onTray,
}: {
  open: "app" | "thread" | null;
  trayOpen: boolean;
  trayBadge: number;
  onTray: () => void;
}) {
  return (
    <div
      role="presentation"
      aria-label="OS 메뉴 막대(앱 밖)"
      className="relative z-40 flex h-6 flex-none items-center gap-3.5 bg-neutral-well px-3 text-ui-xs text-text-primary"
    >
      <span aria-hidden className="size-3 rounded-full bg-text-primary" />
      {MAC_MENUS.map((m, i) => (
        <span
          key={m}
          className={`rounded-sm px-1.5 ${i === 0 ? "font-semibold" : ""} ${
            (open === "app" && i === 0) || (open === "thread" && m === "대화")
              ? "bg-fill-hover"
              : ""
          }`}
        >
          {m}
        </span>
      ))}
      <span className="ms-auto rounded-sm px-1 text-text-tertiary">OS 화면</span>
      <button
        type="button"
        onClick={onTray}
        aria-label={`Xeon 메뉴 막대 아이콘, 승인 ${trayBadge}개`}
        className={`relative grid h-5 place-items-center rounded-sm px-1 outline-none focus-visible:focus-ring ${
          trayOpen ? "bg-fill-hover" : ""
        }`}
      >
        <AppGlyph size="sm" />
        {trayBadge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-danger-graphic" />
        )}
      </button>
      <span className="tabular-nums">11월 1일 (일) 14:06</span>
      {open === "app" && (
        <OsMenu className="left-7">
          <MenuItem>Xeon에 관하여</MenuItem>
          <MenuItem end="">업데이트 확인…</MenuItem>
          <MenuSeparator />
          <MenuItem end="⌘,">설정…</MenuItem>
          <MenuSeparator />
          <MenuItem end="⌘H">Xeon 가리기</MenuItem>
          <MenuItem end="⌥⌘H">기타 가리기</MenuItem>
          <MenuSeparator />
          <MenuItem end="⌘Q">Xeon 종료</MenuItem>
        </OsMenu>
      )}
      {open === "thread" && (
        <OsMenu className="left-[13.5rem]">
          <MenuItem end="⌘N">새 대화</MenuItem>
          <MenuItem end="⌘K">명령 찾기</MenuItem>
          <MenuSeparator />
          <MenuItem end="⌘.">중단</MenuItem>
          <MenuItem>이어서 실행</MenuItem>
          <MenuItem>분기</MenuItem>
          <MenuItem>내보내기…</MenuItem>
          <MenuSeparator />
          <MenuItem end="⌘E">작업대로</MenuItem>
          <MenuItem end="⇧⌘A">다음 승인</MenuItem>
        </OsMenu>
      )}
      {trayOpen && <TrayMenu badge={trayBadge} />}
    </div>
  );
}

function OsMenu({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div className={`absolute top-6 w-60 ${className}`}>
      <Menu inline open size="sm" aria-label="OS 메뉴">
        {children}
      </Menu>
    </div>
  );
}

/** 메뉴 막대 아이콘 메뉴(N-51): 창 다시 열기, 기다리는 승인, 진행 중, 종료. 창을 닫아도(closeBehavior=tray) 엔진과 턴은 남는다. */
export function TrayMenu({ badge }: { badge: number }) {
  return (
    <div className="absolute top-6 right-28 w-64">
      <Menu inline open size="sm" aria-label="Xeon 메뉴 막대 메뉴">
        <MenuItem>Xeon 열기</MenuItem>
        <MenuItem icon={<Hand />} end={String(badge)}>
          승인 기다림
        </MenuItem>
        <MenuItem end="1">진행 중 · 캐시 무효화 조사</MenuItem>
        <MenuSeparator />
        <MenuItem>새 대화</MenuItem>
        <MenuItem icon={<Bell />}>알림 1시간 끄기</MenuItem>
        <MenuSeparator />
        <MenuItem>업데이트 확인…</MenuItem>
        <MenuItem>Xeon 종료</MenuItem>
      </Menu>
    </div>
  );
}

export type OsKind = "approval_waiting" | "question_waiting" | "background_completed" | "error";

/** OS 알림 문구(N-53, flow §7.2). 제목 = 무엇이 · 대화, 본문 = 짧은 이유. 명령 전문·비밀은 넣지 않는다. */
export const OS_COPY: Record<OsKind, { title: string; body: string; icon: ReactNode }> = {
  approval_waiting: {
    title: "승인 필요 · 캐시 무효화 조사",
    body: "bash 실행을 기다려요(위험도 exec).",
    icon: <Hand />,
  },
  question_waiting: {
    title: "질문 · 테스트 정리",
    body: "어느 시험 묶음부터 볼까요?",
    icon: <MessageCircleQuestion />,
  },
  background_completed: {
    title: "완료 · 빌드 실패 분석",
    body: "4분 걸렸어요. 고친 파일 2개.",
    icon: <CircleCheck />,
  },
  error: {
    title: "예약 실패 · 매일 정리",
    body: "rate_limited · 10분 뒤 다시 시도해요.",
    icon: <CircleAlert />,
  },
};

/** OS 알림 배너 묶음(화면 오른쪽 위, 앱 창 밖). 누르면 원인 화면으로. */
export function OsBanners({
  kinds,
  onOpen,
  onClose,
}: {
  kinds: OsKind[];
  onOpen: (k: OsKind) => void;
  onClose: (k: OsKind) => void;
}) {
  if (kinds.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="OS 알림 미리보기(앱 밖)"
      className="fixed top-12 right-16 z-50 grid w-80 gap-2"
    >
      {kinds.map((k) => {
        const c = OS_COPY[k];
        return (
          <div
            key={k}
            role="note"
            className="grid gap-1 rounded-2xl bg-surface-raised p-3 shadow-5 animate-rise"
          >
            <div className="flex items-center gap-2 text-ui-xs text-text-tertiary">
              <AppGlyph />
              <span>Xeon · 지금</span>
              <span className="ms-auto font-mono text-mono-sm">{k}</span>
              <button
                type="button"
                aria-label="알림 닫기"
                onClick={() => onClose(k)}
                className="grid size-5 place-items-center rounded-sm outline-none hover:text-text-primary focus-visible:focus-ring [&_svg]:size-icon-xs"
              >
                <X />
              </button>
            </div>
            <button
              type="button"
              onClick={() => onOpen(k)}
              className="grid gap-0.5 rounded-md text-start outline-none focus-visible:focus-ring"
            >
              <span className="text-ui-sm font-semibold text-text-primary">{c.title}</span>
              <span className="text-ui-sm text-text-secondary">{c.body}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** 창을 닫은 뒤(closeBehavior=tray): 앱 창이 없는 바탕. 메뉴 막대 아이콘만 남는다. */
export function Desktop({ children }: { children?: ReactNode }) {
  return (
    <div className="relative grid min-h-0 flex-1 place-items-center bg-neutral-track">
      <p className="m-0 max-w-sm text-center text-ui-sm text-text-tertiary">
        창을 닫았어요(창 닫기 = 메뉴 막대에 남기). 엔진과 진행 중 {josa(T.turn, "은", "는")}{" "}
        계속돼요.
      </p>
      {children}
    </div>
  );
}
