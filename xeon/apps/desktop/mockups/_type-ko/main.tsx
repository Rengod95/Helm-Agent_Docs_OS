// 한글 타이포 견본 (DP-11): caustic 글자 역할 × 잉크 단계를 ko와 en으로 나란히. ?theme=light|dark.
// 폰트는 @caustic/tokens/fonts.css(Geist, Newsreader, Noto Sans KR, Noto Serif KR)를 맨 먼저 가져온다.
import "@caustic/tokens/fonts.css";
import "./specimen.css";
import { createRoot } from "react-dom/client";

const p = new URLSearchParams(window.location.search);
document.documentElement.dataset["theme"] = p.get("theme") === "dark" ? "dark" : "light";

const ROLES = [
  "display",
  "title-1",
  "title-2",
  "title-3",
  "title-4",
  "body",
  "ui-lg",
  "ui-strong",
  "ui",
  "ui-sm",
  "footnote",
  "label",
  "caption",
  "hint",
  "voice",
  "thought",
  "mono",
] as const;

const KO: Record<string, string> = {
  display: "대화를 시작하세요",
  "title-1": "새 작업 공간 만들기",
  "title-2": "저장소 연결과 권한",
  "title-3": "최근 대화 기록",
  "title-4": "도구 실행 승인",
  caption: "최근 항목",
  thought: "사용자가 요청한 변경 범위를 먼저 확인해야 한다.",
  mono: "bun run mockup:build — 완료 1.8초",
};
const EN: Record<string, string> = {
  display: "Start a conversation",
  "title-1": "Create a new workspace",
  "title-2": "Repository access",
  "title-3": "Recent conversations",
  "title-4": "Approve tool run",
  caption: "Recent items",
  thought: "First check the scope of the change the user asked for.",
  mono: "bun run mockup:build — done 1.8s",
};
const KO_TEXT = "에이전트가 파일 3개를 읽고 테스트를 실행했습니다. 변경 사항을 검토하세요.";
const EN_TEXT = "The agent read 3 files and ran the tests. Review the changes.";

const INKS = ["text-primary", "text-secondary", "text-tertiary", "text-placeholder"] as const;
const WEIGHTS = [400, 500, 600, 700] as const;

function Sample({ role, lang }: { role: string; lang: "ko" | "en" }) {
  const t = lang === "ko" ? (KO[role] ?? KO_TEXT) : (EN[role] ?? EN_TEXT);
  const cls =
    role === "voice" || role === "thought"
      ? `text-${role} font-voice`
      : role === "mono"
        ? "text-mono font-mono"
        : `text-${role} font-ui`;
  return (
    <div
      lang={lang}
      className={`${cls} ${role === "caption" ? "uppercase" : ""} ${role === "thought" ? "italic" : ""} truncate`}
    >
      {t}
    </div>
  );
}

function App() {
  return (
    <div className="min-h-screen bg-bg-app text-text-primary p-8">
      <div className="text-mono font-mono text-text-tertiary mb-4">
        caustic 한글 타이포 견본 · {document.documentElement.dataset["theme"]}
      </div>
      <section className="grid grid-cols-[96px_1fr_1fr] gap-x-6 gap-y-2 items-baseline">
        {ROLES.map((r) => (
          <div key={r} className="contents">
            <div className="text-mono-sm font-mono text-text-tertiary">{r}</div>
            <Sample role={r} lang="ko" />
            <Sample role={r} lang="en" />
          </div>
        ))}
      </section>
      <section className="mt-8 grid grid-cols-[96px_1fr_1fr] gap-x-6 gap-y-1.5 items-baseline">
        {INKS.map((ink) => (
          <div key={ink} className="contents">
            <div className="text-mono-sm font-mono text-text-tertiary">
              {ink.replace("text-", "")}
            </div>
            <div lang="ko" className={`text-ui font-ui text-${ink} truncate`}>
              <span className="font-semibold">도구 실행</span> {KO_TEXT}
            </div>
            <div lang="en" className={`text-ui font-ui text-${ink} truncate`}>
              <span className="font-semibold">Tool run</span> {EN_TEXT}
            </div>
          </div>
        ))}
      </section>
      <section className="mt-8 grid grid-cols-[96px_1fr_1fr] gap-x-6 gap-y-1.5 items-baseline">
        {WEIGHTS.map((w) => (
          <div key={w} className="contents">
            <div className="text-mono-sm font-mono text-text-tertiary">ui {w}</div>
            <div lang="ko" className="text-ui-lg font-ui truncate" style={{ fontWeight: w }}>
              대화 기록 설정 권한 승인 작업 공간 1,234개
            </div>
            <div lang="en" className="text-ui-lg font-ui truncate" style={{ fontWeight: w }}>
              Conversation history settings 1,234 items
            </div>
          </div>
        ))}
      </section>
      <section lang="ko" className="mt-8 max-w-[640px] rounded-lg bg-surface-base p-5">
        <div className="text-title-3 font-ui">저장소 정리 작업</div>
        <div className="text-footnote font-ui text-text-tertiary mb-2">
          3분 전 · Opus · 파일 12개
        </div>
        <p className="text-body font-ui m-0 mb-2">
          요청하신 대로 <span className="font-medium">packages/tokens</span>의 글자 간격을 한국어에
          맞게 조정했습니다. 영문 Geist와 섞여도 줄이 고르게 보이도록 했고, React 컴포넌트는 바꾸지
          않았습니다.
        </p>
        <p className="text-ui font-ui text-text-secondary m-0">
          보조 설명: 변경 내용은 빌드 검사를 통과했습니다.
        </p>
      </section>
    </div>
  );
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
