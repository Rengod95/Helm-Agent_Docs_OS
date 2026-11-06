// N-31 버전 탭 두 단계(spec §6.24.1)와 O-11 되돌리기 확인(§6.31, 결정 6).
// - 전체: 로더가 이력을 보관(X-8)하고 ext.versions·ext.rollback(W-31)이 있음 → 설치 이력(버전, 시각, 출처, 매니페스트 해시, 저장 형식).
// - 대체: 이력 보관 없음 → 설치본과 앱에 든 버전만. 기본 플러그인은 "앱에 든 버전으로 되돌리기", 사용자 확장은 되돌리기 없음과
//   "폴더 열기"(웹·원격은 경로 복사).
// - O-11: 지금·되돌릴 버전, 저장 형식 차이, 형식 변환 유무. 내려가는 변환이 없으면 "저장 데이터를 비우고 되돌리기"만.
//   진행(끄기 → 파일 바꾸기 → 형식 변환 → 이번 단계가 끝나면 켜기)과 실패 원복을 대화 상자 안에서 보인다.
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogClose,
  ListDescription,
  ListDescriptionRow,
} from "@caustic/react";
import type { ReactNode } from "react";
import {
  CircleCheck,
  CircleX,
  Copy,
  extJ,
  FolderOpen,
  History,
  LoaderCircle,
  RotateCcw,
  T,
  josa,
} from "../../_shell";
import { ACME_DIR, SOURCE_LABEL, type VersionEntry } from "../../_wb-c/data";
import { GridTable, type GridColumn } from "../../_wb-c/grid-table";
import { Mono, SectionTitle } from "../../_wb-c/parts";
import { hasDown, SCHEMA, type RevertResult, type RevertStep } from "../flow";

const LD = "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

export function VersionsFull({
  history,
  result,
  offline = false,
  compact = false,
  onAsk,
}: {
  history: VersionEntry[];
  result: RevertResult;
  offline?: boolean;
  compact?: boolean;
  onAsk: (v: string) => void;
}) {
  const cur = history.find((v) => v.current === true);
  const cols: GridColumn<VersionEntry & { id: string }>[] = [
    {
      key: "v",
      header: T.version,
      width: "7rem",
      cell: (v) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-mono-sm text-text-primary">{v.version}</span>
          {v.current === true && (
            <Badge size="xs" tone="neutral" variant="soft">
              지금
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "at",
      header: "설치",
      width: "6.5rem",
      cell: (v) => <span className="text-text-secondary">{v.at}</span>,
    },
    {
      key: "src",
      header: "출처",
      width: "8rem",
      cell: (v) => <span className="text-text-secondary">{SOURCE_LABEL[v.source]}</span>,
    },
    {
      key: "hash",
      header: "매니페스트 해시",
      hideCompact: true,
      cell: (v) => <Mono>{v.hash}</Mono>,
    },
    {
      key: "schema",
      header: T.stateSchema,
      width: "5rem",
      align: "end",
      cell: (v) => <span className="text-text-secondary">{v.schema}</span>,
    },
    {
      key: "act",
      header: <span className="sr-only">동작</span>,
      width: "6.5rem",
      align: "end",
      cell: (v) =>
        v.current === true ? null : (
          <Button
            size="xs"
            variant="ghost"
            iconStart={<RotateCcw />}
            disabled={offline}
            onClick={() => onAsk(v.version)}
          >
            {T.revert}
          </Button>
        ),
    },
  ];
  return (
    <div className="grid gap-3">
      {result === "failed" && (
        <Alert tone="danger" layout="inline" size="sm" emphasis="lead">
          <b>되돌리지 못했어요.</b>{" "}
          {`${T.migration} 2단계에서 실패해 ${cur?.version ?? ""} 파일로 돌려 놨어요. 저장 데이터는 그대로예요.`}{" "}
          <Mono>migrations/3-to-2.ts:31 · findings[12].sources</Mono>
        </Alert>
      )}
      {result === "code" && (
        <Alert tone="neutral" layout="inline" size="sm">
          {`${cur?.version ?? ""} 코드로 바꿨어요. ${T.stateSchema} 3 데이터는 남겨 두고 읽지 않아요. 다시 0.1.0으로 올리면 그 데이터를 다시 써요.`}
        </Alert>
      )}
      {result === "cleared" && (
        <Alert tone="neutral" layout="inline" size="sm">
          {`${josa(cur?.version ?? "", "으로", "로")} 되돌리며 저장 데이터를 비웠어요. 이번 단계가 끝나면 켜져요.`}
        </Alert>
      )}
      <section className="grid gap-1">
        <SectionTitle end={compact ? "5개까지" : "확장마다 5개까지 · extensions/.history/helm"}>
          {T.installHistory}
        </SectionTitle>
        {compact ? (
          <ul aria-label={T.installHistory} className="m-0 grid list-none gap-1.5 p-0">
            {history.map((v) => (
              <li key={v.version} className="flex min-w-0 items-center gap-2">
                <span className="grid min-w-0 flex-1 gap-0">
                  <span className="inline-flex items-center gap-1.5 text-ui-dense">
                    <span className="font-mono text-mono-sm text-text-primary">{v.version}</span>
                    {v.current === true && (
                      <Badge size="xs" tone="neutral" variant="soft">
                        지금
                      </Badge>
                    )}
                  </span>
                  <span className="truncate text-ui-xs text-text-tertiary">
                    {v.at} · {SOURCE_LABEL[v.source]} · {T.stateSchema} {v.schema}
                  </span>
                </span>
                {v.current !== true && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={offline}
                    onClick={() => onAsk(v.version)}
                  >
                    {T.revert}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <GridTable
            label={T.installHistory}
            columns={cols}
            rows={history.map((v) => ({ ...v, id: v.version }))}
          />
        )}
      </section>
      <p className="m-0 text-ui-xs text-text-tertiary">
        {`${josa(T.revert, "은", "는")} 끄고, 파일을 바꾸고, 이번 단계가 끝나면 다시 켜요. 실패하면 지금 파일로 돌려요.`}
      </p>
    </div>
  );
}

/** 대체 단계: 기록 보관이 없을 때. builtin이면 앱 번들 버전, 사용자 확장이면 되돌리기 없음 + 폴더 열기(웹: 경로 복사). */
export function VersionsFallback({ ext, web }: { ext: "learning" | "acme-notes"; web: boolean }) {
  const builtin = ext === "learning";
  return (
    <div className="grid gap-3">
      <ListDescription variant="ghost" size="xs" aria-label={T.version} className={LD}>
        <ListDescriptionRow term="설치본">
          <Mono dim={false}>{builtin ? "0.4.1" : "0.0.9"}</Mono>{" "}
          <span className="text-text-tertiary">
            · {builtin ? "10월 30일 업데이트" : "사용자 연결 · 오늘 13:58"}
          </span>
        </ListDescriptionRow>
        {builtin && (
          <ListDescriptionRow term={T.bundledVersion}>
            <Mono dim={false}>0.4.0</Mono>{" "}
            <span className="text-text-tertiary">· 앱 0.9.2에 들어 있음</span>
          </ListDescriptionRow>
        )}
        {!builtin && (
          <ListDescriptionRow term="위치">
            <Mono>{ACME_DIR}</Mono>
          </ListDescriptionRow>
        )}
      </ListDescription>
      <p className="m-0 inline-flex items-center gap-1.5 text-ui-sm text-text-secondary">
        <History aria-hidden emphasis="muted" className="size-icon-sm" />
        {`이 엔진은 ${josa(T.installHistory, "을", "를")} 남기지 않아요.`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {builtin ? (
          <Button size="sm" variant="outline" iconStart={<RotateCcw />}>
            {`${josa(T.bundledVersion, "으로", "로")} ${T.revert}`}
          </Button>
        ) : web ? (
          <Button size="sm" variant="outline" iconStart={<Copy />}>
            경로 복사
          </Button>
        ) : (
          <Button size="sm" variant="outline" iconStart={<FolderOpen />}>
            폴더 열기
          </Button>
        )}
      </div>
      {!builtin && (
        <p className="m-0 text-ui-xs text-text-tertiary">
          {web
            ? `사용자가 만든 확장은 ${josa(T.revert, "이", "가")} 없어요. 원격 컴퓨터 build-box의 폴더라 여기서 열 수 없어요.`
            : `사용자가 만든 확장은 ${josa(T.revert, "이", "가")} 없어요. 폴더에서 이전 파일로 바꾼 뒤 다시 읽어요.`}
        </p>
      )}
    </div>
  );
}

const STEPS: {
  id: Exclude<RevertStep, "closed" | "confirm" | "rollback">;
  label: (clear: boolean, to: string) => string;
}[] = [
  { id: "off", label: () => "끄기" },
  { id: "files", label: (_c, to) => `${to} 파일로 바꾸기` },
  {
    id: "migrate",
    label: (c, to) =>
      c
        ? "저장 데이터 비우기"
        : `${T.stateSchema} 3 → ${josa(String(SCHEMA[to] ?? ""), "으로", "로")} ${T.migration}`,
  },
  { id: "enable", label: () => "이번 단계가 끝나면 켜기" },
];

function StepRow({
  state,
  children,
}: {
  state: "done" | "now" | "todo" | "fail";
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2 text-ui-dense">
      <span aria-hidden className="inline-grid size-5 place-items-center [&_svg]:size-icon-sm">
        {state === "done" ? (
          <CircleCheck emphasis="muted" className="text-text-tertiary" />
        ) : state === "now" ? (
          <LoaderCircle className="animate-spin text-text-secondary" />
        ) : state === "fail" ? (
          <span className="inline-grid size-5 place-items-center rounded-sm bg-danger-soft text-danger-text">
            <CircleX />
          </span>
        ) : (
          <span className="size-1.5 rounded-full bg-neutral-graphic" />
        )}
      </span>
      <span className={state === "todo" ? "text-text-tertiary" : "text-text-primary"}>
        {children}
      </span>
    </li>
  );
}

export function RevertDialog({
  ext,
  from,
  to,
  step,
  mode,
  onCancel,
  onGo,
}: {
  ext: string;
  from: string;
  to: string;
  step: RevertStep;
  mode: "migrate" | "clear" | "code";
  onCancel: () => void;
  onGo: (mode?: "clear" | "code") => void;
}) {
  const fs = SCHEMA[from] ?? 3;
  const ts = SCHEMA[to] ?? 3;
  const clear = !hasDown(fs, ts);
  const running = step !== "confirm" && step !== "closed";
  const order = ["off", "files", "migrate", "enable"];
  const at = step === "rollback" ? 2 : order.indexOf(step);
  return (
    <Dialog
      kind="alert"
      size="sm"
      open={step !== "closed"}
      onOpenChange={(o: boolean) => (!o && !running ? onCancel() : undefined)}
      icon={<RotateCcw />}
      title={
        step === "rollback"
          ? "원래대로 돌리는 중"
          : running
            ? `${extJ(ext, "을", "를")} ${josa(to, "으로", "로")} 되돌리는 중`
            : `${extJ(ext, "을", "를")} ${josa(to, "으로", "로")} 되돌릴까요?`
      }
      description={
        running
          ? step === "rollback"
            ? `${T.migration}에 실패해 ${from} 파일로 돌리는 중이에요.`
            : "되돌리는 중이에요. 창을 닫아도 계속돼요."
          : `${extJ(ext, "을", "를")} 끄고 파일을 바꾼 뒤, 이번 단계가 끝나면 다시 켜요. 진행 중인 ${josa(T.inquiry, "은", "는")} 멈춰요.`
      }
      footer={
        running ? (
          <span role="status" className="me-auto text-ui-sm text-text-tertiary">
            {step === "rollback" ? "원래대로 돌리는 중" : `${at + 1}/4`}
          </span>
        ) : (
          <>
            <DialogClose asChild>
              <Button size="sm" variant="outline" autoFocus>
                취소
              </Button>
            </DialogClose>
            {clear && (
              <Button size="sm" variant="outline" onClick={() => onGo("code")}>
                {T.codeOnlyRevert}
              </Button>
            )}
            <Button
              size="sm"
              tone={clear ? "danger" : "neutral"}
              variant="solid"
              onClick={() => onGo(clear ? "clear" : undefined)}
            >
              {clear ? T.clearAndRevert : T.revert}
            </Button>
          </>
        )
      }
    >
      {running ? (
        <ol aria-label="되돌리기 진행" className="m-0 grid list-none gap-1 p-0">
          {STEPS.map((s, i) => (
            <StepRow
              key={s.id}
              state={
                step === "rollback" && i === 2
                  ? "fail"
                  : i < at
                    ? "done"
                    : i === at && step !== "rollback"
                      ? "now"
                      : "todo"
              }
            >
              {clear && mode === "code" && s.id === "migrate"
                ? "저장 데이터는 그대로 두기"
                : s.label(clear, to)}
            </StepRow>
          ))}
          {step === "rollback" && <StepRow state="now">{`${from} 파일로 돌리기`}</StepRow>}
        </ol>
      ) : (
        <div className="grid gap-2">
          <ListDescription variant="ghost" size="xs" aria-label="되돌리기" className={LD}>
            <ListDescriptionRow term="지금">
              <Mono dim={false}>{from}</Mono>{" "}
              <span className="text-text-tertiary">
                · {T.stateSchema} {fs}
              </span>
            </ListDescriptionRow>
            <ListDescriptionRow term={`${T.revert} 버전`}>
              <Mono dim={false}>{to}</Mono>{" "}
              <span className="text-text-tertiary">
                · {T.stateSchema} {ts}
              </span>
            </ListDescriptionRow>
            <ListDescriptionRow term={T.migration}>
              {clear ? (
                <span className="text-text-primary">{`${fs} → ${josa(String(ts), "으로", "로")} 내리는 ${josa(T.migration, "이", "가")} 없어요`}</span>
              ) : (
                <span>
                  {`${fs} → ${ts} 있음 `}
                  <Mono>migrations/3-to-2.ts</Mono>
                </span>
              )}
            </ListDescriptionRow>
          </ListDescription>
          {clear && (
            <Alert tone="warning" layout="inline" size="sm">
              {`저장 데이터(${T.inquiry} 기록 12건, ${T.finding} 31건)를 비우거나, 데이터를 남기고 코드만 되돌릴 수 있어요. 코드만 되돌리면 ${josa(to, "은", "는")} 빈 상태로 시작하고, 비운 데이터는 되살릴 수 없어요.`}
            </Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}
