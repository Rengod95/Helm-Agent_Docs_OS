import { Alert, ListDescription, ListDescriptionRow } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow, type Result } from "@fresnel/contracts";
import type { TrustListEntry, TrustListResult } from "@fresnel/contracts/wire";
import { useEffect, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useCommands, type CommandError } from "../../commands.ts";
import { InfoTip } from "../../craft/info-tip.tsx";
import { shortenHome } from "./settings-file-paths.ts";
import { ROWS_CLASS } from "./settings-overview.tsx";
import { SettingSection } from "./settings-section.tsx";

// 개요 탭의 "신뢰한 폴더" 구역(읽기 전용). 저장 파일의 결정을 `trust.list`로 읽어 경로와 허용·거부를 보인다.
// 지울 수 있는 길은 아직 없어 설명은 정보 아이콘 뒤에 둔다(DP-58). 구형 host(`unsupported`)에서는 구역을 그리지 않는다.

/** 읽은 목록의 모양. `null`이면 구역을 그리지 않는다 */
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

/** 구역 하나. 목록이 비었으면 빈 상태 글이다 */
export function TrustedFoldersView(props: { readonly state: TrustedFoldersState }): ReactNode {
  const { state } = props;
  return (
    <SettingSection
      title={t("desktop.settings.trust.title")}
      end={<InfoTip text={t("desktop.settings.trust.info")} />}
    >
      {state.kind === "failed" ? (
        <Alert tone="danger">{t("desktop.settings.trust.loadFailed")}</Alert>
      ) : state.entries.length === 0 ? (
        <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.settings.trust.empty")}</p>
      ) : (
        <ListDescription
          variant="ghost"
          size="xs"
          aria-label={t("desktop.settings.trust.title")}
          className={ROWS_CLASS}
        >
          {state.entries.map((entry) => (
            <ListDescriptionRow
              key={entry.path}
              term={shortenHome(entry.path)}
              mono
              copyValue={entry.path}
            >
              {entry.verdict === "allow"
                ? t("desktop.settings.trust.allow")
                : t("desktop.settings.trust.deny")}
            </ListDescriptionRow>
          ))}
        </ListDescription>
      )}
    </SettingSection>
  );
}

/** 연결이 살아 있을 때 목록을 읽는 구역. 읽는 중과 메서드가 없는 host에서는 그리지 않는다 */
export function TrustedFoldersPanel(): ReactNode {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [state, setState] = useState<TrustedFoldersState | null>(null);

  useEffect(() => {
    let stale = false;
    if (live) {
      detach(
        commands.trust.list().then((result) => {
          if (stale) return undefined;
          setState(trustedFoldersStateOf(result));
          return undefined;
        }),
        rethrow,
      );
    }
    return () => {
      stale = true;
    };
  }, [commands, live]);

  if (!live || state === null) return null;
  return <TrustedFoldersView state={state} />;
}
