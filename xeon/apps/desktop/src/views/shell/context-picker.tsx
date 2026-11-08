// 작업대 영역의 맥락 칸(§4.9.3, V-25). 값은 "전체"와 프로필 하나뿐이다(크래프트는 대화 범위를 다루지 않는다).
// 프로필 목록이 비면 고를 값이 "전체" 하나이므로 칸을 그리지 않는다.
import { t } from "@fresnel/client/i18n";
import { Select, SelectGroup, SelectHeading, SelectOption } from "@caustic/react";
import type { ReactNode } from "react";
import { useShell, useShellActions, type WorkbenchContext } from "../../state/shell/index.ts";

/** 프로필 목록은 프로필 화면 트랙(T-BENCH)이 채운다. 셸은 그 값을 받아 칸에 올릴 뿐이다 */
export interface ContextProfile {
  readonly id: string;
  readonly title: string;
}

const PROFILE_PREFIX = "profile:";

function encodeContext(c: WorkbenchContext): string {
  return c.kind === "all" ? "all" : `${PROFILE_PREFIX}${c.profileId}`;
}

export function ContextPicker(props: { readonly profiles: readonly ContextProfile[] }): ReactNode {
  const context = useShell((s) => s.context);
  const actions = useShellActions();
  if (props.profiles.length === 0) return null;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        size="xs"
        variant="soft"
        aria-label={t("desktop.shell.context.label")}
        value={encodeContext(context)}
        onValueChange={(value) => {
          if (value.startsWith(PROFILE_PREFIX)) {
            actions.setContextKind("profile", value.slice(PROFILE_PREFIX.length));
          } else {
            actions.setContextKind("all");
          }
        }}
        className="min-w-0 flex-1"
      >
        <SelectOption value="all">
          {t("desktop.shell.context.label")} · {t("desktop.shell.context.all")}
        </SelectOption>
        <SelectGroup>
          <SelectHeading>{t("desktop.shell.context.profile")}</SelectHeading>
          {props.profiles.map((p) => (
            <SelectOption key={p.id} value={`${PROFILE_PREFIX}${p.id}`}>
              {context.kind === "profile" && context.profileId === p.id
                ? `${t("desktop.shell.context.profile")} · ${p.title}`
                : p.title}
            </SelectOption>
          ))}
        </SelectGroup>
      </Select>
    </div>
  );
}
