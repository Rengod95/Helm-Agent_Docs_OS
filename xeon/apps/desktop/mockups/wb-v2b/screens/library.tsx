// 구성기 오른쪽 well "블록" 탭: 끌어 놓을 수 있는 것. 부품 템플릿(그룹 안), 설치할 수 있는 확장(그룹 밖 제공자).
// 행마다 그 블록이 내는 포트 타입을 글리프로 미리 보여 "어디에 꽂히는지"를 고르기 전에 안다.
import { Input } from "@caustic/react";
import { FileText, GitBranch, Search, ShieldCheck, Sparkles, User } from "../../_shell";
import { PortGlyph } from "../parts/kit";
import type { PortType } from "../data";

const PARTS: {
  icon: React.ReactNode;
  label: string;
  id: string;
  ports: PortType[];
  note: string;
}[] = [
  {
    icon: <Sparkles />,
    label: "신호 감지",
    id: "signal",
    ports: ["on", "post"],
    note: "tap 지점 · 제안",
  },
  { icon: <Search />, label: "렌즈 주입", id: "lens", ports: ["on"], note: "collect" },
  { icon: <GitBranch />, label: "단계 머신", id: "drive", ports: ["drive"], note: "그룹마다 하나" },
  {
    icon: <User />,
    label: "사람 확인",
    id: "gate",
    ports: ["drive"],
    note: "임대 반납 · 승인 요청",
  },
  { icon: <ShieldCheck />, label: "쓰기 거부", id: "guard", ports: ["on"], note: "first · 거부" },
  { icon: <FileText />, label: "발견 기록", id: "record", ports: ["cap"], note: "grp.* 기록" },
];
const INSTALL: { label: string; id: string; provides: string; note: string; dragging?: boolean }[] =
  [
    {
      label: "문서 검색",
      id: "docs-search",
      provides: "knowledge.search",
      note: "user · 0.2.0",
      dragging: true,
    },
    { label: "깃 기록", id: "git-history", provides: "repo.log", note: "user · 1.1.0" },
    { label: "브라우저", id: "browser", provides: "web.fetch", note: "project · 0.3.2" },
  ];

export function Library({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      {!compact && (
        <Input size="xs" variant="soft" placeholder="블록 찾기" aria-label="블록 찾기" />
      )}
      <section className="flex flex-col">
        <h3 className="flex h-6 items-center text-ui-xs text-text-tertiary">부품 · 그룹 안</h3>
        {PARTS.slice(0, compact ? 3 : PARTS.length).map((p) => (
          <div
            key={p.id}
            className="flex h-9 items-center gap-2 rounded-lg px-1.5 hover:bg-fill-hover"
          >
            <span className="inline-grid size-5 place-items-center rounded-md bg-neutral-track text-text-secondary [&_svg]:size-3.5">
              {p.icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-ui-sm text-text-primary">{p.label}</span>
              <span className="truncate text-[10.5px] text-text-tertiary">{p.note}</span>
            </span>
            <span className="flex gap-1">
              {p.ports.map((t) => (
                <PortGlyph key={t} type={t} size={8} />
              ))}
            </span>
          </div>
        ))}
      </section>
      <section className="flex flex-col">
        <h3 className="flex h-6 items-center text-ui-xs text-text-tertiary">
          설치할 수 있는 확장 · 능력
        </h3>
        {INSTALL.map((p) => (
          <div
            key={p.id}
            className={`flex h-10 items-center gap-2 rounded-lg px-1.5 ${p.dragging ? "opacity-40 outline-1 -outline-offset-1 outline-dashed outline-border-strong" : "hover:bg-fill-hover"}`}
          >
            <span className="inline-grid size-5 place-items-center rounded-md bg-neutral-track text-text-secondary [&_svg]:size-3.5">
              <Search />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-baseline gap-1.5">
                <span className="truncate text-ui-sm text-text-primary">{p.label}</span>
                <span className="truncate font-mono text-[10px] text-text-tertiary">{p.id}</span>
              </span>
              <span className="truncate text-[10.5px] text-text-tertiary">
                {p.provides} · {p.note}
              </span>
            </span>
            <PortGlyph type="cap" size={8} />
          </div>
        ))}
      </section>
    </div>
  );
}
