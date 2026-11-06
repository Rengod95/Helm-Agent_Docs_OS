// 대화 영역 오른쪽 "플러그인" 탭의 "이 대화의 프로필" 구역. 저장된 프로필 하나를 열린 대화에 적용한다(`profile.apply`, 층 `thread`).
// 프로필은 확장 하나에 묶이지 않으므로 크래프트 검사 탭이 아니라 이 탭에 둔다(크래프트는 전역만 보인다, 사용자 결정 2026-11-04).
// 목록은 연결이 살아 있을 때 읽는다. 대화가 없으면 고르기와 적용이 잠긴다.
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { Profile } from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  Field,
  Select,
  SelectOption,
  Skeleton,
} from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { useWorkbenchController } from "./controller.ts";

/** 프로필 목록의 읽기 상태 */
export type ProfileLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly value: readonly Profile[] };

const MUTED = "m-0 text-ui-sm text-text-tertiary";

function Section(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <section aria-label={props.title} className="grid content-start gap-2 p-3">
      <h3 className="m-0 min-w-0 truncate text-ui-dense font-semibold text-text-primary">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

/** 확인 대화 상자 하나. 취소는 닫기이고 실행 단추는 `onConfirm`을 부른다 */
function ConfirmDialog(props: {
  readonly open: boolean;
  readonly heading: string;
  readonly body: string;
  readonly action: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  return (
    <Dialog
      kind="alert"
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={props.heading}
      description={props.body}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.workbench.cancel")}
            </Button>
          </DialogClose>
          <DialogAction onClick={props.onConfirm}>{props.action}</DialogAction>
        </>
      }
    />
  );
}

/**
 * 이 대화의 프로필 구역: 저장된 프로필을 고르고 "적용"을 확인한 뒤 이 대화에 쓴다.
 * 대화가 없으면 고르기와 적용이 잠기고, 목록을 못 읽으면 오류 한 줄이다.
 */
export function ProfileSection(props: {
  readonly profiles: ProfileLoad;
  readonly threadOpen: boolean;
  readonly onApply: (id: string) => void;
}): ReactNode {
  const { profiles } = props;
  const title = t("desktop.inspect.profile.title");
  const [selected, setSelected] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  if (profiles.kind !== "ready") {
    return (
      <Section title={title}>
        {profiles.kind === "error" ? (
          <Alert tone="danger">{t("desktop.inspect.profile.loadFailed")}</Alert>
        ) : (
          <Skeleton height={24} />
        )}
      </Section>
    );
  }
  const chosen = profiles.value.find((profile) => profile.id === selected);
  return (
    <Section title={title}>
      {profiles.value.length === 0 ? (
        <p className={MUTED}>{t("desktop.inspect.profile.empty")}</p>
      ) : (
        <Field label={t("desktop.inspect.profile.select")}>
          <Select
            value={selected ?? ""}
            placeholder={t("desktop.inspect.profile.pick")}
            disabled={!props.threadOpen}
            onValueChange={setSelected}
          >
            {profiles.value.map((profile) => (
              <SelectOption key={profile.id} value={profile.id}>
                {profile.title}
              </SelectOption>
            ))}
          </Select>
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!props.threadOpen || chosen === undefined}
          onClick={() => {
            setAsking(true);
          }}
        >
          {t("desktop.inspect.profile.apply")}
        </Button>
      </div>
      {!props.threadOpen && <p className={MUTED}>{t("desktop.inspect.profile.noThread")}</p>}
      <ConfirmDialog
        open={asking && chosen !== undefined}
        heading={t("desktop.inspect.profile.confirm.heading")}
        body={
          chosen === undefined
            ? ""
            : t("desktop.inspect.profile.confirm.body", { title: chosen.title })
        }
        action={t("desktop.inspect.profile.apply")}
        onCancel={() => {
          setAsking(false);
        }}
        onConfirm={() => {
          setAsking(false);
          if (chosen !== undefined) props.onApply(chosen.id);
        }}
      />
    </Section>
  );
}

/** 이 대화의 프로필 구역(연결된 것). 목록을 읽고, 적용은 컨트롤러가 한다 */
export function ThreadProfile(): ReactNode {
  const commands = useCommands();
  const controller = useWorkbenchController();
  const threadId = useOpenThreadId();
  const live = useLinkPhase() === "live";
  const [profiles, setProfiles] = useState<ProfileLoad>({ kind: "loading" });
  useEffect(() => {
    if (!live) return undefined;
    const run = { stale: false };
    detach(
      (async () => {
        const got = await commands.workbench.profiles();
        if (!run.stale)
          setProfiles(got.ok ? { kind: "ready", value: got.value } : { kind: "error" });
      })(),
      rethrow,
    );
    return () => {
      run.stale = true;
    };
  }, [commands, live]);
  return (
    <ProfileSection
      profiles={profiles}
      threadOpen={threadId !== null}
      onApply={(id) => {
        if (threadId !== null) detach(controller.applyProfile(id, threadId), rethrow);
      }}
    />
  );
}
