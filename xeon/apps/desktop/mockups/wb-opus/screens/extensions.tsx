// W2 확장 목록(P-13, 크래프트 "확장"). 찾기·거르기, 표(이름, 층, 종류, 등급, 훅, 상태, 버전, 켜짐), 아래 안전 모드와 drive 그룹.
// 자동 꺼짐이 있으면 표 바로 위 Alert danger 하나(DP-28). 면제 tier는 Switch 잠금 + Tooltip. 오프라인이면 모든 Switch 잠금(S4).
import {
  Alert,
  Button,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Select,
  SelectOption,
  Switch,
  Table,
  Tooltip,
  type TableColumn,
  type TableRow,
} from "@caustic/react";
import { useState } from "react";
import {
  Ellipsis,
  FolderOpen,
  RotateCw,
  Search,
  threads,
  WB_WIDTH,
  WorkbenchHead,
  type Extension,
} from "../../_shell";
import { kindLabel, pointCount } from "../data";
import { ExtName, ExtStatus, LayerCell, PLAIN_TABLE } from "../parts/ext-bits";
import { useMock } from "../store";

const ALL = "all";

function EnabledSwitch({ e }: { e: Extension }) {
  const m = useMock();
  const on = e.status === "enabled";
  const pending = m.pending.has(e.name);
  if (e.exempt === true)
    return (
      <Tooltip content="보안·기본 동작이라 끌 수 없어요" side="left">
        {/* 잠긴 Switch는 초점을 못 받아서, 이유를 읽을 수 있게 감싼 칸이 초점을 받는다. */}
        <span
          tabIndex={0}
          aria-label={`${e.name} 켜짐, 끌 수 없음`}
          className="inline-flex rounded-full outline-none focus-visible:focus-ring"
        >
          <Switch size="sm" checked disabled aria-hidden tabIndex={-1} />
        </span>
      </Tooltip>
    );
  return (
    <Switch
      size="sm"
      checked={on}
      disabled={m.offline || pending}
      aria-label={`${e.name} ${on ? "끄기" : "켜기"}`}
      onCheckedChange={(v) =>
        e.status === "auto_disabled" ? m.reenable(e.name) : m.setEnabled(e.name, v)
      }
    />
  );
}

function RowMenu({ e }: { e: Extension }) {
  const m = useMock();
  return (
    <Menu
      align="end"
      aria-label={`${e.name} 메뉴`}
      trigger={
        <IconButton size="xs" variant="ghost" label={`${e.name} 메뉴`}>
          <Ellipsis />
        </IconButton>
      }
    >
      <MenuItem onSelect={() => m.openDetail(e.name)}>자세히</MenuItem>
      <MenuItem onSelect={() => m.openDetail(e.name, "log")}>기록</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<RotateCw />} disabled={m.offline}>
        다시 읽기
      </MenuItem>
      <MenuItem icon={<FolderOpen />}>폴더 열기</MenuItem>
    </Menu>
  );
}

export function ExtensionList() {
  const m = useMock();
  const wide = m.layout === "wide";
  const [q, setQ] = useState("");
  const [layer, setLayer] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const ctx = threads.find((t) => t.id === m.contextThreadId)?.title;

  const rows = m.exts.filter(
    (e) =>
      (q === "" || e.name.includes(q)) &&
      (layer === ALL || e.layer === layer) &&
      (kind === ALL || e.kind === kind) &&
      (status === ALL || e.status === status),
  );
  const columns: TableColumn[] = [
    { key: "name", header: "이름", sortable: true },
    { key: "layer", header: "층", width: 64 },
    ...(wide ? [{ key: "kind", header: "종류", width: 72 }] : []),
    { key: "trust", header: "등급", width: 72 },
    ...(wide ? [{ key: "points", header: "훅", align: "end" as const, width: 48 }] : []),
    { key: "status", header: "상태", width: wide ? 176 : 140 },
    { key: "version", header: "버전", align: "end", width: 64 },
    { key: "enabled", header: "켜짐", align: "end", width: 52 },
  ];
  const byName = (r: TableRow) => m.exts.find((e) => e.name === r.id);
  const auto = m.exts.filter((e) => e.status === "auto_disabled");
  const on = m.exts.filter((e) => e.status === "enabled").length;

  return (
    <>
      <WorkbenchHead
        title="확장"
        actions={
          <>
            <Button size="xs" tone="neutral" variant="ghost" disabled={m.offline}>
              가져오기
            </Button>
            <Button
              size="xs"
              tone="neutral"
              variant="outline"
              onClick={() => m.go("other", "만들기", "create")}
            >
              만들기
            </Button>
          </>
        }
        sub={
          <>
            <span>확장 {m.exts.length}</span>
            <span>· 켜짐 {on}</span>
            {auto.length > 0 && <span>· 자동 꺼짐 {auto.length}</span>}
            {ctx !== undefined && (
              // §6.23: 맥락이 대화 하나면 한 줄 요약과 런타임 탭 링크만(DP-23).
              <button
                type="button"
                onClick={() => m.backToChat("runtime")}
                className="ms-auto truncate rounded-sm outline-none hover:text-text-primary focus-visible:focus-ring"
              >
                {ctx} · drive {m.driveHolder ?? "없음"} · 실패 1
              </button>
            )}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${WB_WIDTH} grid gap-3 pt-1 pb-6`}>
          {m.offline && (
            <Alert tone="warning">엔진에 연결되면 바꿀 수 있어요 · 마지막 값 14:03</Alert>
          )}
          <div
            role="search"
            aria-label="확장 거르기"
            className="flex flex-wrap items-center gap-1.5"
          >
            <Input
              size="xs"
              variant="soft"
              prefix={<Search />}
              placeholder="이름으로 찾기"
              aria-label="확장 이름으로 찾기"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              containerClassName="w-56"
            />
            <Select
              size="xs"
              variant="soft"
              aria-label="층"
              value={layer}
              onValueChange={setLayer}
              className="w-28"
            >
              <SelectOption value={ALL}>층 전체</SelectOption>
              {["L0", "L1", "L2", "L3", "plugin", "X"].map((l) => (
                <SelectOption key={l} value={l}>
                  {l}
                </SelectOption>
              ))}
            </Select>
            <Select
              size="xs"
              variant="soft"
              aria-label="종류"
              value={kind}
              onValueChange={setKind}
              className="w-28"
            >
              <SelectOption value={ALL}>종류 전체</SelectOption>
              {(["group", "plugin", "core", "hook"] as const).map((k) => (
                <SelectOption key={k} value={k}>
                  {kindLabel[k]}
                </SelectOption>
              ))}
            </Select>
            <Select
              size="xs"
              variant="soft"
              aria-label="상태"
              value={status}
              onValueChange={setStatus}
              className="w-28"
            >
              <SelectOption value={ALL}>상태 전체</SelectOption>
              <SelectOption value="enabled">켜짐</SelectOption>
              <SelectOption value="disabled">꺼짐</SelectOption>
              <SelectOption value="auto_disabled">자동 꺼짐</SelectOption>
            </Select>
          </div>
          {auto.length > 0 && !m.offline && (
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
              review가 자동으로 꺼졌어요 · 연속 5번 실패
            </Alert>
          )}
          <Table
            variant="ghost"
            size="xs"
            aria-label="확장"
            className={PLAIN_TABLE}
            columns={columns}
            rows={rows.map((e) => ({ id: e.name }))}
            rowActions={(r) => {
              const e = byName(r);
              return e === undefined ? null : <RowMenu e={e} />;
            }}
            renderCell={(r, c) => {
              const e = byName(r);
              if (e === undefined) return null;
              switch (c.key) {
                case "name":
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        m.openDetail(e.name, e.status === "auto_disabled" ? "log" : "overview")
                      }
                      className="flex max-w-full min-w-0 rounded-sm text-start outline-none hover:underline focus-visible:focus-ring"
                    >
                      <ExtName name={e.name} />
                      {e.drive === "holder" && e.status === "enabled" && (
                        <span className="ms-1.5 flex-none text-ui-xs text-text-tertiary">
                          drive
                        </span>
                      )}
                    </button>
                  );
                case "layer":
                  return <LayerCell>{e.layer}</LayerCell>;
                case "kind":
                  return <span className="text-text-secondary">{kindLabel[e.kind]}</span>;
                case "trust":
                  return <span className="text-text-secondary">{e.trust}</span>;
                case "points":
                  return <span className="text-text-secondary">{pointCount[e.name] ?? "-"}</span>;
                case "status":
                  return <ExtStatus e={e} pending={m.pending.has(e.name)} />;
                case "version":
                  return (
                    <span className="font-mono text-mono-sm text-text-tertiary">{e.version}</span>
                  );
                case "enabled":
                  return (
                    <span className="inline-flex justify-end">
                      <EnabledSwitch e={e} />
                    </span>
                  );
                default:
                  return null;
              }
            }}
          />
          {/* 표 아래 전역 두 줄: 안전 모드, drive 그룹. 이름표·값 한 목록(ListDescription 모양)을 입력 부품 때문에 격자로 그린다. */}
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 pt-3 text-ui-dense">
            <span className="text-text-tertiary">안전 모드</span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-text-secondary">꺼짐</span>
              <Button size="xs" tone="neutral" variant="ghost" disabled={m.offline}>
                안전 모드로 다시 시작
              </Button>
            </span>
            <span className="text-text-tertiary">drive 그룹</span>
            <span className="flex flex-wrap items-center gap-2">
              <Select
                size="xs"
                variant="soft"
                aria-label="drive 그룹"
                value={m.driveGroup}
                onValueChange={m.setDriveGroup}
                disabled={m.offline}
                className="w-40"
              >
                <SelectOption value="auto">자동</SelectOption>
                <SelectOption value="helm">helm</SelectOption>
                <SelectOption value="review">review</SelectOption>
              </Select>
              <span className="font-mono text-mono-sm text-text-tertiary">
                x.primitives.activeDriveGroup
              </span>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
