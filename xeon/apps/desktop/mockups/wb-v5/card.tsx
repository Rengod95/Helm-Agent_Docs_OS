// 선택 패널의 내용: 고른 것 하나를 위에서부터 이름, 켜진 곳, 중요한 것, 하는 일 순서로 보인다.
// 머리(이름·표식·닫기)와 아래 줄(하는 일)은 고정, 가운데만 길면 스크롤한다. 지도와 순서 어디서 골라도 여기로 온다.
import {
  Alert,
  Badge,
  Button,
  CardFooter,
  CardHeader,
  CardHeading,
  CardMeta,
  CardTitle,
  Chip,
  IconButton,
  List,
  ListRow,
  Menu,
  MenuItem,
  ScrollArea,
  SectionHeader,
  Switch,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import { Ellipsis, X } from "../_shell";
import { T } from "../_shell/terms";
import {
  CAPS,
  FOLD_LABEL,
  GROUPS,
  LAYER_CODE,
  LAYER_NAME,
  ORIGIN_LABEL,
  PIECE_LABEL,
  PIECE_ORDER,
  capSlot,
  groupById,
  hookDef,
  manifestText,
  pluginById,
  providersOf,
  type Group,
  type PieceKind,
  type Plugin,
} from "./data";
import { Mark, SHAPE_OF } from "./marks";
import { groupState, useMock, type Mock } from "./store";

const LABEL = "text-footnote text-text-tertiary";

/** 패널의 머리: 표식, 이름, 한 줄 설명, 닫기. 아래에 작은 표식들(층, 그룹, 버전, 출처). */
function Head({
  title,
  sub,
  meta,
  mark,
}: {
  title: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  mark?: ReactNode;
}) {
  const m = useMock();
  return (
    <div className="grid gap-2 pb-3">
      <CardHeader headerAlign="center">
        {mark}
        <CardHeading>
          <CardTitle as="h2" className="truncate">
            {title}
          </CardTitle>
        </CardHeading>
        <IconButton size="sm" variant="ghost" label="닫기" onClick={m.closePanel}>
          <X />
        </IconButton>
      </CardHeader>
      {sub !== undefined && <div className="truncate text-body text-text-secondary">{sub}</div>}
      {meta !== undefined && <div className="flex flex-wrap items-center gap-1.5">{meta}</div>}
    </div>
  );
}

/** 가운데: 길면 스크롤하는 영역 */
function Body({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="-mx-1 min-h-0 flex-1" label="내용">
      <div className="grid gap-3 px-1 pb-3">{children}</div>
    </ScrollArea>
  );
}

/** 아래 줄: 하는 일. 가장 중요한 하나는 채워서, 나머지는 윤곽으로, 드문 것은 ⋯ 메뉴로. */
function Actions({ children, more }: { children: ReactNode; more?: ReactNode }) {
  return (
    <CardFooter footer="divided" className="flex-nowrap">
      {children}
      {more !== undefined && (
        <Menu
          size="sm"
          radius="lg"
          side="top"
          align="end"
          trigger={
            <IconButton size="sm" variant="outline" label="더 보기" className="ms-auto">
              <Ellipsis />
            </IconButton>
          }
        >
          {more}
        </Menu>
      )}
    </CardFooter>
  );
}

/** 켜짐·꺼짐: 전역 하나뿐이다. 대화마다 끄는 일은 대화 화면의 몫이다. 값 밑에는 새로 알려 줄 상태가 있을 때만 적는다. */
export function OnControl({
  on,
  onChange,
  label,
  state,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** 켜짐·꺼짐 말고 알려 줄 상태(자동 꺼짐, 일부만 켜짐) */
  state: string;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body text-text-primary">{on ? "켜짐" : "꺼짐"}</span>
        <Switch size="sm" aria-label={label} checked={on} onCheckedChange={onChange} />
      </div>
      {state !== "" && <span className={LABEL}>{state}</span>}
    </div>
  );
}

export function Provides({ p, m }: { p: Plugin; m: Mock }) {
  const hooks = p.hooks;
  const kinds = PIECE_ORDER.filter((k) => p.pieces.some((x) => x.kind === k));
  const optional = p.optional ?? [];
  const rows: { label: string; body: ReactNode }[] = [];
  if (hooks.length > 0)
    rows.push({
      label: T.hook,
      body: hooks.map((h) => (
        <button
          key={h}
          type="button"
          onClick={() => m.select({ k: "hook", id: h })}
          className="grid cursor-pointer gap-0 rounded-sm border-0 bg-transparent p-0 text-start outline-none hover:underline focus-visible:shadow-focus"
        >
          <span className="text-body text-text-primary">{hookDef(h)?.label ?? ""}</span>
          <span className="font-mono text-mono-sm text-text-tertiary">{h}</span>
        </button>
      )),
    });
  if (p.provides.length > 0)
    rows.push({
      label: T.capability,
      body: p.provides.map((c) => (
        <Badge key={c} mono size="sm">
          {c}
        </Badge>
      )),
    });
  for (const k of kinds)
    rows.push({
      label: PIECE_LABEL[k],
      body: p.pieces
        .filter((x) => x.kind === k)
        .map((x) =>
          k === "view" ? (
            <span key={x.name} className="text-body text-text-primary">
              {x.name}
            </span>
          ) : (
            <Badge key={x.name} mono size="sm">
              {x.name}
            </Badge>
          ),
        ),
    });
  if (optional.length > 0)
    rows.push({
      label: "함께 쓰면 좋은 기능",
      body: optional.map((c) => {
        const by = m.replaced[capSlot(c)] ?? CAPS.find((x) => x.id === c)?.builtin;
        const name = by === undefined ? undefined : pluginById(by)?.name;
        return (
          <Badge key={c} mono size="sm" variant="outline">
            {name === undefined ? c : `${c} ← ${name}`}
          </Badge>
        );
      }),
    });
  if (rows.length === 0) return <p className={`m-0 ${LABEL}`}>없음</p>;
  return (
    <dl className="m-0 grid gap-2.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-2">
          <dt className={LABEL}>{r.label}</dt>
          <dd className="m-0 flex flex-wrap gap-x-3 gap-y-1.5">{r.body}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Code({ text }: { text: string }) {
  return (
    <pre className="m-0 max-h-56 overflow-auto rounded-md bg-bg-inset px-3 py-2.5 font-mono text-mono-sm text-text-primary">
      {text}
    </pre>
  );
}

// ── 플러그인 ──────────────────────────────────────────────────────
function PluginCard({ p }: { p: Plugin }) {
  const m = useMock();
  const g = p.group === undefined ? undefined : groupById(p.group);
  const h = m.health(p.id);
  const [code, setCode] = useState(false);
  return (
    <>
      <Head
        mark={
          <Mark shape={SHAPE_OF[p.layer]} size={22} group={g !== undefined} on={m.isOn(p.id)} />
        }
        title={p.name}
        sub={p.role}
        meta={
          <>
            <Badge size="xs" variant="outline">
              {p.layer === "plugin"
                ? LAYER_NAME.plugin
                : `${LAYER_CODE[p.layer]} ${LAYER_NAME[p.layer]}`}
            </Badge>
            {g !== undefined && (
              <Chip
                size="xs"
                tone="info"
                variant="soft"
                onClick={() => m.select({ k: "group", id: g.id })}
              >
                {g.name} {T.group}
              </Chip>
            )}
            <CardMeta>v{p.version ?? "0.1.0"}</CardMeta>
            {g === undefined && <CardMeta>{ORIGIN_LABEL[p.origin]}</CardMeta>}
          </>
        }
      />
      <Body>
        <OnControl
          on={m.isOn(p.id)}
          onChange={(next) => m.setOn(p.id, next)}
          label={p.name}
          state={h?.autoOff === true ? T.autoDisabled : ""}
        />
        {h !== undefined && (
          <Alert
            tone="danger"
            size="sm"
            radius="md"
            actions={[{ label: "기록", onClick: () => m.openDrawer(p.id) }]}
          >
            {h.text}
          </Alert>
        )}
        <SectionHeader size="xs" headingLevel={3} title={code ? "플러그인 정보" : "구성"} />
        {code ? <Code text={manifestText({ plugin: p }, m.isOn)} /> : <Provides p={p} m={m} />}
      </Body>
      <Actions
        more={
          <>
            <MenuItem onSelect={() => setCode((v) => !v)}>{code ? "구성" : "코드"}</MenuItem>
            {g !== undefined && (
              <MenuItem onSelect={() => m.notify("그룹에서 제거는 아직 모형이에요")}>
                그룹에서 제거
              </MenuItem>
            )}
            {p.origin !== "builtin" && (
              <MenuItem tone="danger" onSelect={() => m.notify("지우기는 아직 모형이에요")}>
                {T.uninstall}
              </MenuItem>
            )}
          </>
        }
      >
        <Button size="sm" variant="solid" onClick={() => m.openDetail({ k: "plugin", id: p.id })}>
          자세히 보기
        </Button>
        <Button size="sm" variant="outline" onClick={() => m.openBuilder(p.hooks[0] ?? null)}>
          구성 편집
        </Button>
      </Actions>
    </>
  );
}

// ── 그룹 ──────────────────────────────────────────────────────────
function GroupCard({ g }: { g: Group }) {
  const m = useMock();
  const st = groupState(g.id, m.isOn);
  const members = g.members
    .map((id) => m.plugins.find((p) => p.id === id))
    .filter((p): p is Plugin => p !== undefined);
  const [code, setCode] = useState(false);
  return (
    <>
      <Head
        title={g.name}
        sub={g.role}
        meta={
          <>
            <Badge size="xs" tone="info" variant="soft">
              {T.group}
            </Badge>
            <CardMeta>v{g.version}</CardMeta>
            <CardMeta>{ORIGIN_LABEL[g.origin]}</CardMeta>
            {g.config !== undefined && (
              <Badge size="xs" mono>
                {g.config}
              </Badge>
            )}
          </>
        }
      />
      <Body>
        <OnControl
          on={st.on === st.total}
          onChange={(next) => m.setGroupOn(g.id, next)}
          label={g.name}
          state={st.on === st.total || st.on === 0 ? "" : `${st.on}/${st.total} 켜짐`}
        />
        {code ? (
          <Code text={manifestText({ group: g }, m.isOn)} />
        ) : (
          <List size="xs" variant="ghost" dividers={false} aria-label="구성원">
            {members.map((p) => (
              <ListRow
                key={p.id}
                leading={<Mark shape={SHAPE_OF[p.layer]} size={18} group on={m.isOn(p.id)} />}
                title={p.name}
                description={LAYER_NAME[p.layer]}
                onClick={() => m.select({ k: "plugin", id: p.id })}
                end={
                  <Switch
                    size="xs"
                    aria-label={p.name}
                    checked={m.isOn(p.id)}
                    onCheckedChange={() => m.toggle(p.id)}
                  />
                }
              />
            ))}
          </List>
        )}
      </Body>
      <Actions
        more={
          <>
            <MenuItem onSelect={() => setCode((v) => !v)}>{code ? "구성" : "코드"}</MenuItem>
            <MenuItem onSelect={() => m.notify("그룹 해제는 아직 모형이에요")}>그룹 해제</MenuItem>
            <MenuItem onSelect={() => m.notify("하나씩 끄고 테스트는 아직 모형이에요")}>
              하나씩 끄고 테스트
            </MenuItem>
          </>
        }
      >
        <Button size="sm" variant="solid" onClick={() => m.openDetail({ k: "group", id: g.id })}>
          자세히 보기
        </Button>
        <Button size="sm" variant="outline" onClick={() => m.openBuilder(null)}>
          구성 편집
        </Button>
      </Actions>
    </>
  );
}

// ── 훅(순간) ──────────────────────────────────────────────────────
const FAIL_TEXT = {
  closed: "실패하면 막아요",
  open: "실패해도 계속해요",
  skip: "실패한 핸들러만 건너뛰어요",
} as const;

function HookCard({ id }: { id: string }) {
  const m = useMock();
  const def = hookDef(id);
  const ids = m.order[id] ?? [];
  const members = ids
    .map((x) => m.plugins.find((p) => p.id === x))
    .filter((p): p is Plugin => p !== undefined);
  const fold = def?.fold ?? "tap";
  return (
    <>
      <Head
        title={def?.label ?? id}
        sub={<span className="font-mono text-mono-sm text-text-tertiary">{id}</span>}
        meta={
          <>
            <Badge size="xs" variant="outline">
              {FOLD_LABEL[fold]}
            </Badge>
            {def !== undefined && <CardMeta>{FAIL_TEXT[def.failure]}</CardMeta>}
          </>
        }
      />
      <Body>
        {members.length === 0 ? (
          <span className={LABEL}>{T.handler} 없음</span>
        ) : (
          <List
            size="xs"
            variant="ghost"
            dividers={false}
            aria-label={T.handler}
            reorderable
            handleLabel={(t) => `${t} 순서 바꾸기`}
            instructions="Space로 집고 위아래 화살표로 옮긴 뒤 Space로 놓아요"
            announce={(e) => `${e.title} ${e.position}/${e.size}`}
            onReorder={(e) => m.move(id, e.id, e.to)}
          >
            {members.map((p) => (
              <ListRow
                key={p.id}
                itemValue={p.id}
                title={p.name}
                onClick={() => m.select({ k: "plugin", id: p.id })}
                end={
                  <Switch
                    size="xs"
                    aria-label={p.name}
                    checked={m.isOn(p.id)}
                    onCheckedChange={() => m.toggle(p.id)}
                  />
                }
              />
            ))}
          </List>
        )}
      </Body>
      <Actions>
        <Button size="sm" variant="solid" onClick={() => m.openBuilder(id)}>
          여기에 플러그인 만들기
        </Button>
      </Actions>
    </>
  );
}

// ── 내장·기능 줄 ──────────────────────────────────────────────────
function BuiltinCard({ slot }: { slot: string }) {
  const m = useMock();
  const isHook = slot.startsWith("hook:");
  const key = isHook ? slot.slice(5) : slot.slice(4);
  const def = isHook ? hookDef(key) : undefined;
  const cap = isHook ? undefined : CAPS.find((c) => c.id === key);
  const by = m.replaced[slot];
  const name = isHook ? (def?.builtin ?? key) : (pluginById(cap?.builtin ?? "")?.name ?? key);
  const candidates = isHook
    ? m.plugins.filter((p) => p.hooks.includes(key))
    : providersOf(key).filter((p) => p.id !== cap?.builtin);
  const replacer = by === undefined ? undefined : pluginById(by);
  return (
    <>
      <Head
        title={name}
        sub={<span className="font-mono text-mono-sm text-text-tertiary">{key}</span>}
        meta={
          <>
            <Badge size="xs" variant="outline">
              {isHook ? `${LAYER_CODE.L1} ${LAYER_NAME.L1}` : T.capability}
            </Badge>
            <CardMeta>{replacer === undefined ? ORIGIN_LABEL.builtin : "대체됨"}</CardMeta>
          </>
        }
      />
      <Body>
        <SectionHeader size="xs" headingLevel={3} title="대체할 수 있는 것" />
        {candidates.length === 0 ? (
          <span className={LABEL}>없음</span>
        ) : (
          <List size="xs" variant="ghost" dividers={false} aria-label="대체할 수 있는 것">
            {candidates.map((p) => (
              <ListRow
                key={p.id}
                title={p.name}
                description={`v${p.version}`}
                onClick={() => m.select({ k: "plugin", id: p.id })}
                end={
                  by === p.id ? (
                    <Button size="xs" variant="outline" onClick={() => m.replace(slot, null)}>
                      내장으로 되돌리기
                    </Button>
                  ) : (
                    <Button size="xs" variant="outline" onClick={() => m.replace(slot, p.id)}>
                      대체
                    </Button>
                  )
                }
              />
            ))}
          </List>
        )}
      </Body>
      <Actions>
        <Button size="sm" variant="solid" onClick={() => m.openBuilder(isHook ? key : null)}>
          대체할 플러그인 만들기
        </Button>
      </Actions>
    </>
  );
}

// ── 에이전트 전체 ─────────────────────────────────────────────────
function AgentCard() {
  const m = useMock();
  const on = m.plugins.filter((p) => m.isOn(p.id));
  const failing = m.plugins.filter((p) => m.health(p.id) !== undefined).length;
  const hooks = new Set(on.flatMap((p) => p.hooks)).size;
  const facts: [string, string][] = [
    [T.plugin, `${on.length}/${m.plugins.length}`],
    [
      T.group,
      `${GROUPS.filter((g) => g.members.some((id) => m.isOn(id))).length}/${GROUPS.length}`,
    ],
    [T.hook, `${hooks}`],
  ];
  const kinds = (k: PieceKind): number =>
    on.flatMap((p) => p.pieces).filter((x) => x.kind === k).length;
  return (
    <>
      <Head
        title={`내 ${T.baseAgent}`}
        sub={<span className="font-mono text-mono-sm text-text-tertiary">core.loop</span>}
      />
      <Body>
        <dl className="m-0 grid grid-cols-3 gap-3">
          {[
            ...facts,
            ...PIECE_ORDER.filter((k) => k === "skill" || k === "tool" || k === "mcp").map(
              (k): [string, string] => [PIECE_LABEL[k], `${kinds(k)}`],
            ),
          ].map(([label, v]) => (
            <div key={label} className="grid gap-0.5">
              <dt className={LABEL}>{label}</dt>
              <dd className="m-0 text-title-3 text-text-primary">{v}</dd>
            </div>
          ))}
        </dl>
        <List size="xs" variant="ghost" dividers={false} aria-label="상태">
          <ListRow title={T.lead} value={`${pluginById("helm")?.name} · ${T.turn} 1/4`} />
          <ListRow
            title={T.extFailed}
            tone={failing > 0 ? "danger" : undefined}
            value={failing}
            onClick={() => m.openDrawer(null)}
          />
        </List>
      </Body>
      <Actions>
        <Button size="sm" variant="solid" onClick={() => m.openBuilder(null)}>
          {T.plugin} 만들기
        </Button>
        <Button size="sm" variant="outline" onClick={() => m.notify("가져오기는 아직 모형이에요")}>
          {T.install}
        </Button>
      </Actions>
    </>
  );
}

export function CardBody() {
  const m = useMock();
  const s = m.sel;
  if (s.k === "plugin") {
    const p = m.plugins.find((x) => x.id === s.id);
    return p === undefined ? <AgentCard /> : <PluginCard p={p} />;
  }
  if (s.k === "group") {
    const g = groupById(s.id);
    return g === undefined ? <AgentCard /> : <GroupCard g={g} />;
  }
  if (s.k === "hook") return <HookCard id={s.id} />;
  if (s.k === "builtin") return <BuiltinCard slot={s.slot} />;
  return <AgentCard />;
}
