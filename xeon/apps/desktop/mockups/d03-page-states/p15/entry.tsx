// P-15 진단과 정보 목업. ?state=S1..S6(기본 S1), ?theme=dark.
// 스펙상 설정 > 개요 탭 아래 구역이지만, 설정 화면(P-09)은 다른 묶음이라 여기서는 이 구역만 가운데에 단독으로 그린다(왼쪽 패널 "설정"이 지금 화면).
// 구역: 버전과 연결, 설정 개요, 플러그인과 그룹(층별), 외부 도구, 웹, 화면 진단, 라이선스. 선이나 상자 없이 간격과 h2로만 나눈다(DP-03).
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  IconButton,
  ListDescription,
  ListDescriptionRow,
  Skeleton,
  Table,
  toast,
  type TableRow,
} from "@caustic/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SAFE_OFF } from "../../d02-shell-life/parts/life";
import {
  BAR_INSET,
  josa,
  T,
  Copy,
  defaultStatusCells,
  ShellToaster,
  PanelLeft,
  Shell,
  ShellStateProvider,
  standardRightTabs,
  useShell,
  type PaletteGroup,
  type StatusCell,
} from "../../_shell";
import {
  binaries,
  handlerFailure,
  LICENSE_LUCIDE,
  LICENSE_SOLAR,
  overview,
  plugins,
  versions,
  viewDiagnostics,
  web,
  type BinaryRow,
  type PluginRow,
} from "./fixtures";

export const STATES = [
  { id: "S1", label: "S1 기본" },
  { id: "S2", label: "S2 읽는 중" },
  { id: "S3", label: "S3 오프라인" },
  { id: "S4", label: "S4 안전 모드" },
  { id: "S5", label: "S5 진단 복사됨" },
  { id: "S6", label: "S6 팔레트" },
  { id: "D-engine", label: "D 크래프트 엔진 위치(연결 줄)" },
  { id: "D-update", label: "D 업데이트 있음" },
  { id: "D-uptodate", label: "D 최신(확인함)" },
  { id: "D-update-fail", label: "D 업데이트 확인 실패" },
] as const;
type StateId = (typeof STATES)[number]["id"];

const COLUMN = "mx-auto w-full max-w-[58rem] px-3";
const LIST = "rounded-none [&_[data-slot=list-description-row]]:px-0 [--cs-size-list-term:7rem]";
const TABLE =
  "[&_[data-slot=table-grid]]:min-w-0 [&_td:first-child]:ps-0 [&_th:first-child]:ps-0 [&_th]:bg-transparent";

const palette: PaletteGroup[] = [
  {
    group: "명령",
    items: [{ label: "진단 복사" }, { label: "다시 확인" }, { label: "엔진 다시 시작" }],
  },
  {
    group: "그룹",
    items: [
      { label: "Helm 끄기", hint: "다음 단계 경계부터" },
      { label: "학습 끄기" },
      { label: "cache-debug 다시 켜기", hint: "자동으로 꺼짐" },
      { label: "그룹 다시 읽기", hint: "확장 다시 읽기" },
      { label: "안전 모드로 다시 시작", hint: "플러그인과 그룹 없이" },
    ],
  },
  {
    group: "슬래시 명령",
    items: [
      { label: "/helm start", hint: "탐구 시작 (Helm)" },
      { label: "/learn review", hint: "학습 검토 (학습)" },
    ],
  },
  {
    group: "화면",
    items: [{ label: "플러그인과 그룹" }, { label: "도구와 웹" }, { label: "설정" }],
  },
];

function Section({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-1.5">
      <div className="flex min-h-6 items-center gap-2">
        <h2 className="m-0 text-ui-sm font-semibold text-text-primary">{title}</h2>
        {trailing !== undefined && (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-ui-xs text-text-tertiary">
            {trailing}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Rows({ n }: { n: number }) {
  return (
    <div className="grid gap-2.5 py-1">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} height={12} width={`${60 + ((i * 17) % 35)}%`} />
      ))}
    </div>
  );
}

function stateCell(p: PluginRow, safe: boolean) {
  if (safe && p.user) return <span className="text-text-tertiary">안전 모드로 꺼짐</span>;
  if (safe && p.layer === "L3") return <span className="text-text-tertiary">안전 모드로 꺼짐</span>;
  switch (p.state) {
    case "on":
      return (
        <span className="text-text-secondary">
          켜짐{p.note !== undefined && <span className="text-text-tertiary"> · {p.note}</span>}
        </span>
      );
    case "needs-key":
      return <span className="text-warning-text">키 없음</span>;
    case "auto-off":
      return (
        <span className="text-danger-text">
          자동으로 꺼짐{p.note !== undefined && <span> · {p.note}</span>}
        </span>
      );
    default:
      return <span className="text-text-tertiary">꺼짐</span>;
  }
}

function PluginTable({ safe, compact }: { safe: boolean; compact: boolean }) {
  return (
    <Table
      variant="ghost"
      size="xs"
      radius="none"
      aria-label="층별 플러그인과 그룹"
      className={TABLE}
      // 좁은 폭에서는 버전과 출처를 뺀다(이름은 줄바꿈하지 않는다).
      columns={[
        { key: "id", header: "이름" },
        ...(compact
          ? []
          : [
              { key: "version", header: "버전", width: 64 },
              { key: "source", header: "출처 · 신뢰" },
            ]),
        { key: "state", header: "상태" },
      ]}
      rows={plugins.map((p) => ({ ...p }) as unknown as TableRow)}
      rowLabel={(r) => String(r["id"])}
      renderCell={(row, col) => {
        const p = row as unknown as PluginRow;
        switch (col.key) {
          case "id":
            return <span className="whitespace-nowrap font-mono text-mono-sm">{p.id}</span>;
          case "version":
            return <span className="font-mono text-mono-sm text-text-secondary">{p.version}</span>;
          case "source":
            return (
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className={p.source.startsWith("~") ? "truncate font-mono text-mono-sm" : ""}>
                  {p.source}
                </span>
                <span className="shrink-0 text-text-tertiary">· {p.trust}</span>
              </span>
            );
          default:
            return stateCell(p, safe);
        }
      }}
    />
  );
}

function BinaryTable() {
  return (
    <Table
      variant="ghost"
      size="xs"
      radius="none"
      aria-label="외부 도구"
      className={TABLE}
      columns={[
        { key: "name", header: "도구", width: 88 },
        { key: "need", header: "구분", width: 56 },
        { key: "note", header: "상태" },
        { key: "impact", header: "못 쓸 때" },
      ]}
      rows={binaries.map((b) => ({ id: b.name, ...b }) as unknown as TableRow)}
      renderCell={(row, col) => {
        const b = row as unknown as BinaryRow;
        if (col.key === "name") return <span className="font-mono text-mono-sm">{b.name}</span>;
        if (col.key === "need")
          return <span className={b.need === "필수" ? "" : "text-text-tertiary"}>{b.need}</span>;
        if (col.key === "note")
          return b.ok ? (
            <span className="font-mono text-mono-sm text-text-secondary">{b.note}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-warning-text">
              없음
              <code className="font-mono text-mono-sm text-text-secondary">{b.note}</code>
              <IconButton size="xs" variant="ghost" label={`${b.note} 복사`} className="-my-1">
                <Copy />
              </IconButton>
            </span>
          );
        return <span className="text-text-secondary">{b.impact}</span>;
      }}
    />
  );
}

function Stage({ state }: { state: StateId }) {
  const shell = useShell();
  const [loading, setLoading] = useState(state === "S2");
  const offline = state === "S3";
  const safe = state === "S4";
  const engineView = state.startsWith("D-");
  const copy = () =>
    toast({
      title: "진단을 복사했어요",
      description: "설정 값과 대화 내용은 넣지 않았어요.",
    });
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    if (state === "S5")
      toast({
        title: "진단을 복사했어요",
        description: "설정 값과 대화 내용은 넣지 않았어요.",
        duration: 0,
      });
  }, [state]);
  const recheck = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 900);
  };

  return (
    <>
      <header
        className={`mx-auto flex h-10 w-full max-w-[58rem] flex-none items-center gap-1 ps-3 ${BAR_INSET}`}
      >
        {!shell.startOpen && (
          <IconButton
            size="sm"
            variant="ghost"
            label="사이드바 열기"
            aria-expanded={false}
            onClick={() => shell.setStartOpen(true)}
            className="-ms-1.5"
          >
            <PanelLeft />
          </IconButton>
        )}
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <h1 className="m-0 truncate font-ui text-ui-strong text-text-primary">
            {engineView ? T.engine : "진단과 정보"}
          </h1>
          {offline && <span className="text-ui-sm text-text-tertiary">3분 전 값</span>}
        </div>
        <Button
          size="sm"
          tone="neutral"
          variant="ghost"
          loading={loading}
          disabled={offline}
          onClick={recheck}
        >
          다시 확인
        </Button>
        <Button size="sm" tone="neutral" variant="outline" onClick={copy}>
          진단 복사
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={`${COLUMN} grid gap-6 pt-1 pb-8`}>
          {offline && (
            <Alert tone="warning" layout="inline" size="sm">
              엔진에 연결되지 않았어요. 3분 전에 읽은 값을 보여 줘요.
            </Alert>
          )}
          {safe && (
            <Alert
              tone="warning"
              layout="inline"
              size="sm"
              action={
                <Button size="xs" tone="neutral" variant="outline">
                  보통 모드로 다시 시작
                </Button>
              }
            >
              <b>{josa(T.safeMode, "이에요", "예요")}.</b> {josa(SAFE_OFF, "을", "를")} 싣지
              않았어요.
            </Alert>
          )}

          {engineView && <EngineSection state={state} />}

          <Section
            title="플러그인과 그룹"
            trailing={
              <>
                <span className="flex-1" />
                <Button size="xs" tone="neutral" variant="ghost">
                  그룹 다시 읽기
                </Button>
              </>
            }
          >
            {loading ? (
              <Rows n={8} />
            ) : (
              <div className="grid gap-2">
                {!safe && (
                  <Alert
                    tone="danger"
                    layout="inline"
                    size="sm"
                    action={
                      <>
                        <Button size="xs" tone="neutral" variant="ghost">
                          파일 열기
                        </Button>
                        <Button size="xs" tone="neutral" variant="outline" disabled={offline}>
                          다시 켜기
                        </Button>
                      </>
                    }
                  >
                    <b className="font-mono text-mono-sm">{handlerFailure.group}</b>의 핸들러가{" "}
                    {handlerFailure.count}번 실패해 자동으로 껐어요 · {handlerFailure.at}
                  </Alert>
                )}
                <PluginTable safe={safe} compact={shell.layout === "compact"} />
              </div>
            )}
          </Section>

          <Section title="버전과 연결">
            {loading ? (
              <Rows n={6} />
            ) : (
              <ListDescription variant="ghost" size="xs" aria-label="버전과 연결" className={LIST}>
                <ListDescriptionRow term="앱 · 엔진">
                  <span className="font-mono text-mono-sm">
                    {versions.app} · {versions.engine}
                  </span>
                </ListDescriptionRow>
                <ListDescriptionRow term="런타임">
                  {versions.runtime}
                  <span className="text-text-tertiary"> · {versions.os}</span>
                </ListDescriptionRow>
                <ListDescriptionRow term="연결">{versions.link}</ListDescriptionRow>
                <ListDescriptionRow term="안전 모드">
                  <span className="flex items-center gap-2">
                    {safe ? (
                      <Badge size="xs" tone="warning">
                        켜짐
                      </Badge>
                    ) : (
                      <span className="text-text-secondary">꺼짐</span>
                    )}
                    {!safe && (
                      <Button size="xs" tone="neutral" variant="ghost" disabled={offline}>
                        안전 모드로 다시 시작
                      </Button>
                    )}
                  </span>
                </ListDescriptionRow>
              </ListDescription>
            )}
          </Section>

          <Section title="설정 개요">
            {loading ? (
              <Rows n={1} />
            ) : (
              <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-ui-sm text-text-secondary">
                {overview.map((o) => (
                  <span key={o.label}>
                    {o.label}{" "}
                    <b
                      className={`font-semibold tabular-nums ${
                        o.value > 0 && (o.label === "잠김" || o.label === "재시작 대기")
                          ? "text-warning-text"
                          : "text-text-primary"
                      }`}
                    >
                      {o.value}
                    </b>
                  </span>
                ))}
              </p>
            )}
          </Section>

          <Section title="외부 도구" trailing={<span>필수 모두 준비됨</span>}>
            {loading ? <Rows n={5} /> : <BinaryTable />}
          </Section>

          <Section
            title="웹"
            trailing={
              <>
                <span className="flex-1" />
                <Button size="xs" tone="neutral" variant="ghost">
                  도구와 웹 열기
                </Button>
              </>
            }
          >
            {loading ? (
              <Rows n={3} />
            ) : (
              <ListDescription
                variant="ghost"
                size="xs"
                aria-label="웹 provider 요약"
                className={LIST}
              >
                {web.map((w) => (
                  <ListDescriptionRow key={w.term} term={w.term}>
                    {w.value}
                    <span className="text-text-tertiary"> · {w.note}</span>
                  </ListDescriptionRow>
                ))}
              </ListDescription>
            )}
          </Section>

          <Section title="화면 진단">
            <ul className="m-0 grid list-none gap-1 p-0 text-ui-sm">
              {viewDiagnostics.map((d) => (
                <li key={d.key} className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-text-primary">{d.text}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="라이선스"
            trailing={
              <>
                <span className="flex-1" />
                <Button size="xs" tone="neutral" variant="ghost">
                  오픈 소스 고지 전체
                </Button>
              </>
            }
          >
            <ListDescription variant="ghost" size="xs" aria-label="라이선스" className={LIST}>
              <ListDescriptionRow term="Fresnel">MIT</ListDescriptionRow>
              <ListDescriptionRow term="아이콘">
                <span lang="en" className="font-normal text-text-secondary">
                  {LICENSE_SOLAR}
                </span>
              </ListDescriptionRow>
              <ListDescriptionRow term="아이콘 일부">
                <span lang="en" className="font-normal text-text-secondary">
                  {LICENSE_LUCIDE}
                </span>
              </ListDescriptionRow>
              <ListDescriptionRow term="글꼴">
                <span className="font-normal text-text-secondary">
                  Geist, Geist Mono, SUIT Variable 2.0.5 · SIL Open Font License 1.1
                </span>
              </ListDescriptionRow>
            </ListDescription>
          </Section>
        </div>
      </div>
    </>
  );
}

/** d03(묶음 D): 크래프트 "엔진" 위치의 맨 위(§6.19 결정): 엔진 상태·대상·안전 모드, "연결 화면 열기" 한 줄, 앱 업데이트 줄(계획에 없음 1). */
function EngineSection({ state }: { state: StateId }) {
  const upd =
    state === "D-update"
      ? "available"
      : state === "D-uptodate"
        ? "latest"
        : state === "D-update-fail"
          ? "fail"
          : "idle";
  return (
    <Section title={`${T.engine} 상태`}>
      <ListDescription variant="ghost" size="xs" aria-label={`${T.engine} 상태`} className={LIST}>
        <ListDescriptionRow term="상태">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-success-graphic" />
            실행 중
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term="대상">
          <span className="flex flex-wrap items-baseline gap-x-2">
            {T.localEngine}
            <Button size="xs" tone="neutral" variant="ghost" className="-my-1">
              {T.connection} 화면 열기
            </Button>
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term={T.safeMode}>
          꺼짐 · 켜면 {josa(SAFE_OFF, "을", "를")} 싣지 않아요
        </ListDescriptionRow>
        <ListDescriptionRow term={T.appUpdate}>
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-mono-sm">0.4.1</span>
            {upd === "available" && (
              <>
                <Badge size="xs" tone="success">
                  0.4.2 있음
                </Badge>
                <Button size="xs" tone="neutral" variant="outline" className="-my-1">
                  내려받기
                </Button>
              </>
            )}
            {upd === "latest" && <span className="text-text-tertiary">최신이에요 · 방금 확인</span>}
            {upd === "fail" && (
              <span className="text-danger-text">확인하지 못했어요 · 연결 시간 초과</span>
            )}
            {(upd === "idle" || upd === "latest" || upd === "fail") && (
              <Button size="xs" tone="neutral" variant="ghost" className="-my-1">
                업데이트 확인
              </Button>
            )}
          </span>
        </ListDescriptionRow>
      </ListDescription>
    </Section>
  );
}

function Page({ state }: { state: StateId }) {
  const shell = useShell();
  const link: StatusCell | undefined =
    state === "S3"
      ? {
          id: "link",
          text: "연결 끊김",
          dot: "danger",
          title: "연결 끊김",
          description: "엔진과 연결이 끊겼어요.",
          action: { label: "다시 연결", onSelect: () => {} },
        }
      : undefined;
  const cells = defaultStatusCells({
    layout: shell.layout,
    thread: false,
    pendingApprovals: 2,
    openEnd: shell.openEnd,
    link,
  });
  return (
    <Shell
      activeNav={state.startsWith("D-") ? "engine" : "settings"}
      stageLabel={state.startsWith("D-") ? T.engine : "진단과 정보"}
      palette={palette}
      threads={{ currentId: null, onSelect: () => {}, onNew: () => {} }}
      rightTabs={standardRightTabs({
        only: ["inbox"],
        inboxBadge: 5,
        inbox: <EmptyState size="sm" surface="none" title="비어 있어요" />,
      })}
      // 대화를 연 화면이 아니라 문맥 사용량 칸은 뺀다.
      status={{ start: cells.start, end: cells.end.filter((c) => c.id !== "tokens") }}
    >
      <Stage state={state} />
    </Shell>
  );
}

function Close() {
  const shell = useShell();
  // 이 화면은 가운데가 넓어야 해서 well을 닫고 시작한다(막대는 남는다).
  // biome-ignore lint/correctness/useExhaustiveDependencies: 처음 한 번만
  useEffect(() => shell.setEndOpen(false), []);
  return null;
}

export function Root({ state }: { state: string }) {
  return (
    <ShellStateProvider
      initialPaletteOpen={state === "S6"}
      initialArea={state.startsWith("D-") ? "workbench" : "chat"}
      initialContextThreadId={null}
    >
      <Close />
      <Page state={state as StateId} />
      <ShellToaster />
    </ShellStateProvider>
  );
}
