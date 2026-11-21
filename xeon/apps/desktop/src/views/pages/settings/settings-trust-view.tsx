import { Alert } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow, type Result } from "@fresnel/contracts";
import type { SettingKey } from "@fresnel/contracts/settings";
import type { TrustListEntry, TrustListResult } from "@fresnel/contracts/wire";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useCommands, type CommandError } from "../../commands.ts";
import { relativeAgeOf } from "../shared/relative-age.ts";
import { VerdictTable, type Verdict, type VerdictRow } from "../shared/verdict-table.tsx";
import { FieldRow } from "./settings-field.tsx";
import { shortenHome } from "./settings-file-paths.ts";
import { RowNote, SettingSection } from "./settings-section.tsx";
import {
  fieldOf,
  savedEndOf,
  verdictLabelOf,
  type PermissionPanelProps,
} from "./settings-rules-panel.tsx";

// 설정 "권한"의 "작업 폴더 신뢰" 구역(DP-109 [결정: 2026-11-11 사용자]). 맨 위 줄은 처음 여는 폴더의 기본값
// (`x.loading-trust.defaultProjectTrust`), 그 아래는 저장된 결정(`trust.list`)의 판정 표(폴더 · 허용/막기 · 저장한 때)다.
// 판정을 바꾸면 `trust.decide {kind: "folder"}`로 그 폴더의 결정을 다시 저장하고 목록을 다시 읽는다.
// 지우기 칸은 `trust.remove`로 그 폴더의 저장된 결정을 바로 지운다(확인 없음, 권한 규칙·웹 도메인 줄과 같다). 지운 폴더는 미결정이라 다음에 열 때 다시 묻는다.
// 구형 host(`unsupported`)는 표를 그리지 않는다.

const DEFAULT_TRUST_KEY: SettingKey = "x.loading-trust.defaultProjectTrust";

/** 읽은 목록의 모양. `null`이면 표를 그리지 않는다 */
export type TrustedFoldersState =
  | { readonly kind: "ready"; readonly entries: readonly TrustListEntry[] }
  | { readonly kind: "failed" };

/** `trust.list` 결과를 구역의 모양으로 바꾼다. 메서드가 없는 host는 `null`이다 */
export function trustedFoldersStateOf(
  result: Result<TrustListResult, CommandError>,
): TrustedFoldersState | null {
  if (result.ok) return { kind: "ready", entries: result.value.entries };
  return result.error.kind === "unsupported" ? null : { kind: "failed" };
}

/** 저장한 때(상대 시각). 옛 파일이라 없거나 읽을 수 없으면 빈 글 */
export function savedAgeTextOf(savedAt: string | undefined, nowMs: number): string {
  if (savedAt === undefined) return "";
  const at = Date.parse(savedAt);
  if (Number.isNaN(at)) return "";
  const age = relativeAgeOf(at, nowMs);
  return t(age.id, age.args);
}

export interface TrustedFoldersViewProps {
  readonly state: TrustedFoldersState;
  /** 결정을 다시 쓰는 중인 폴더 */
  readonly busy: ReadonlySet<string>;
  readonly error: string | null;
  readonly disabled: boolean;
  readonly nowMs: number;
  readonly onDecide: (path: string, verdict: "allow" | "deny") => void;
  /** 저장된 결정을 지운다(`trust.remove`) */
  readonly onRemove: (path: string) => void;
}

/** 저장된 결정의 판정 표. 비었으면 한 줄 안내, 읽기 실패면 그 사실 */
export function TrustedFoldersView(props: TrustedFoldersViewProps): ReactNode {
  const { state } = props;
  if (state.kind === "failed") {
    return (
      <Alert tone="danger" variant="outline" emphasis="lead" size="sm">
        {t("desktop.settings.trust.loadFailed")}
      </Alert>
    );
  }
  const rows: readonly VerdictRow[] = state.entries.map((entry) => ({
    key: entry.path,
    subject: shortenHome(entry.path),
    subjectTitle: entry.path,
    verdict: entry.verdict,
    locked: props.busy.has(entry.path),
    cells: [
      <span key="age" className="block truncate text-ui-sm text-text-tertiary">
        {savedAgeTextOf(entry.savedAt, props.nowMs)}
      </span>,
    ],
  }));
  return (
    <div className="grid gap-2">
      <VerdictTable
        label={t("desktop.settings.trust.title")}
        subjectHeader={t("desktop.settings.trust.column.folder")}
        verdictHeader={t("desktop.settings.perm.rules.column.verdict")}
        extraColumns={[{ header: t("desktop.settings.trust.column.saved"), track: "6rem" }]}
        choices={["allow", "deny"]}
        verdictLabel={verdictLabelOf}
        rows={rows}
        disabled={props.disabled}
        onVerdict={(path, verdict: Verdict) => {
          if (verdict !== "ask") props.onDecide(path, verdict);
        }}
        onRemove={props.onRemove}
        removeLabel={(row) =>
          t("desktop.settings.trust.remove", { folder: row.subjectTitle ?? row.key })
        }
        emptyText={t("desktop.settings.trust.empty")}
      />
      {props.error === null ? null : <RowNote tone="danger">{props.error}</RowNote>}
    </div>
  );
}

/** 구역 하나: 기본값 줄 카드 + 이어서 결정 표. 표는 연결이 살아 있을 때 읽는다 */
export function TrustedFoldersPanel(props: PermissionPanelProps): ReactNode {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [state, setState] = useState<TrustedFoldersState | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  // 표의 "저장한 때"를 잴 기준 시각. 구역을 열 때 한 번 정한다
  const [nowMs] = useState(Date.now);
  const field = fieldOf(props.view, DEFAULT_TRUST_KEY);

  const load = useCallback((): void => {
    detach(
      commands.trust.list().then((result) => {
        setState(trustedFoldersStateOf(result));
        return undefined;
      }),
      rethrow,
    );
  }, [commands]);

  useEffect(() => {
    if (live) load();
  }, [live, load]);

  /** 줄 하나를 쓴다: 쓰는 동안 그 줄을 잠그고, 끝나면 실패 글을 보이고 목록을 다시 읽는다 */
  const write = useCallback(
    (path: string, send: () => Promise<Result<unknown, CommandError>>, failure: string): void => {
      setBusy((prev) => new Set([...prev, path]));
      setError(null);
      detach(
        send().then((result) => {
          setBusy((prev) => new Set([...prev].filter((item) => item !== path)));
          if (!result.ok) setError(failure);
          load();
          return undefined;
        }),
        rethrow,
      );
    },
    [load],
  );

  const decide = useCallback(
    (path: string, verdict: "allow" | "deny"): void => {
      write(
        path,
        () => commands.trust.decide(path, { kind: "folder", verdict }),
        t("desktop.settings.trust.decideFailed"),
      );
    },
    [commands, write],
  );

  const remove = useCallback(
    (path: string): void => {
      write(path, () => commands.trust.remove(path), t("desktop.settings.trust.removeFailed"));
    },
    [commands, write],
  );

  return (
    <>
      <SettingSection
        title={t("desktop.settings.trust.section")}
        end={savedEndOf(props.saved, [DEFAULT_TRUST_KEY])}
      >
        {field === undefined ? null : (
          <FieldRow
            field={field}
            editable={field.editable && (props.live || field.origin === "desktop")}
            saved={props.saved.has(DEFAULT_TRUST_KEY)}
            editors={props.editors}
            handlers={props.handlers}
          />
        )}
      </SettingSection>
      {!live || state === null ? null : (
        <SettingSection continues body="bare" label={t("desktop.settings.trust.title")}>
          <TrustedFoldersView
            state={state}
            busy={busy}
            error={error}
            disabled={!live}
            nowMs={nowMs}
            onDecide={decide}
            onRemove={remove}
          />
        </SettingSection>
      )}
    </>
  );
}
