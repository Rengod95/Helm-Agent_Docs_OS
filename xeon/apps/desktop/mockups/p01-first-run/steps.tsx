// P-01 단계 목록. caustic Accordion(ghost, sm, single)로 한 번에 한 단계만 펼치고, 끝난 단계도 다시 펼 수 있다.
// Stepper(checklist)는 누를 수 없는 진행 표시라 다시 열기를 못 해서 쓰지 않았다(NOTES "빈틈").
// 단계 안 이름표·값은 ListDescription(ghost, xs) 한 목록(DP-12). 단계 사이는 간격으로만 나눈다(DP-03).
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Badge,
  Button,
  Combobox,
  IconButton,
  Input,
  ListDescription,
  ListDescriptionRow,
  Select,
  SelectOption,
  Skeleton,
  Switch,
  Table,
  Tooltip,
} from "@caustic/react";
import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Copy, RotateCcw } from "../_shell";
import { groups, models, providers, recommendations, type ToolRow } from "./fixtures";
import { STEP_IDS, useFirstRun, type StepId } from "./store";

const LIST = "rounded-none [&_[data-slot=list-description-row]]:px-0";
const OFFLINE_TIP = "엔진에 연결되면 할 수 있어요";

function Indicator({ n, status }: { n: number; status: "done" | "failed" | "todo" }) {
  // Solar 글리프는 color: currentColor를 인라인으로 가져서 색은 감싼 span에 준다.
  if (status === "done")
    return (
      <span className="inline-flex size-full text-success-graphic [&_svg]:size-full">
        <CircleCheck />
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex size-full text-danger-graphic [&_svg]:size-full">
        <CircleAlert />
      </span>
    );
  return (
    <span className="grid size-full place-items-center rounded-full text-[10px] font-semibold leading-none text-text-secondary tabular-nums shadow-[inset_0_0_0_1.25px_var(--cs-color-border-default)]">
      {n}
    </span>
  );
}

/** 오프라인이면 쓰기 버튼을 잠그고 이유를 Tooltip으로 보인다(§6.0 오프라인 공통). */
function Write({ children }: { children: ReactNode }) {
  const m = useFirstRun();
  if (!m.offline) return <>{children}</>;
  return (
    <Tooltip content={OFFLINE_TIP}>
      <span className="inline-flex">{children}</span>
    </Tooltip>
  );
}

function Cmd({ text }: { text: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-0.5">
      <code className="truncate font-mono text-mono-sm">{text}</code>
      <IconButton size="xs" variant="ghost" label={`${text} 복사`} className="-my-1">
        <Copy />
      </IconButton>
    </span>
  );
}

function ToolsTable({ rows }: { rows: ToolRow[] }) {
  return (
    <Table
      variant="ghost"
      size="xs"
      radius="none"
      aria-label="외부 도구"
      className="[&_[data-slot=table-grid]]:min-w-0 [&_td:first-child]:ps-0 [&_th:first-child]:ps-0 [&_th]:bg-transparent"
      columns={[
        { key: "name", header: "도구", width: 88 },
        { key: "need", header: "구분", width: 56 },
        { key: "note", header: "상태" },
        { key: "usedBy", header: "쓰는 곳" },
      ]}
      rows={rows.map((r) => ({ id: r.name, ...r }))}
      renderCell={(row, col) => {
        const r = row as unknown as ToolRow;
        if (col.key === "name") return <span className="font-mono text-mono-sm">{r.name}</span>;
        if (col.key === "need")
          return <span className={r.need === "필수" ? "" : "text-text-tertiary"}>{r.need}</span>;
        if (col.key === "note") {
          if (r.ok)
            return <span className="font-mono text-mono-sm text-text-secondary">{r.note}</span>;
          const tone = r.need === "필수" ? "text-danger-text" : "text-warning-text";
          return r.note.includes(" ") && !r.note.includes("(") ? (
            <span className={`flex min-w-0 items-center gap-1.5 ${tone}`}>
              없음
              <span className="text-text-secondary">
                <Cmd text={r.note} />
              </span>
            </span>
          ) : (
            <span className={`font-mono text-mono-sm ${tone}`}>{r.note}</span>
          );
        }
        return <span className="text-text-secondary">{r.usedBy}</span>;
      }}
    />
  );
}

function ToolsStep() {
  const m = useFirstRun();
  return (
    <div className="grid gap-2">
      {m.loading ? (
        <div className="grid gap-2 py-1" aria-label="외부 도구 확인하는 중">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={14} width={i % 2 === 0 ? "90%" : "70%"} />
          ))}
        </div>
      ) : m.offline ? (
        <p className="m-0 text-ui-sm text-text-tertiary">엔진에 연결되면 확인해요.</p>
      ) : (
        <ToolsTable rows={m.tools} />
      )}
      <div>
        <Write>
          <Button
            size="xs"
            variant="outline"
            iconStart={<RotateCcw />}
            disabled={m.offline}
            loading={m.loading}
            onClick={m.recheck}
          >
            다시 확인
          </Button>
        </Write>
      </div>
    </div>
  );
}

function KeyStep() {
  const m = useFirstRun();
  const secret = `${m.provider}-api-key`;
  return (
    <div className="grid gap-2">
      {m.keyError && (
        <Alert tone="danger" layout="inline" size="sm">
          <b>키를 저장하지 못했어요.</b> sops: failed to get the data key. Keychain을 연 뒤 다시
          저장해 주세요.
        </Alert>
      )}
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label="모델 키"
        className={`${LIST} [--cs-size-list-term:6rem]`}
      >
        <ListDescriptionRow term="제공자">
          <Select
            size="xs"
            aria-label="제공자"
            value={m.provider}
            onValueChange={m.setProvider}
            disabled={m.offline}
            className="w-40"
          >
            {providers.map((p) => (
              <SelectOption key={p} value={p}>
                {p}
              </SelectOption>
            ))}
          </Select>
        </ListDescriptionRow>
        <ListDescriptionRow term="시크릿 이름">
          <span className="flex items-center gap-2">
            <code className="font-mono text-mono-sm">secret://{secret}</code>
            <Badge size="xs" tone="neutral">
              등록 안 됨
            </Badge>
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term="키 값">
          <span className="flex min-w-0 items-center gap-1.5">
            {/* 제어하지 않는 password 입력: React 상태에 값이 없다(L4.desktop.spec §4.14.1). */}
            <Input
              size="xs"
              type="password"
              aria-label="키 값"
              autoComplete="off"
              placeholder="sk-ant-…"
              disabled={m.offline}
              containerClassName="min-w-0 flex-1 max-w-80"
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter") m.saveKey();
              }}
            />
            <Write>
              <Button
                size="sm"
                variant="solid"
                disabled={m.offline}
                loading={m.busy === "key"}
                onClick={m.saveKey}
              >
                저장
              </Button>
            </Write>
          </span>
        </ListDescriptionRow>
      </ListDescription>
      <p className="m-0 text-ui-xs text-text-tertiary">값은 이 창에만 있고 저장하면 지워져요.</p>
    </div>
  );
}

function ModelStep() {
  const m = useFirstRun();
  return (
    <ListDescription
      variant="ghost"
      size="xs"
      aria-label="기본 모델"
      className={`${LIST} [--cs-size-list-term:6rem]`}
    >
      <ListDescriptionRow term="기본 모델">
        <span className="flex items-center gap-1.5">
          <Combobox
            mode="popup"
            size="xs"
            aria-label="기본 모델"
            searchLabel="모델 찾기"
            placeholder="모델 찾기"
            listLabel="모델"
            popupLabel="모델"
            resultsLabel={(n) => `모델 ${n}개`}
            emptyMessage="맞는 모델이 없어요"
            value={m.model}
            onValueChange={m.setModel}
            groups={models}
            className="w-56"
          />
          <Button size="sm" variant="solid" loading={m.busy === "model"} onClick={m.saveModel}>
            저장
          </Button>
        </span>
      </ListDescriptionRow>
      <ListDescriptionRow term="저장 위치">
        <span className="text-text-secondary">
          사용자 설정{" "}
          <code className="font-mono text-mono-sm text-text-tertiary">l1.models.default</code>
        </span>
      </ListDescriptionRow>
    </ListDescription>
  );
}

function GroupsStep() {
  const m = useFirstRun();
  return (
    <div className="grid gap-2">
      <ul aria-label="기본 그룹" className="m-0 grid list-none gap-2.5 p-0">
        {groups.map((g) => (
          <li key={g.id} className="flex items-start gap-2.5">
            <Switch
              size="sm"
              aria-label={`${g.name} 켜기`}
              checked={m.groupsOn[g.id] ?? false}
              onCheckedChange={(v) => m.setGroup(g.id, v)}
              className="mt-0.5"
            />
            <div className="grid min-w-0 gap-0.5">
              <div className="flex items-baseline gap-2">
                <span className="text-ui-sm font-medium text-text-primary">{g.name}</span>
                <code className="font-mono text-mono-sm text-text-tertiary">{g.id}</code>
                <span className="text-ui-xs text-text-tertiary">{g.hooks}</span>
              </div>
              <span className="text-ui-sm text-text-secondary">{g.what}</span>
            </div>
          </li>
        ))}
      </ul>
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label="그룹 더 보기"
        className={`${LIST} [--cs-size-list-term:6rem]`}
      >
        <ListDescriptionRow term="내 그룹">
          <Button size="xs" variant="outline">{`새 ${T.group}`}</Button>
        </ListDescriptionRow>
        <ListDescriptionRow term="안전 모드">
          <span className="text-text-secondary">
            그룹과 플러그인이 시작을 막으면 그것들 없이 열 수 있어요. 진단과 정보에서 켜요.
          </span>
        </ListDescriptionRow>
      </ListDescription>
      <div>
        <Button size="xs" variant="solid" onClick={m.confirmGroups}>
          이대로 쓰기
        </Button>
      </div>
    </div>
  );
}

function SearchStep() {
  const m = useFirstRun();
  return (
    <div className="grid gap-2">
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label="웹 검색"
        className={`${LIST} [--cs-size-list-term:6rem]`}
      >
        <ListDescriptionRow term="지금 검색">
          <span className="text-text-secondary">
            내장 검색(anthropic) <span className="text-text-tertiary">· 검색마다 과금</span>
          </span>
        </ListDescriptionRow>
        <ListDescriptionRow term="SearXNG">
          <span className="flex min-w-0 items-center gap-1.5">
            <Input
              size="xs"
              aria-label="SearXNG 주소"
              placeholder="http://localhost:8888"
              spellCheck={false}
              containerClassName="min-w-0 flex-1 max-w-64"
              className="font-mono"
            />
            <Button size="sm" variant="outline">
              확인
            </Button>
            <span className="text-ui-xs text-text-tertiary">연결 안 됨</span>
          </span>
        </ListDescriptionRow>
        {recommendations.map((r) => (
          <ListDescriptionRow key={r.label} term={r.label}>
            <span className="flex min-w-0 items-center gap-2">
              <code className="font-mono text-mono-sm text-text-secondary">{r.plugin}</code>
              {r.state === "needs-key" ? (
                <>
                  <span className="text-ui-xs text-text-tertiary">키 없음</span>
                  <Button size="xs" variant="outline">
                    키 등록
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-ui-xs text-text-tertiary">설치 안 됨</span>
                  <Cmd text={r.hint} />
                </>
              )}
            </span>
          </ListDescriptionRow>
        ))}
      </ListDescription>
      <div>
        <Button size="xs" variant="ghost" onClick={m.dismissSearch}>
          나중에
        </Button>
      </div>
    </div>
  );
}

const TITLES: Record<StepId, string> = {
  tools: "외부 도구 점검",
  key: "모델 키 등록",
  model: "기본 모델",
  groups: "기본 그룹",
  search: "웹 검색",
};

function summary(id: StepId, m: ReturnType<typeof useFirstRun>): ReactNode {
  const tertiary = (t: ReactNode) => (
    <span className="text-ui-sm font-normal text-text-tertiary">{t}</span>
  );
  switch (id) {
    case "tools": {
      if (m.loading) return tertiary("확인하는 중");
      const missing = m.tools.filter((t) => t.need === "필수" && !t.ok).length;
      if (missing > 0)
        return (
          <span className="text-ui-sm font-normal text-danger-text">필수 {missing}개 없음</span>
        );
      const opt = m.tools.filter((t) => t.need === "선택" && !t.ok).map((t) => t.name);
      return tertiary(`필수 준비됨${opt.length > 0 ? ` · ${opt.join(", ")} 없음` : ""}`);
    }
    case "key":
      return m.done.key ? tertiary(`secret://${m.provider}-api-key`) : null;
    case "model":
      if (m.done.model) return tertiary(m.model);
      return m.done.key ? null : tertiary("키를 등록하면 열려요");
    case "groups":
      return tertiary(
        groups
          .filter((g) => m.groupsOn[g.id])
          .map((g) => g.name)
          .join(", ") + " 켜짐",
      );
    case "search":
      return tertiary(m.done.search ? "나중에" : "선택");
  }
}

const BODY: Record<StepId, () => ReactNode> = {
  tools: ToolsStep,
  key: KeyStep,
  model: ModelStep,
  groups: GroupsStep,
  search: SearchStep,
};

export function Steps() {
  const m = useFirstRun();
  return (
    <Accordion
      type="single"
      variant="ghost"
      size="sm"
      value={m.open ?? ""}
      onValueChange={(v) => m.setOpen((v as string) || null)}
      aria-label="시작 단계"
      className="gap-1 [&_[data-slot=accordion-content]]:max-w-none [&_[data-slot=accordion-content]]:ps-[2.625rem] [&_[data-slot=accordion-content]]:pe-3.5"
    >
      {STEP_IDS.map((id, i) => {
        const Body = BODY[id];
        const status = m.failed[id] ? "failed" : m.done[id] ? "done" : "todo";
        const locked = id === "model" && !m.done.key;
        return (
          <AccordionItem key={id} value={id} disabled={locked}>
            <AccordionTrigger
              icon={<Indicator n={i + 1} status={status} />}
              accessory={summary(id, m)}
              aria-current={m.open === id ? "step" : undefined}
            >
              <span className="font-medium">
                {TITLES[id]}
                {status === "done" && <span className="sr-only"> 완료됨</span>}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <Body />
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
