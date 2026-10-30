// 시안 목록(목업 전용). 페이지 목업 폴더마다 한 줄: 화면 id, 이름, 상태 수, 여는 링크와 실행 명령.
// 링크는 정적 빌드를 형제 폴더로 둘 때 열린다: MOCKUP_OUT=<dir>/<폴더>로 각 목업을 빌드하고 <dir>/index를 연다.
import { Badge, ListDescription, ListDescriptionRow } from "@caustic/react";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { loadCausticFonts } from "../_shell";
import "./mockup.css";
import { pages } from "./pages";

loadCausticFonts();

function Index() {
  useEffect(() => {
    const dark = new URLSearchParams(window.location.search).get("theme") === "dark";
    document.documentElement.dataset["theme"] = dark ? "dark" : "light";
  }, []);
  return (
    <main className="mx-auto grid h-full max-w-[44rem] content-start gap-4 overflow-auto px-4 py-8">
      <header className="grid gap-1">
        <h1 className="m-0 text-title-3 text-text-primary">데스크톱 시안</h1>
        <p className="m-0 text-ui-sm text-text-secondary">
          모든 페이지는 공용 셸(mockups/_shell) 위에 그려요.
        </p>
      </header>
      <ListDescription aria-label="시안 목록" size="sm">
        {pages.map((p) => (
          <ListDescriptionRow
            key={p.folder}
            term={
              <span className="flex items-center gap-2">
                <Badge size="xs">{p.id}</Badge>
                {p.title}
              </span>
            }
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <a
                href={`../${p.folder}/index.html`}
                className="rounded-sm text-accent-text underline underline-offset-2 outline-none focus-visible:focus-ring"
              >
                열기
              </a>
              <code className="font-mono text-mono-sm text-text-secondary">
                MOCKUP={p.folder} bun run mockup
              </code>
              <span className="text-ui-xs text-text-tertiary">상태 {p.states}개</span>
            </span>
          </ListDescriptionRow>
        ))}
      </ListDescription>
    </main>
  );
}

const root = document.getElementById("root");
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <Index />
    </StrictMode>,
  );
