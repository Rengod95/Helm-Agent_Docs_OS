// W1 작업대 개요(P-16): 머리 요약 줄, (맥락 대화가 있으면) 이 대화 한 줄, 층 × 확장 지도, 주의, 최근 시험과 승격 후보.
import { Alert, Badge, Button } from "@caustic/react";
import {
  layerMap,
  LAYERS,
  lease,
  promotion,
  tests,
  threads,
  WB_WIDTH,
  WorkbenchHead,
  type TestRun,
} from "../../_shell";
import { extInfo } from "../data";
import { LayerCell, SectionTitle, StatusDot } from "../parts/ext-bits";
import { LayerMap, SAFE_MODE_OUT } from "../parts/layer-map";
import { useMock } from "../store";

const testText: Record<
  TestRun["result"],
  { text: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  running: { text: "실행 중", tone: "neutral" },
  passed: { text: "통과", tone: "success" },
  failed: { text: "실패", tone: "danger" },
  budget_pending: { text: "예산 대기", tone: "warning" },
  clean: { text: "깨끗함", tone: "success" },
};

const k = (n: number) => `${Math.round(n / 1000)}k`;

function ThisThread() {
  const m = useMock();
  const t = threads.find((x) => x.id === m.contextThreadId);
  if (t === undefined) return null;
  return (
    <section aria-label={`이 대화: ${t.title}`} className="grid gap-0.5">
      <SectionTitle
        end={
          <button
            type="button"
            onClick={() => m.backToChat("runtime")}
            className="rounded-sm outline-none hover:text-text-primary focus-visible:focus-ring"
          >
            런타임 탭에서 보기
          </button>
        }
      >
        이 대화 · {t.title}
      </SectionTitle>
      {m.driveHolder === null ? (
        <p className="m-0 text-ui-dense text-text-secondary">지금 drive를 쥔 그룹이 없어요</p>
      ) : (
        <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-ui-dense text-text-secondary">
          <span>
            <span className="font-medium text-text-primary">drive {m.driveHolder}</span> · 턴{" "}
            {lease.turns.join("/")} · spawn {lease.spawns.join("/")} · 토큰 {k(lease.tokens[0])}/
            {k(lease.tokens[1])}
          </span>
          {lease.queue.map((q) => (
            <span key={q.group}>
              {q.state === "waiting" ? "대기" : "거부"} {q.group}
            </span>
          ))}
          <span>확장 실패 1</span>
        </p>
      )}
    </section>
  );
}

function AttentionRow({
  layer,
  name,
  tone,
  text,
  onOpen,
}: {
  layer: string;
  name: string;
  tone: "warning" | "neutral";
  text: string;
  onOpen: () => void;
}) {
  return (
    <li className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-2 text-ui-dense">
      <LayerCell>{layer}</LayerCell>
      <span className="flex min-w-0 items-center gap-1.5">
        <StatusDot tone={tone} />
        <span className="flex-none text-text-primary">{name}</span>
        <span className="truncate text-text-secondary">{text}</span>
      </span>
      <Button size="xs" tone="neutral" variant="ghost" onClick={onOpen}>
        자세히
      </Button>
    </li>
  );
}

function Attention() {
  const m = useMock();
  const review = m.ext("review");
  const acme = m.ext("acme-notes");
  const reviewOff = review?.status === "auto_disabled";
  return (
    <section aria-label="주의" className="grid gap-1.5">
      <SectionTitle>주의</SectionTitle>
      {/* DP-28: 실패 상태는 그 실패를 설명하는 목록 바로 위에 Alert danger 하나. */}
      {reviewOff && (
        <Alert
          tone="danger"
          action={
            <div className="flex gap-1">
              <Button
                size="xs"
                tone="neutral"
                variant="ghost"
                onClick={() => m.openDetail("review", "log")}
              >
                기록
              </Button>
              <Button
                size="xs"
                tone="neutral"
                variant="outline"
                onClick={() => m.reenable("review")}
              >
                다시 켜기
              </Button>
            </div>
          }
        >
          review가 자동으로 꺼졌어요 · boundary.settle.after 연속 5번 실패
        </Alert>
      )}
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {acme !== undefined && acme.failures > 0 && (
          <AttentionRow
            layer="plugin"
            name="acme-notes"
            tone="warning"
            text="tool.call.before 실패 2번 · 이 대화"
            onOpen={() => m.openDetail("acme-notes", "log")}
          />
        )}
        <AttentionRow
          layer="plugin"
          name="provider-oauth"
          tone="neutral"
          text="꺼짐 · 능력 대기 models.oauth"
          onOpen={() => m.openDetail("provider-oauth")}
        />
      </ul>
    </section>
  );
}

function RecentTests() {
  const m = useMock();
  return (
    <section aria-label="최근 시험" className="grid content-start gap-0.5">
      <SectionTitle
        end={
          <button
            type="button"
            onClick={() => m.go("other", "시험 실행", "tests")}
            className="rounded-sm outline-none hover:text-text-primary focus-visible:focus-ring"
          >
            모두 보기
          </button>
        }
      >
        최근 시험
      </SectionTitle>
      <ul className="m-0 grid list-none gap-1 p-0">
        {tests.slice(0, 4).map((t, i) => {
          const r = testText[t.result];
          return (
            <li
              key={i}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-baseline gap-2 text-ui-dense"
            >
              <span className="text-text-tertiary">{t.kind}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="flex-none text-text-primary">{t.target}</span>
                <StatusDot tone={r.tone} />
                <span className="truncate text-text-secondary">
                  {r.text}
                  {t.failedAt !== undefined ? ` · 커밋 ${t.failedAt}/${t.commits}` : ""}
                </span>
              </span>
              <span className="text-ui-xs tabular-nums text-text-tertiary">{t.at}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Promotion() {
  const c = promotion.candidates[0];
  return (
    <section aria-label="승격 후보" className="grid content-start gap-0.5">
      <SectionTitle end={`seq ${promotion.throughSeq} · 대화 ${promotion.threads}`}>
        승격 후보
      </SectionTitle>
      {c !== undefined && (
        <div className="grid gap-0.5 text-ui-dense">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-mono-sm text-text-primary">{c.tool}</span>
            <span className="text-ui-xs text-text-tertiary">grp:{c.owner}</span>
            <Badge size="sm" tone="neutral">
              L2 후보
            </Badge>
          </span>
          <span className="text-text-secondary">
            {c.consumers.map((x) => `${x.scope}가 ${x.calls}번`).join(", ")} · 사용자 직접 0번
          </span>
        </div>
      )}
    </section>
  );
}

export function Overview() {
  const m = useMock();
  const all = LAYERS.flatMap((l) => layerMap[l]).map((n) => extInfo(n, m.exts));
  const live = m.safeMode ? all.filter((e) => !SAFE_MODE_OUT.includes(e.layer)) : all;
  const on = live.filter((e) => e.status === "enabled").length;
  const auto = live.filter((e) => e.status === "auto_disabled").length;
  const drive = m.safeMode ? null : m.driveHolder;
  return (
    <>
      <WorkbenchHead
        title="작업대 개요"
        actions={
          !m.safeMode && (
            <Button size="xs" tone="neutral" variant="ghost">
              안전 모드로 다시 시작
            </Button>
          )
        }
        sub={
          <>
            <span>{m.safeMode ? "안전 모드" : "안전 모드 꺼짐"}</span>
            <span>· 확장 {all.length}</span>
            <span>· 켜짐 {on}</span>
            {auto > 0 && <span>· 자동 꺼짐 {auto}</span>}
            <span>· drive {drive ?? "없음"}</span>
            <span className="ms-auto tabular-nums">14:03 기준</span>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${WB_WIDTH} grid gap-6 pt-1 pb-6`}>
          {m.safeMode && (
            <Alert
              tone="warning"
              action={
                <Button size="xs" tone="neutral" variant="outline">
                  보통 모드로 다시 시작
                </Button>
              }
            >
              안전 모드라 L3 그룹과 외부 확장이 빠졌어요
            </Alert>
          )}
          {!m.safeMode && <ThisThread />}
          <section aria-label="층 × 확장 지도" className="grid gap-1">
            <SectionTitle>층 × 확장</SectionTitle>
            <LayerMap />
          </section>
          {!m.safeMode && <Attention />}
          <div className="grid gap-6 compact:grid-cols-2">
            <RecentTests />
            <Promotion />
          </div>
        </div>
      </div>
    </>
  );
}
