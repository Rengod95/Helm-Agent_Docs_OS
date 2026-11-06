// P-12 도구와 웹: 검색·브라우저·가져오기 provider의 상태와 순서(web.providers → ToolsWebView), 권장, MCP 서버, 나머지 tools 탭 필드.
// 순서는 바꾸면 곧바로 settings.set(l2.web.search.order)로 저장된다(키 단위 저장, 초안 바닥 없음).
import {
  Alert,
  Badge,
  Button,
  Input,
  List,
  ListRow,
  NumberField,
  Select,
  SelectOption,
  Skeleton,
  TagInput,
  Tooltip,
} from "@caustic/react";
import type { ReactNode } from "react";
import { SettingsFrame } from "../../_settings/frame";
import { reorderLabels } from "../../_settings/parts";
import { SavedMark, SettingRow, SettingSection } from "../../_settings/row";
import { gotoTabPage, type TabId } from "../../_settings/tabs";

export const STATES = [
  { id: "S1", label: "S1 기본" },
  { id: "S2", label: "S2 순서 옮김" },
  { id: "S3", label: "S3 읽기 실패" },
  { id: "S4", label: "S4 브라우저 없음·첫 사용 안내" },
  { id: "S5", label: "S5 읽는 중" },
  { id: "D-offline", label: "D 오프라인(순서 바꾸기 잠금)" },
] as const;
type State = (typeof STATES)[number]["id"];

type Status = "ready" | "needs-key" | "unreachable";
interface Row {
  id: string;
  name: string;
  source: string;
  status: Status;
  price?: ReactNode;
  current?: boolean;
  notice?: boolean;
}

const STATUS: Record<Status, { text: string; cls: string }> = {
  ready: { text: "쓸 수 있음", cls: "text-text-secondary" },
  "needs-key": { text: "키 없음", cls: "text-warning-text" },
  unreachable: { text: "연결 안 됨", cls: "text-danger-text" },
};

const SEARCH: Row[] = [
  {
    id: "searxng",
    name: "SearXNG",
    source: "로컬",
    status: "ready",
    price: "무료",
    current: true,
  },
  {
    id: "builtin",
    name: "내장 검색",
    source: "anthropic",
    status: "ready",
    price: "$10 / 1천 회",
  },
  {
    id: "exa",
    name: "Exa",
    source: "플러그인",
    status: "needs-key",
  },
  {
    id: "brave",
    name: "Brave",
    source: "플러그인",
    status: "unreachable",
    price: (
      <Tooltip content="가격표가 90일 넘게 갱신되지 않았어요 (2026-07-12)">
        <span
          tabIndex={0}
          className="rounded-sm text-warning-text outline-none focus-visible:focus-ring"
        >
          가격 오래됨
        </span>
      </Tooltip>
    ),
  },
];

function End({ r }: { r: Row }) {
  const st = STATUS[r.status];
  return (
    <span className="flex items-center gap-3 text-ui-sm">
      {r.notice === true && (
        <Badge size="sm" tone="info">
          첫 사용 안내 남음
        </Badge>
      )}
      <span className={st.cls}>{st.text}</span>
      <span className="w-28 truncate text-end text-text-tertiary @max-[32rem]:hidden">
        {r.price}
      </span>
      <span className="w-10 text-end">
        {r.current === true && (
          <Badge size="sm" tone="neutral" variant="soft">
            현재
          </Badge>
        )}
      </span>
    </span>
  );
}

function ProviderList({
  label,
  rows,
  dragging,
  disabled,
}: {
  label: string;
  rows: Row[];
  dragging?: string;
  disabled?: boolean | undefined;
}) {
  return (
    <List
      {...reorderLabels}
      reorderable
      numbered
      size="xs"
      aria-label={label}
      disabled={disabled === true}
      variant="ghost"
      className="rounded-none"
    >
      {rows.map((r) => (
        <ListRow
          key={r.id}
          itemValue={r.id}
          title={r.name}
          description={<span className="font-mono text-mono-sm">{r.source}</span>}
          end={<End r={r} />}
          dragging={dragging === r.id}
        />
      ))}
    </List>
  );
}

function SkeletonRows() {
  return (
    <div aria-busy="true" aria-label="provider를 읽는 중" className="grid gap-2 py-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton width={22} height={22} radius="md" />
          <Skeleton height={12} width={`${40 - i * 5}%`} />
          <Skeleton height={12} width="4rem" className="ms-auto" />
        </div>
      ))}
    </div>
  );
}

export function App({ state }: { state: State }) {
  const onTabSelect = (id: TabId) => void gotoTabPage(id, "p12-tools-web");
  const loading = state === "S5";
  const failed = state === "S3";
  const moved = state === "S2";
  const offline = state === "D-offline";
  const search = moved ? [SEARCH[0]!, SEARCH[2]!, SEARCH[1]!, SEARCH[3]!] : SEARCH;

  return (
    <SettingsFrame tab="tools" onTabSelect={onTabSelect} offline={offline}>
      <SettingSection
        title="검색"
        end={
          moved ? (
            <span className="flex items-center gap-2">
              <span className="text-ui-sm text-text-tertiary">Exa를 2번째로 옮겼어요</span>
              <SavedMark />
            </span>
          ) : undefined
        }
      >
        {failed && (
          <div className="pb-2">
            <Alert
              tone="danger"
              layout="inline"
              action={
                <Button size="xs" variant="outline">
                  다시 읽기
                </Button>
              }
            >
              provider 목록을 읽지 못했어요. 마지막으로 읽은 순서를 보여요.
            </Alert>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 pb-2 @max-[34rem]:grid-cols-1">
          <label className="grid gap-1 text-ui-sm text-text-tertiary">
            provider
            <Select size="xs" defaultValue="auto" aria-label="검색 provider">
              <SelectOption value="auto">자동 (순서대로)</SelectOption>
              <SelectOption value="searxng">SearXNG 고정</SelectOption>
              <SelectOption value="builtin">내장 검색 고정</SelectOption>
            </Select>
          </label>
          <label className="grid gap-1 text-ui-sm text-text-tertiary">
            병렬
            <Select size="xs" defaultValue="1" aria-label="병렬 검색 수">
              <SelectOption value="1">1개씩</SelectOption>
              <SelectOption value="2">2개 함께</SelectOption>
              <SelectOption value="3">3개 함께</SelectOption>
            </Select>
          </label>
          <label className="grid gap-1 text-ui-sm text-text-tertiary">
            robots.txt
            <Select size="xs" defaultValue="ignore" aria-label="robots.txt">
              <SelectOption value="ignore">따르지 않음</SelectOption>
              <SelectOption value="respect">따름</SelectOption>
            </Select>
          </label>
        </div>
        {loading ? (
          <SkeletonRows />
        ) : (
          <ProviderList
            label="검색 순서"
            rows={search}
            {...(moved ? { dragging: "exa" } : {})}
            disabled={failed || offline}
          />
        )}
        {failed && (
          <p role="alert" className="m-0 pt-1 text-ui-sm text-danger-text">
            순서를 저장하지 못했어요. 목록에 없는 provider(kagi)가 들어 있어요.
          </p>
        )}
        <SettingRow label="SearXNG 주소" k="l2.web.search.searxng.url" scope="user" apply="now">
          <Input
            size="sm"
            defaultValue="http://localhost:8888"
            aria-label="SearXNG 주소"
            containerClassName="w-72 max-w-full font-mono"
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="브라우저">
        {loading ? (
          <SkeletonRows />
        ) : state === "S4" ? (
          <p className="m-0 py-0.5 text-ui text-text-secondary">
            브라우저 도구가 없어요. 아래 권장에서 playwright-mcp를 설치할 수 있어요.
          </p>
        ) : (
          <ProviderList
            label="브라우저 순서"
            disabled={offline}
            rows={[
              {
                id: "playwright",
                name: "playwright-mcp",
                source: "MCP",
                status: "ready",
                price: "무료",
                current: true,
              },
              {
                id: "cdp",
                name: "chrome-devtools-mcp",
                source: "MCP · 프로젝트",
                status: "ready",
                price: "무료",
              },
            ]}
          />
        )}
      </SettingSection>

      <SettingSection title="가져오기">
        {loading ? (
          <SkeletonRows />
        ) : (
          <ProviderList
            label="가져오기 순서"
            rows={[
              {
                id: "local",
                name: "local",
                source: "내장",
                status: "ready",
                price: "무료",
                current: true,
              },
              {
                id: "jina",
                name: "Jina Reader",
                source: "플러그인",
                status: "needs-key",
                notice: state === "S4",
              },
            ]}
          />
        )}
      </SettingSection>

      <SettingSection title="권장">
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {[
            { n: "Exa", d: "의미 검색 · 키 필요", a: "키 등록", s: "설치됨" },
            { n: "Brave", d: "일반 웹 검색 · 키 필요", a: "설치", s: "설치 안 됨" },
            ...(state === "S4"
              ? [{ n: "playwright-mcp", d: "브라우저 조작", a: "설치", s: "설치 안 됨" }]
              : []),
          ].map((r) => (
            <li key={r.n} className="flex min-h-8 items-center gap-3">
              <span className="text-ui font-medium text-text-primary">{r.n}</span>
              <span className="min-w-0 flex-1 truncate text-ui-sm text-text-tertiary">
                {r.d} · {r.s}
              </span>
              <Button size="xs" variant="outline">
                {r.a}
              </Button>
            </li>
          ))}
        </ul>
      </SettingSection>

      <SettingSection
        title="MCP 서버"
        end={
          <Button size="xs" variant="ghost">
            관리
          </Button>
        }
      >
        <p className="m-0 py-0.5 font-mono text-mono-sm text-text-secondary">
          playwright · chrome-devtools · github
        </p>
      </SettingSection>

      <SettingSection title="웹 정책">
        <SettingRow
          label="허용 도메인"
          k="l2.web.policy.allowDomains"
          scope="project"
          apply="nextTurn"
        >
          <TagInput
            size="sm"
            aria-label="허용 도메인"
            defaultValue={["github.com", "developer.mozilla.org"]}
            containerClassName="max-w-[28rem]"
          />
        </SettingRow>
        <SettingRow label="캐시 유지" k="l2.web.cache.ttlMinutes" scope="default" apply="now">
          <div className="flex items-center gap-2">
            <NumberField
              appearance="stepper"
              containerClassName="w-36"
              size="sm"
              aria-label="캐시 유지(분)"
              defaultValue={60}
            />
            <span className="text-ui-sm text-text-tertiary">분</span>
          </div>
        </SettingRow>
      </SettingSection>
    </SettingsFrame>
  );
}
