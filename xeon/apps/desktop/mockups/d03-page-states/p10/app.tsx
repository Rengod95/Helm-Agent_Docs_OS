// P-10 시크릿: 값 없는 목록 + 고른 시크릿의 상세(ListDescription) + 값 보기 흐름(O-05 재인증 → 30초 표시 → 자동 가림) + 추가 + 삭제(O-06).
import { Alert, Button, EmptyState, Menu, MenuItem, MenuSeparator, Skeleton } from "@caustic/react";
import { UsageLog } from "./usage";
import { useState } from "react";
import { Ellipsis } from "../../_shell";
import { SettingsFrame } from "../../_settings/frame";
import { gotoTabPage, type TabId } from "../../_settings/tabs";
import { AddDialog, DeleteDialog, ReauthDialog } from "./dialogs";
import { secrets } from "./fixtures";
import { SecretDetail, type Reveal } from "./detail";
import { SecretList } from "./list";

export const STATES = [
  { id: "S1", label: "S1 목록·상세" },
  { id: "S2", label: "S2 O-05 재인증" },
  { id: "S3", label: "S3 값 보임(30초)" },
  { id: "S4", label: "S4 값 못 보는 연결" },
  { id: "S5", label: "S5 재인증 거부" },
  { id: "S6", label: "S6 추가" },
  { id: "S7", label: "S7 O-06 삭제 확인" },
  { id: "S8", label: "S8 삭제 거부(사용 중)" },
  { id: "S9", label: "S9 빈 목록" },
  { id: "D-loading", label: "D 읽는 중" },
  { id: "D-offline", label: "D 오프라인" },
  { id: "D-usage", label: "D 사용 기록(W-13)" },
  { id: "D-web", label: "D 웹: 값 보기 없음" },
] as const;
type State = (typeof STATES)[number]["id"];

const revealOf = (s: State): Reveal =>
  s === "S3"
    ? "revealed"
    : s === "S4"
      ? "not_started"
      : s === "S5"
        ? "reauth_denied"
        : s === "S2"
          ? "reauth"
          : "hidden";

export function App({ state }: { state: State }) {
  const onTabSelect = (id: TabId) => void gotoTabPage(id, "p10-secrets");
  const [selected, setSelected] = useState(state === "S7" ? "github-token" : "anthropic-api-key");
  const [reveal, setReveal] = useState<Reveal>(revealOf(state));
  const [reauthOpen, setReauthOpen] = useState(state === "S2");
  const [addOpen, setAddOpen] = useState(state === "S6");
  const [deleteOpen, setDeleteOpen] = useState(state === "S7" || state === "S8");
  const empty = state === "S9";
  const loading = state === "D-loading";
  const offline = state === "D-offline";
  const current = secrets.find((s) => s.name === selected) ?? secrets[0]!;

  const select = (name: string) => {
    // 다른 이름을 열면 보이던 값은 즉시 가린다(§6.14 값 보기 규칙).
    setSelected(name);
    setReveal("hidden");
  };

  return (
    <>
      <SettingsFrame
        tab="secrets"
        onTabSelect={onTabSelect}
        modalOpen={reauthOpen || addOpen || deleteOpen}
        offline={offline}
        banner={
          state === "D-web" ? (
            <Alert tone="neutral" size="sm">
              웹 · build-box의 시크릿이에요. 값 보기와 추가는 데스크톱 앱에서 해요.
            </Alert>
          ) : undefined
        }
        actions={
          empty ? undefined : (
            <Button
              size="xs"
              variant="outline"
              disabled={offline || loading}
              onClick={() => setAddOpen(true)}
            >
              추가
            </Button>
          )
        }
      >
        {loading ? (
          <div className="grid gap-3 pt-1" role="status" aria-label="시크릿 목록 읽는 중">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex gap-6">
                <Skeleton width="28%" height={12} />
                <Skeleton width="16%" height={12} />
                <Skeleton width="20%" height={12} />
              </div>
            ))}
          </div>
        ) : empty ? (
          <EmptyState
            size="sm"
            surface="none"
            title="등록된 시크릿이 없어요"
            actions={
              <Button size="sm" variant="solid" onClick={() => setAddOpen(true)}>
                추가
              </Button>
            }
          />
        ) : (
          <div className="grid gap-5">
            <SecretList items={secrets} selected={selected} onSelect={select} />
            <SecretDetail
              secret={current}
              reveal={reveal}
              tested={state === "S1"}
              onReveal={() => setReauthOpen(true)}
              onHide={() => setReveal("hidden")}
              actions={
                <>
                  <Button size="xs" variant="ghost" disabled={offline}>
                    메타 고치기
                  </Button>
                  <Button size="xs" variant="ghost" disabled={offline}>
                    값 바꾸기
                  </Button>
                  <Button size="xs" variant="ghost" disabled={offline}>
                    테스트
                  </Button>
                  <Menu
                    align="end"
                    aria-label={`${current.name} 메뉴`}
                    trigger={
                      <Button size="xs" variant="ghost" aria-label={`${current.name} 더 보기`}>
                        <Ellipsis />
                      </Button>
                    }
                  >
                    <MenuItem>이름 복사</MenuItem>
                    <MenuItem>참조 보기</MenuItem>
                    <MenuSeparator />
                    <MenuItem tone="danger" onSelect={() => setDeleteOpen(true)}>
                      삭제
                    </MenuItem>
                  </Menu>
                </>
              }
            />
            {(state === "D-usage" || state === "D-web") && <UsageLog name={current.name} />}
          </div>
        )}
      </SettingsFrame>
      <ReauthDialog
        name={current.name}
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onContinue={() => {
          setReauthOpen(false);
          setReveal("revealed");
        }}
      />
      <AddDialog open={addOpen} onOpenChange={setAddOpen} />
      <DeleteDialog
        secret={state === "S8" ? secrets[0]! : current}
        inUse={state === "S8"}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </>
  );
}
