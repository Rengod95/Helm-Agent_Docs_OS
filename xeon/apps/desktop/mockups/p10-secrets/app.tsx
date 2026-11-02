// P-10 시크릿: 값 없는 목록 + 고른 시크릿의 상세(ListDescription) + 값 보기 흐름(O-05 재인증 → 30초 표시 → 자동 가림) + 추가 + 삭제(O-06).
import { Button, EmptyState, Menu, MenuItem, MenuSeparator } from "@caustic/react";
import { useState } from "react";
import { Ellipsis, FlaskConical, KeyRound, Pencil, Plus, Trash2 } from "../_shell";
import { SettingsFrame } from "../_settings/frame";
import { gotoTabPage, type TabId } from "../_settings/tabs";
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
        meta={empty ? undefined : `${secrets.length}개`}
        modalOpen={reauthOpen || addOpen || deleteOpen}
        actions={
          empty ? undefined : (
            <Button
              size="xs"
              tone="neutral"
              variant="outline"
              iconStart={<Plus />}
              onClick={() => setAddOpen(true)}
            >
              추가
            </Button>
          )
        }
      >
        {empty ? (
          <EmptyState
            size="sm"
            surface="none"
            icon={<KeyRound />}
            title="등록된 시크릿이 없어요"
            description="API 키와 토큰을 값 없이 이름으로 써요."
            actions={
              <Button
                size="sm"
                tone="neutral"
                variant="solid"
                iconStart={<Plus />}
                onClick={() => setAddOpen(true)}
              >
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
                  <Button size="xs" tone="neutral" variant="ghost" iconStart={<Pencil />}>
                    메타 고치기
                  </Button>
                  <Button size="xs" tone="neutral" variant="ghost" iconStart={<KeyRound />}>
                    값 바꾸기
                  </Button>
                  <Button size="xs" tone="neutral" variant="ghost" iconStart={<FlaskConical />}>
                    테스트
                  </Button>
                  <Menu
                    align="end"
                    aria-label={`${current.name} 메뉴`}
                    trigger={
                      <Button
                        size="xs"
                        tone="neutral"
                        variant="ghost"
                        aria-label={`${current.name} 더 보기`}
                      >
                        <Ellipsis />
                      </Button>
                    }
                  >
                    <MenuItem>이름 복사</MenuItem>
                    <MenuItem>참조 보기</MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => setDeleteOpen(true)}>
                      삭제
                    </MenuItem>
                  </Menu>
                </>
              }
            />
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
