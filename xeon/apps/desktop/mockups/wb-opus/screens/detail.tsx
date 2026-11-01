// W3 확장 상세(P-17). 머리(라벨 + id, 층·종류·등급·버전, 상태, 켜기·끄기, 더보기)와 탭 여덟:
// 개요, 연결 지점, 임대와 상한, 설정, 측정, 기록, 버전, 화면. 예는 helm(S5 연결 지점), review(S6 기록, 자동 꺼짐).
import {
  Alert,
  Badge,
  Button,
  CardStat,
  IconButton,
  ListDescription,
  ListDescriptionRow,
  Menu,
  MenuItem,
  MenuSeparator,
  NumberField,
  Progress,
  Select,
  SelectOption,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@caustic/react";
import { toast } from "@caustic/react";
import type { ReactNode } from "react";
import {
  CircleAlert,
  CircleDot,
  Copy,
  Ellipsis,
  FileCode,
  FlaskConical,
  FolderOpen,
  helmPoints,
  lease,
  metrics,
  RotateCw,
  ToneIcon,
  Trash2,
  TriangleAlert,
  WB_WIDTH,
  WorkbenchHead,
  type PointRow,
} from "../../_shell";
import {
  displayName,
  extInfo,
  helmLeases,
  helmLog,
  helmVersions,
  helmViews,
  kindLabel,
  reviewFailures,
} from "../data";
import { ExtStatus, PLAIN_TABLE, SectionTitle } from "../parts/ext-bits";
import { useMock, type DetailTab } from "../store";

const TABS: { id: DetailTab; label: string }[] = [
  { id: "overview", label: "개요" },
  { id: "points", label: "연결 지점" },
  { id: "lease", label: "임대와 상한" },
  { id: "settings", label: "설정" },
  { id: "metrics", label: "측정" },
  { id: "log", label: "기록" },
  { id: "versions", label: "버전" },
  { id: "views", label: "화면" },
];

/** 목업 전용: 이 시안은 helm(전 탭)과 review(개요·기록·화면)만 채웠다. */
function MockOnly() {
  return <p className="m-0 text-ui-dense text-text-tertiary">시안은 helm과 review만 채웠어요</p>;
}

const ms = (v: number | null) => (v === null ? "-" : v >= 1000 ? `${v / 1000}s` : `${v}ms`);

/** 기계 이름 옆 mono tertiary(DP-39). */
function Key({ children }: { children: ReactNode }) {
  return <span className="font-mono text-mono-sm text-text-tertiary">{children}</span>;
}

function OverviewTab({ name }: { name: string }) {
  const helm = name === "helm";
  return (
    <ListDescription variant="ghost" size="xs" aria-label="확장 개요" className="max-w-[44rem]">
      <ListDescriptionRow term="설명">
        {helm
          ? "막힌 문제를 렌즈(자식 에이전트) 여러 개로 넓게 탐구하고, 발견을 모아 대화에 적용해요."
          : "변경을 단계마다 검토하고 위험한 편집을 막아요."}
      </ListDescriptionRow>
      <ListDescriptionRow term="저자">xeon</ListDescriptionRow>
      <ListDescriptionRow term="설치 위치" mono copyValue={`~/.fresnel/extensions/${name}`}>
        ~/.fresnel/extensions/{name}
      </ListDescriptionRow>
      <ListDescriptionRow term="등급">user · 요청 user</ListDescriptionRow>
      <ListDescriptionRow term="연산">on · post · drive · scope</ListDescriptionRow>
      <ListDescriptionRow term="능력">
        {helm
          ? "필요 없음 · 선택 web.search 연결됨, knowledge.search 없음"
          : "필요 work.task 연결됨"}
      </ListDescriptionRow>
      <ListDescriptionRow term="레코드" mono>
        {helm
          ? "grp.helm.inquiry.* · grp.helm.signal.* · grp.helm.finding.*"
          : "grp.review.state.*"}
      </ListDescriptionRow>
      <ListDescriptionRow term="구성">
        {helm ? "렌즈 에이전트 lens · 도구 lens_search" : "도구 review_gate"}
      </ListDescriptionRow>
      <ListDescriptionRow term="실패 장부">
        {helm ? "연속 0 · 최근 50번 중 1" : "연속 5 · 기준 5에 닿아 자동으로 꺼짐"}
      </ListDescriptionRow>
      <ListDescriptionRow term="진단">없음</ListDescriptionRow>
    </ListDescription>
  );
}

function PointsTab() {
  // p95 / 예산: 50% 넘으면 warning, 100%면 danger(§6.24). boundary.settle.after 1.2s/5s = 24%라 tone 없음(S5).
  const ratio = (r: PointRow) => (r.p95 === null ? null : r.p95 / r.budgetMs);
  return (
    <Table
      variant="ghost"
      size="xs"
      aria-label="연결 지점"
      className={PLAIN_TABLE}
      columns={[
        { key: "point", header: "지점" },
        { key: "fold", header: "fold", width: 72 },
        { key: "budget", header: "예산", align: "end", width: 64 },
        { key: "p50", header: "p50", align: "end", width: 64 },
        { key: "p95", header: "p95", align: "end", width: 64 },
        { key: "use", header: "예산 대비", width: 112 },
        { key: "failures", header: "실패", align: "end", width: 48 },
      ]}
      rows={helmPoints.map((p) => ({ id: p.point }))}
      renderCell={(row, col) => {
        const p = helmPoints.find((x) => x.point === row.id);
        if (p === undefined) return null;
        const r = ratio(p);
        switch (col.key) {
          case "point":
            // DP-31: 지점 이름은 꾸밈 없는 글자.
            return <span className="text-text-primary">{p.point}</span>;
          case "fold":
            return <span className="text-text-secondary">{p.fold}</span>;
          case "budget":
            return <span className="text-text-secondary">{ms(p.budgetMs)}</span>;
          case "p50":
            return <span className="text-text-secondary">{ms(p.p50)}</span>;
          case "p95":
            return <span className="text-text-primary">{ms(p.p95)}</span>;
          case "use":
            return r === null ? (
              <span className="text-text-tertiary">호출 없음</span>
            ) : (
              <span className="flex items-center gap-2">
                <Progress
                  value={Math.max(2, Math.round(r * 100))}
                  size="xs"
                  tone={r >= 1 ? "danger" : r > 0.5 ? "warning" : "default"}
                  label={`예산의 ${Math.round(r * 100)}%`}
                  className="w-14"
                />
                <span className="text-ui-xs tabular-nums text-text-tertiary">
                  {r < 0.01 ? "<1" : Math.round(r * 100)}%
                </span>
              </span>
            );
          case "failures":
            return (
              <span className={p.failures > 0 ? "text-text-primary" : "text-text-tertiary"}>
                {p.failures}
              </span>
            );
          default:
            return null;
        }
      }}
    />
  );
}

function Meter({
  label,
  used,
  max,
  text,
}: {
  label: string;
  used: number;
  max: number;
  text: string;
}) {
  return (
    <div className="grid grid-cols-[4rem_minmax(0,12rem)_auto] items-center gap-3 text-ui-dense">
      <span className="text-text-tertiary">{label}</span>
      <Progress value={Math.round((used / max) * 100)} size="xs" label={`${label} ${text}`} />
      <span className="tabular-nums text-text-secondary">{text}</span>
    </div>
  );
}

function LeaseTab() {
  return (
    <div className="grid gap-6">
      <section aria-label="지금 임대" className="grid gap-1.5">
        <SectionTitle end="캐시 무효화 조사 · 턴 7부터">지금 보유 중</SectionTitle>
        {/* 임대 상한 게이지: caustic Meter 빈틈(C-05)이라 Progress로 대신. */}
        <Meter
          label="턴"
          used={lease.turns[0]}
          max={lease.turns[1]}
          text={lease.turns.join(" / ")}
        />
        <Meter
          label="spawn"
          used={lease.spawns[0]}
          max={lease.spawns[1]}
          text={lease.spawns.join(" / ")}
        />
        <Meter label="토큰" used={lease.tokens[0]} max={lease.tokens[1]} text="120k / 400k" />
      </section>
      <section aria-label="상한 설정" className="grid gap-1">
        <SectionTitle>상한</SectionTitle>
        <ListDescription variant="ghost" size="xs" aria-label="상한 설정" className="max-w-[36rem]">
          <ListDescriptionRow term="drive 사용">예</ListDescriptionRow>
          <ListDescriptionRow term="턴">
            4 <Key>ext.helm.lease.maxTurns</Key>
          </ListDescriptionRow>
          <ListDescriptionRow term="spawn">
            8 <Key>ext.helm.lease.maxSpawns</Key>
          </ListDescriptionRow>
          <ListDescriptionRow term="토큰">
            400k <Key>ext.helm.lease.maxTokens</Key>
          </ListDescriptionRow>
        </ListDescription>
      </section>
      <section aria-label="최근 임대" className="grid gap-1">
        <SectionTitle>최근 임대</SectionTitle>
        <Table
          variant="ghost"
          size="xs"
          aria-label="최근 임대"
          className={PLAIN_TABLE}
          columns={[
            { key: "start", header: "시작" },
            { key: "end", header: "끝" },
            { key: "reason", header: "사유" },
            { key: "used", header: "사용" },
          ]}
          rows={helmLeases}
          renderCell={(r, c) => (
            <span className={c.key === "start" ? "text-text-primary" : "text-text-secondary"}>
              {String(r[c.key])}
            </span>
          )}
        />
      </section>
    </div>
  );
}

function SettingRow({ label, k, children }: { label: string; k: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 compact:grid-cols-[12rem_minmax(0,1fr)] compact:items-center">
      <span className="grid">
        <span className="text-ui-dense text-text-primary">{label}</span>
        <Key>{k}</Key>
      </span>
      <span>{children}</span>
    </div>
  );
}

function SettingsTab() {
  const m = useMock();
  return (
    <div className="grid max-w-[40rem] gap-4">
      <SettingRow label="렌즈 최대 수" k="ext.helm.maxLenses">
        <NumberField
          size="xs"
          aria-label="렌즈 최대 수"
          defaultValue={4}
          min={1}
          max={8}
          disabled={m.offline}
          className="w-36"
        />
      </SettingRow>
      <SettingRow label="신호가 오면" k="ext.helm.signal.mode">
        <Select
          size="xs"
          variant="soft"
          aria-label="신호가 오면"
          defaultValue="suggest"
          className="w-56"
        >
          <SelectOption value="suggest">제안만</SelectOption>
          <SelectOption value="auto">바로 시작</SelectOption>
          <SelectOption value="off">무시</SelectOption>
        </Select>
      </SettingRow>
      <SettingRow label="렌즈 모델" k="ext.helm.lensModel">
        <Select
          size="xs"
          variant="soft"
          aria-label="렌즈 모델"
          defaultValue="sonnet"
          className="w-56"
        >
          <SelectOption value="sonnet">sonnet-5-5</SelectOption>
          <SelectOption value="haiku">haiku-5-5</SelectOption>
        </Select>
      </SettingRow>
    </div>
  );
}

function MetricsTab({ name }: { name: string }) {
  const r = metrics.find((x) => x.name === name);
  if (r === undefined)
    return <p className="m-0 text-ui-dense text-text-tertiary">이 확장은 아직 잰 값이 없어요</p>;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 compact:grid-cols-5">
        <CardStat
          variant="ghost"
          size="sm"
          label="토큰"
          value={`${(r.tokens / 1e6).toFixed(1)}M`}
          trend={[2, 3, 2, 5, 4, 6, 7]}
          trendLabel="7일 토큰 추이"
        />
        <CardStat variant="ghost" size="sm" label="비용" value={`$${r.costUsd.toFixed(2)}`} />
        <CardStat variant="ghost" size="sm" label="임대" value={r.leaseMin} unit="분" />
        <CardStat variant="ghost" size="sm" label="실패" value={r.failures} />
        <CardStat variant="ghost" size="sm" label="거부" value={r.denies} />
      </div>
    </div>
  );
}

function LogRow({
  tone,
  at,
  kind,
  children,
  end,
}: {
  tone?: "danger" | "warning" | undefined;
  at: string;
  kind: string;
  children: ReactNode;
  end?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.25rem_4.5rem_minmax(0,1fr)_auto] items-start gap-x-2 py-1 text-ui-dense">
      {tone === undefined ? (
        <span
          aria-hidden
          className="inline-grid size-5 place-items-center text-text-tertiary [&_svg]:size-icon-xs"
        >
          <CircleDot emphasis="muted" />
        </span>
      ) : (
        <ToneIcon tone={tone}>{tone === "danger" ? <CircleAlert /> : <TriangleAlert />}</ToneIcon>
      )}
      <span className="pt-0.5 font-mono text-mono-sm tabular-nums text-text-tertiary">{at}</span>
      <span className="grid min-w-0 gap-0.5 pt-0.5">
        <span className="text-text-primary">{kind}</span>
        <span className="min-w-0 text-text-secondary">{children}</span>
      </span>
      {end !== undefined ? <span className="flex-none">{end}</span> : <span />}
    </li>
  );
}

function LogTab({ name }: { name: string }) {
  const m = useMock();
  const e = m.ext(name);
  if (name === "review") {
    const off = e?.status === "auto_disabled";
    return (
      <div className="grid gap-2">
        {off && (
          <Alert
            tone="danger"
            action={
              <Button
                size="xs"
                tone="neutral"
                variant="outline"
                onClick={() => m.reenable("review")}
              >
                다시 켜기
              </Button>
            }
          >
            연속 5번 실패해서 자동으로 꺼졌어요 · 13:40 · 턴 5
          </Alert>
        )}
        <ol aria-label="review 기록" className="m-0 grid list-none p-0">
          <LogRow
            tone="danger"
            at="13:40:22"
            kind="scope.changed · 자동으로 꺼졌어요"
            end={
              off ? undefined : <span className="text-ui-xs text-text-tertiary">다시 켰어요</span>
            }
          >
            reason auto_disable · 연속 5번 · grp:review
          </LogRow>
          {reviewFailures.map((f) => (
            <LogRow
              key={f.at}
              tone="warning"
              at={f.at}
              kind={`scope.handler_failed · ${f.point}`}
              end={
                <Button
                  size="xs"
                  tone="neutral"
                  variant="ghost"
                  iconStart={<FileCode />}
                  onClick={() => toast({ title: "편집기에서 열어요", description: f.where })}
                >
                  {f.where.split("/").pop()}
                </Button>
              }
            >
              {f.error} · 턴 {f.turn}
            </LogRow>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <ol aria-label={`${name} 기록`} className="m-0 grid list-none p-0">
      {helmLog.map((l) => (
        <LogRow key={l.at} tone={l.tone} at={l.at} kind={l.kind}>
          {l.text}
        </LogRow>
      ))}
    </ol>
  );
}

function VersionsTab() {
  return (
    <Table
      variant="ghost"
      size="xs"
      aria-label="버전"
      className={PLAIN_TABLE}
      columns={[
        { key: "version", header: "버전", width: 88 },
        { key: "where", header: "어디" },
        { key: "at", header: "바뀐 날" },
        { key: "act", header: "", align: "end", width: 96 },
      ]}
      rows={helmVersions}
      renderCell={(r, c) => {
        if (c.key === "version")
          return (
            <span className="font-mono text-mono-sm text-text-primary">{String(r["version"])}</span>
          );
        if (c.key === "act")
          return r["current"] === true ? (
            <Badge size="sm" tone="neutral">
              지금
            </Badge>
          ) : r["where"] === "이전 버전" ? (
            <Button size="xs" tone="neutral" variant="ghost">
              되돌리기
            </Button>
          ) : null;
        return <span className="text-text-secondary">{String(r[c.key])}</span>;
      }}
    />
  );
}

function ViewsTab({ name }: { name: string }) {
  const m = useMock();
  const on = m.ext(name)?.status === "enabled";
  const rows =
    name === "helm"
      ? helmViews
      : [
          {
            slot: "page",
            id: "review/queue",
            title: "review 대기열",
            state: on ? "active" : "extension_disabled",
          },
        ];
  return (
    <div className="grid gap-3">
      <Table
        variant="ghost"
        size="xs"
        aria-label="기여한 화면"
        className={PLAIN_TABLE}
        columns={[
          { key: "slot", header: "slot", width: 80 },
          { key: "id", header: "id" },
          { key: "title", header: "제목" },
          { key: "state", header: "상태", width: 140 },
          { key: "act", header: "", align: "end", width: 64 },
        ]}
        rows={rows.map((v) => ({ ...v, id: v.id }))}
        renderCell={(r, c) => {
          if (c.key === "slot")
            return <span className="text-text-secondary">{String(r["slot"])}</span>;
          if (c.key === "id")
            return <span className="font-mono text-mono-sm text-text-tertiary">{r.id}</span>;
          if (c.key === "state")
            return (
              <span className="text-ui-dense text-text-secondary">
                {r["state"] === "active" ? "그리는 중" : "확장 꺼짐"}
              </span>
            );
          if (c.key === "act")
            return r["slot"] === "page" && r["state"] === "active" ? (
              <Button size="xs" tone="neutral" variant="ghost" onClick={m.openView}>
                열기
              </Button>
            ) : null;
          return <span className="text-text-primary">{String(r[c.key])}</span>;
        }}
      />
      <p className="m-0 text-ui-xs text-text-tertiary">
        화면 장부 · 실패 0 · widgets ^1.0.0 · schemaVersion 1
      </p>
    </div>
  );
}

export function Detail() {
  const m = useMock();
  const name = m.detailExt;
  const e = m.ext(name) ?? extInfo(name, m.exts);
  const off = e.status !== "enabled";
  const label = displayName[name];
  return (
    <>
      <WorkbenchHead
        title={
          <span className="inline-flex items-baseline gap-1.5">
            {label ?? name}
            {label !== undefined && (
              <span className="font-mono text-mono-sm font-normal text-text-tertiary">{name}</span>
            )}
          </span>
        }
        meta={
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-mono-sm">{e.layer}</span>
            <span>
              {kindLabel[e.kind]} · {e.trust} · {e.version}
            </span>
            <ExtStatus e={e} pending={m.pending.has(name)} />
          </span>
        }
        actions={
          <>
            {e.exempt === true ||
            (e.status === "auto_disabled" && m.detailTab === "log") ? null : e.status ===
              "auto_disabled" ? (
              <Button
                size="xs"
                tone="neutral"
                variant="outline"
                disabled={m.offline}
                onClick={() => m.reenable(name)}
              >
                다시 켜기
              </Button>
            ) : (
              <Button
                size="xs"
                tone="neutral"
                variant="outline"
                disabled={m.offline || m.pending.has(name)}
                onClick={() => m.setEnabled(name, off)}
              >
                {off ? "켜기" : "끄기"}
              </Button>
            )}
            <Menu
              align="end"
              aria-label="확장 메뉴"
              trigger={
                <IconButton size="sm" variant="ghost" label="확장 메뉴">
                  <Ellipsis />
                </IconButton>
              }
            >
              <MenuItem
                icon={<FlaskConical />}
                onSelect={() => m.go("other", "시험 실행", "tests")}
              >
                시험 시작
              </MenuItem>
              <MenuItem icon={<RotateCw />}>다시 읽기</MenuItem>
              <MenuItem icon={<FolderOpen />}>폴더 열기</MenuItem>
              <MenuItem icon={<Copy />}>매니페스트 복사</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} tone="danger">
                지우기
              </MenuItem>
            </Menu>
          </>
        }
      />
      <Tabs
        value={m.detailTab}
        onValueChange={(v) => m.setDetailTab(v as DetailTab)}
        variant="soft"
        size="xs"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className={`${WB_WIDTH} flex-none overflow-x-auto pb-2`}>
          <TabsList aria-label="확장 상세">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                {...(t.id === "log" && e.failures > 0 ? { count: e.failures } : {})}
                {...(t.id === "points" && name === "helm" ? { count: 6 } : {})}
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`${WB_WIDTH} pt-1 pb-6`}>
            {m.detailTab === "points" && name === "helm" && (
              <p className="m-0 pb-1 text-ui-xs text-text-tertiary">최근 500번 호출 · 14:03 기준</p>
            )}
            <TabsContent value="overview">
              {name === "helm" || name === "review" ? <OverviewTab name={name} /> : <MockOnly />}
            </TabsContent>
            <TabsContent value="points">
              {name === "helm" ? <PointsTab /> : <MockOnly />}
            </TabsContent>
            <TabsContent value="lease">{name === "helm" ? <LeaseTab /> : <MockOnly />}</TabsContent>
            <TabsContent value="settings">
              {name === "helm" ? <SettingsTab /> : <MockOnly />}
            </TabsContent>
            <TabsContent value="metrics">
              <p className="m-0 pb-3 text-ui-xs text-text-tertiary">7일 · seq 9120 기준</p>
              <MetricsTab name={name} />
            </TabsContent>
            <TabsContent value="log">
              {name === "helm" || name === "review" ? <LogTab name={name} /> : <MockOnly />}
            </TabsContent>
            <TabsContent value="versions">
              {name === "helm" ? <VersionsTab /> : <MockOnly />}
            </TabsContent>
            <TabsContent value="views">
              {name === "helm" || name === "review" ? <ViewsTab name={name} /> : <MockOnly />}
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </>
  );
}
