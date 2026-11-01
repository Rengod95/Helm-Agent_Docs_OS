// P-17 탭 내용: 설정(N-32 값 출처·저장 위치 + N-25 settings slot), 화면(N-33), 기록(N-34 진단 위치), 훅(N-36), 개요(짧게).
import {
  Alert,
  Badge,
  Button,
  ListDescription,
  ListDescriptionRow,
  NumberField,
  Select,
  SelectOption,
} from "@caustic/react";
import {
  Copy,
  extName,
  FileText,
  josa,
  FlaskConical,
  RotateCw,
  T,
  threads,
  ToneIcon,
  TriangleAlert,
  CircleX,
  profiles,
  useShell,
  User,
} from "../../_shell";
import { SettingRow } from "../../_settings/row";
import { ShadowedScopes } from "../../_settings/parts";
import {
  acmeLog,
  ACME_DIR,
  helmSettings,
  helmViews,
  hooks,
  type SourceScope,
  type ViewRow,
} from "../../_wb-c/data";
import { GridTable, type GridColumn } from "../../_wb-c/grid-table";
import { DotText, Mono, SectionTitle } from "../../_wb-c/parts";
import { SettingsSlot } from "../../_wb-c/settings-slot";
import { goFolder } from "../../_wb-c/frame";

const LD = "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

const SCOPE_WORD: Record<SourceScope, string> = {
  default: "기본값",
  user: "사용자",
  project: "프로젝트",
  profile: T.profile,
  trial: T.trial,
  managed: "관리",
};
const SCOPE_PATH: Record<SourceScope, string> = {
  default: "매니페스트 settings",
  user: "~/.fresnel/settings.json",
  project: "~/code/xeon/.fresnel/settings.json",
  profile: "profiles.json · explore",
  trial: "session · t8",
  managed: "/etc/xeon/managed.json",
};

// ── 설정 ──────────────────────────────────────────────────────

export function SettingsTab({ offline = false }: { offline?: boolean }) {
  const { context: c } = useShell();
  const prof =
    c.kind === "profile"
      ? (profiles.find((p) => p.id === c.profileId)?.title ?? c.profileId)
      : null;
  const trial = c.kind === "trial" ? (threads.find((t) => t.id === c.threadId)?.title ?? "") : null;
  // 맥락이 프로필·시험이면 그 값이 이기는 행이 생긴다(maxLenses).
  const rows = helmSettings.map((r) => {
    if (r.key !== "ext.helm.maxLenses") return r;
    if (prof !== null)
      return {
        ...r,
        value: "4",
        wins: "profile" as SourceScope,
        shadowed: [
          { scope: "user" as SourceScope, value: "4" },
          { scope: "default" as SourceScope, value: "3" },
        ],
      };
    if (trial !== null)
      return {
        ...r,
        value: "5",
        wins: "trial" as SourceScope,
        shadowed: [
          { scope: "profile" as SourceScope, value: "4" },
          { scope: "user" as SourceScope, value: "4" },
          { scope: "default" as SourceScope, value: "3" },
        ],
      };
    return r;
  });
  return (
    <div className="grid max-w-[44rem] gap-1">
      {(prof !== null || trial !== null) && (
        <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-neutral-well px-3 py-1.5 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
          {prof !== null ? (
            <User aria-hidden emphasis="muted" className="size-icon-sm text-text-tertiary" />
          ) : (
            <FlaskConical
              aria-hidden
              emphasis="muted"
              className="size-icon-sm text-text-tertiary"
            />
          )}
          <span className="text-ui-dense text-text-primary">
            {T.writeTarget} · {prof !== null ? `${T.profile} ${prof}` : `${T.trialThread} ${trial}`}
          </span>
          <span className="text-ui-xs text-text-tertiary">
            {prof !== null
              ? "바꾸면 프로필을 고쳐요. 이 프로필을 쓰는 대화는 다음 단계부터 바뀌어요."
              : `이 ${T.trial}에만 저장해요(session 범위). 끝나면 사라져요.`}
          </span>
        </div>
      )}
      {rows.map((r) => (
        <SettingRow
          key={r.key}
          label={r.label}
          k={r.key}
          apply="boundary"
          flag={
            <Badge size="sm" tone="neutral" variant="soft">
              {SCOPE_WORD[r.wins]}
            </Badge>
          }
          extra={
            <div className="grid gap-1">
              <p className="m-0 flex min-w-0 items-baseline gap-2 text-ui-sm text-text-tertiary">
                <span className="flex-none">{T.valueSource}</span>
                <span className="flex-none text-text-secondary">{`${SCOPE_WORD[r.wins]} 범위가 이김`}</span>
                <span className="min-w-0 truncate font-mono text-mono-sm">
                  {SCOPE_PATH[r.wins]}
                </span>
              </p>
              {r.shadowed !== undefined && (
                <ShadowedScopes
                  rows={r.shadowed.map((x) => ({
                    scope: SCOPE_WORD[x.scope],
                    value: x.value,
                    path: SCOPE_PATH[x.scope],
                  }))}
                  defaultOpen={r.wins === "trial"}
                  disabled={offline}
                />
              )}
            </div>
          }
        >
          {r.kind === "number" ? (
            <NumberField
              size="xs"
              aria-label={r.label}
              value={Number(r.value)}
              min={1}
              max={8}
              disabled={offline}
              containerClassName="w-36"
            />
          ) : (
            <Select
              size="xs"
              aria-label={r.label}
              value={r.value}
              disabled={offline}
              className="w-[min(20rem,100%)]"
            >
              {(r.options ?? []).map((o) => (
                <SelectOption key={o} value={o}>
                  {o}
                </SelectOption>
              ))}
            </Select>
          )}
        </SettingRow>
      ))}
      <SettingsSlot ext="helm" onOpenPage={() => undefined} />
    </div>
  );
}

// ── 화면 ──────────────────────────────────────────────────────

const SLOT_WORD: Record<ViewRow["slot"], string> = {
  page: T.slotPage,
  well: T.slotWell,
  card: T.slotCard,
  status: T.slotStatus,
  command: T.slotCommand,
  settings: T.slotSettings,
};

export function ViewsTab({
  reenabled,
  onReenable,
}: {
  reenabled: boolean;
  onReenable: () => void;
}) {
  const rows = helmViews.map((v) =>
    v.state === "view_disabled" && reenabled ? { ...v, state: "ok" as const, failures: 0 } : v,
  );
  const off = rows.filter((v) => v.state === "view_disabled").length;
  const bad = rows.filter((v) => v.state === "invalid").length;
  const cols: GridColumn<ViewRow & { id: string }>[] = [
    {
      key: "slot",
      header: "자리",
      width: "6.5rem",
      cell: (v) => <span className="text-text-primary">{SLOT_WORD[v.slot]}</span>,
    },
    { key: "id", header: "id", cell: (v) => <Mono dim={false}>{v.id}</Mono> },
    {
      key: "mode",
      header: T.viewMode,
      width: "9rem",
      cell: (v) => (
        <span className="text-text-secondary">
          {v.mode === "frame" ? T.viewFrame : T.viewDeclarative}
        </span>
      ),
    },
    {
      key: "state",
      header: "상태",
      width: "8.5rem",
      cell: (v) =>
        v.state === "ok" ? (
          <DotText tone="success">켜짐</DotText>
        ) : v.state === "view_disabled" ? (
          <DotText tone="danger">화면만 꺼짐</DotText>
        ) : (
          <DotText tone="danger">못 그림</DotText>
        ),
    },
    {
      key: "fail",
      header: "실패",
      width: "3.5rem",
      align: "end",
      cell: (v) => <span className="text-text-secondary">{v.failures}/5</span>,
    },
    {
      key: "act",
      header: <span className="sr-only">동작</span>,
      width: "8.5rem",
      align: "end",
      cell: (v) =>
        v.state === "view_disabled" ? (
          <Button size="xs" tone="neutral" variant="outline" onClick={onReenable}>
            {T.viewReenable}
          </Button>
        ) : null,
    },
  ];
  return (
    <div className="grid gap-3">
      {(off > 0 || bad > 0) && (
        <Alert tone="danger" layout="inline" size="sm">
          {[
            off > 0 ? `화면 ${off}개가 5번 연속 실패해 꺼졌어요` : null,
            bad > 0 ? `${bad}개는 그리지 못했어요` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Alert>
      )}
      <section className="grid gap-1">
        <SectionTitle end="이 기기 · 연속 5번이면 그 화면만 꺼짐">기여한 화면</SectionTitle>
        <GridTable
          label="기여한 화면"
          columns={cols}
          rows={rows.map((v) => ({ ...v, id: v.id }))}
        />
      </section>
      <section className="grid gap-1">
        <SectionTitle>진단</SectionTitle>
        <ul className="m-0 grid list-none gap-1 p-0">
          {rows
            .filter(
              (v) =>
                v.diag !== undefined &&
                !(v.state === "ok" && reenabled && v.id === "helm/suggested"),
            )
            .map((v) => (
              <li
                key={v.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 text-ui-dense"
              >
                <ToneIcon tone={v.state === "invalid" ? "danger" : "warning"}>
                  {v.state === "invalid" ? <CircleX /> : <TriangleAlert />}
                </ToneIcon>
                <span className="grid min-w-0 gap-0">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <Mono dim={false}>{v.diag?.code}</Mono>
                    <Mono>{v.id}</Mono>
                  </span>
                  <span className="text-text-secondary">{v.diag?.text}</span>
                </span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

// ── 기록 ──────────────────────────────────────────────────────

export function LogTab({ web }: { web: boolean }) {
  return (
    <div className="grid gap-2">
      <SectionTitle
        end={
          <Button size="xs" tone="neutral" variant="ghost" iconStart={<RotateCw />}>
            다시 읽기
          </Button>
        }
      >
        {`${extName("acme-notes")} 기록`}
      </SectionTitle>
      <ol aria-label="기록" className="m-0 grid list-none gap-2 p-0">
        {acmeLog.map((l, i) => (
          <li
            key={i}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 text-ui-dense"
          >
            <Mono>{l.at}</Mono>
            <span className="grid min-w-0 gap-0.5">
              <span className="flex min-w-0 items-baseline gap-2">
                {l.tone !== undefined && (
                  <span
                    aria-hidden
                    className={`size-1.5 flex-none translate-y-[-1px] rounded-full ${l.tone === "danger" ? "bg-danger-graphic" : "bg-warning-graphic"}`}
                  />
                )}
                <Mono>{l.kind}</Mono>
              </span>
              <span className="text-text-primary">{l.text}</span>
              {l.loc !== undefined && (
                <span className="flex min-w-0 items-center gap-1.5">
                  <Mono dim={false}>{l.loc}</Mono>
                  {web ? (
                    <Button size="xs" tone="neutral" variant="ghost" iconStart={<Copy />}>
                      경로 복사
                    </Button>
                  ) : (
                    <Button size="xs" tone="neutral" variant="ghost" iconStart={<FileText />}>
                      파일 열기
                    </Button>
                  )}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      <p className="m-0 text-ui-xs text-text-tertiary">
        {web
          ? `원격 컴퓨터 build-box의 ${ACME_DIR} 기준 경로예요.`
          : `파일은 이 컴퓨터의 기본 편집기로 열어요 · ${ACME_DIR}`}
      </p>
    </div>
  );
}

// ── 훅 ───────────────────────────────────────────────────────

export function HooksTab({ safe }: { safe: boolean }) {
  const h = hooks.find((x) => x.id === "audit-log");
  if (h === undefined) return null;
  return (
    <div className="grid max-w-[44rem] gap-3">
      {safe && (
        <Alert tone="warning" layout="inline" size="sm">
          {`${josa(T.safeMode, "이라", "라")} X ${josa(T.hook, "을", "를")} 싣지 않았어요. ${josa(T.safeMode, "을", "를")} 끄고 다시 시작하면 실려요.`}
        </Alert>
      )}
      <ListDescription variant="ghost" size="xs" aria-label={T.hook} className={LD}>
        <ListDescriptionRow term={T.hookEvent}>{h.event}</ListDescriptionRow>
        <ListDescriptionRow term="명령">
          <Mono dim={false}>{h.command}</Mono>
        </ListDescriptionRow>
        <ListDescriptionRow term="범위">
          프로젝트 · ~/code/xeon/.fresnel/hooks.json
        </ListDescriptionRow>
        <ListDescriptionRow term="시간">
          {safe ? (
            <span className="text-text-tertiary">실리지 않음</span>
          ) : (
            `p50 ${h.p50} · 마지막 ${h.last}`
          )}
        </ListDescriptionRow>
        <ListDescriptionRow term="실패">{`최근 20번 중 ${h.failures}번 · 종료 코드 1`}</ListDescriptionRow>
      </ListDescription>
      {!safe && (
        <section className="grid gap-1">
          <SectionTitle>최근 실패</SectionTitle>
          <ol className="m-0 grid list-none gap-0.5 p-0">
            {["어제 18:02", "어제 11:40", "10월 30일"].map((at) => (
              <li key={at} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 text-ui-dense">
                <span className="text-text-tertiary">{at}</span>
                <span className="truncate text-text-secondary">
                  종료 1 · <Mono>audit-append.sh: line 12: jq: command not found</Mono>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <p className="m-0 text-ui-xs text-text-tertiary">
        {`X ${josa(T.hook, "은", "는")} ${josa(T.extensionPoint, "이", "가")} 아니라 엔진 밖 명령이에요. hooks.list로 읽어요.`}
      </p>
    </div>
  );
}

// ── 개요(짧게) ────────────────────────────────────────────────

export function OverviewTab({ ext }: { ext: string }) {
  return (
    <ListDescription variant="ghost" size="xs" aria-label="개요" className={`${LD} max-w-[44rem]`}>
      <ListDescriptionRow term="설명">
        {ext === "helm"
          ? "막혔을 때 렌즈 여럿으로 넓게 보고 결과를 모아요"
          : ext === "acme-notes"
            ? "도구 호출 전에 메모를 붙여요"
            : "세션이 끝나면 감사 기록을 남겨요"}
      </ListDescriptionRow>
      <ListDescriptionRow term="설치 위치">
        <Mono dim={false}>
          {ext === "acme-notes"
            ? ACME_DIR
            : ext === "helm"
              ? "~/.fresnel/extensions/helm"
              : "~/code/xeon/.fresnel/hooks.json"}
        </Mono>
      </ListDescriptionRow>
      <ListDescriptionRow term="이 시안 밖">
        <span className="inline-flex items-center gap-1 text-text-tertiary">
          연결 지점·임대·측정 탭은 wb-opus 시안을 따라요
          <Button size="xs" tone="neutral" variant="ghost" onClick={() => goFolder("wb-opus")}>
            열기
          </Button>
        </span>
      </ListDescriptionRow>
    </ListDescription>
  );
}
