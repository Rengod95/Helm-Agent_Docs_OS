// 플러그인의 화면, 대화 기능, 권한 줄(플레이그라운드와 크래프트 상세 "화면과 설정" 탭이 같이 쓴다, AGE-76 plugMin).
// 플레이그라운드는 화면 줄만 쓰고(여는 곳), 관리(기능 실행, 설정, 앱 화면 허용, 권한)는 크래프트 상세가 맡는다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { BridgeCapability } from "@fresnel/contracts/extensions";
import type { ExtTrust } from "@fresnel/contracts/wire";
import { Alert, Badge, Button, Chip } from "@caustic/react";
import {
  Bell,
  CodeXml,
  Command,
  FolderOpen,
  History,
  KeyRound,
  MessageSquare,
  Monitor,
  PanelBottom,
  PanelRight,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  TriangleAlert,
} from "@caustic/react/icons";
import { useId, type ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";
import type {
  AddonDetail,
  AddonFeature,
  AddonFeatureKind,
  AddonProblem,
  AddonRisk,
  AddonScreen,
} from "./addon-model.ts";
import { ORIGIN_TEXT } from "./plugin-card.tsx";

/** 화면과 기능 줄의 동작. 부르는 화면이 셸과 명령으로 채운다 */
export interface SurfaceOps {
  readonly onOpenScreen: (screen: AddonScreen) => void;
  /** 명령 기능 실행 */
  readonly onRunCommand: (feature: AddonFeature) => void;
  /** 막힌 플러그인 앱 화면: 설정 > 플러그인 > 앱 화면 허용으로 */
  readonly onAllowApps: () => void;
}

const ICON = "size-4 flex-none text-text-tertiary";
/** 줄 목록 카드(설정 카드와 같은 면·선·반경) */
export const CARD =
  "m-0 grid list-none overflow-hidden rounded-xl bg-surface-base p-0 py-1 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] [&>*+*]:border-t [&>*+*]:border-border-subtle";
/** 카드 안 줄: 좌우 16, 최소 48 */
const ROW = "flex min-h-12 min-w-0 items-center gap-3 px-4 py-2";

/** 구역: 16/22 600 제목(+ 연한 개수), 제목과 내용 8 */
export function Section(props: {
  readonly title: string;
  readonly count?: number | undefined;
  readonly end?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <div className="flex min-h-7 items-center gap-2">
        <h2 id={id} className="m-0 flex flex-1 items-baseline gap-2 text-title-2 text-text-primary">
          {props.title}
          {props.count === undefined ? null : (
            <span className="text-ui font-normal text-text-tertiary">{props.count}</span>
          )}
        </h2>
        {props.end}
      </div>
      {props.children}
    </section>
  );
}

const TRUST_BODY: Readonly<Record<ExtTrust, MessageId>> = {
  builtin: "desktop.addons.trust.builtin.body",
  managed: "desktop.addons.trust.managed.body",
  user: "desktop.addons.trust.user.body",
  project: "desktop.addons.trust.project.body",
};

const CAPABILITY: Readonly<
  Record<
    BridgeCapability,
    { readonly icon: ReactNode; readonly title: MessageId; readonly body: MessageId }
  >
> = {
  files: {
    icon: <FolderOpen aria-hidden className={ICON} />,
    title: "desktop.addons.cap.files.title",
    body: "desktop.addons.cap.files.body",
  },
  notify: {
    icon: <Bell aria-hidden className={ICON} />,
    title: "desktop.addons.cap.notify.title",
    body: "desktop.addons.cap.notify.body",
  },
  settingsWrite: {
    icon: <SlidersHorizontal aria-hidden className={ICON} />,
    title: "desktop.addons.cap.settingsWrite.title",
    body: "desktop.addons.cap.settingsWrite.body",
  },
  secrets: {
    icon: <KeyRound aria-hidden className={ICON} />,
    title: "desktop.addons.cap.secrets.title",
    body: "desktop.addons.cap.secrets.body",
  },
};

const FEATURE: Readonly<
  Record<
    AddonFeatureKind,
    { readonly icon: ReactNode; readonly label: MessageId; readonly where: MessageId }
  >
> = {
  panel: {
    icon: <PanelRight aria-hidden className={ICON} />,
    label: "desktop.addons.feature.panel",
    where: "desktop.addons.where.panelFeature",
  },
  card: {
    icon: <MessageSquare aria-hidden className={ICON} />,
    label: "desktop.addons.feature.card",
    where: "desktop.addons.where.card",
  },
  command: {
    icon: <Command aria-hidden className={ICON} />,
    label: "desktop.addons.feature.command",
    where: "desktop.addons.where.command",
  },
  status: {
    icon: <PanelBottom aria-hidden className={ICON} />,
    label: "desktop.addons.feature.status",
    where: "desktop.addons.where.status",
  },
  settings: {
    icon: <SlidersHorizontal aria-hidden className={ICON} />,
    label: "desktop.addons.feature.settings",
    where: "desktop.addons.where.settings",
  },
};

function problemText(problem: AddonProblem): string {
  switch (problem.kind) {
    case "off":
      return t("desktop.addons.problem.off");
    case "safeMode":
      return t("desktop.addons.problem.safeMode");
    case "invalid":
      return t("desktop.addons.problem.invalid", { count: problem.count });
    case "blocked":
      return t("desktop.addons.problem.blocked", { count: problem.count });
    default:
      return assertNever(problem, "problemText");
  }
}

/** 화면 줄 끝의 상태. 플러그인 전체가 꺼졌으면 머리 띠가 이미 말하므로 줄마다 "꺼짐"을 되풀이하지 않는다 */
function screenStateText(screen: AddonScreen, pluginOff: boolean): ReactNode {
  switch (screen.state) {
    case "ready":
      return null;
    case "off":
      return pluginOff ? null : <Badge size="sm">{t("desktop.addons.badge.off")}</Badge>;
    case "invalid":
      return (
        <span className="text-ui-sm font-normal text-danger-text">
          {t("desktop.addons.screen.invalid")}
        </span>
      );
    case "blocked":
      return (
        <span className="text-ui-sm font-normal text-warning-text">
          {t("desktop.addons.screen.blocked")}
        </span>
      );
    default:
      return assertNever(screen.state, "screenStateText");
  }
}

export function ScreenRow(props: {
  readonly screen: AddonScreen;
  readonly pluginOff: boolean;
  readonly ops: SurfaceOps;
  /** 사용자가 숨긴 화면이면 참: "열기"가 꺼진다(숨긴 화면은 앱 어디에도 열리지 않는다, AGE-73) */
  readonly hidden?: boolean;
  /** 줄 끝 칸(크래프트 "화면과 설정" 탭의 순서 메뉴와 보이기 스위치). 플레이그라운드는 비운다 */
  readonly end?: ReactNode;
  /** 참이면 자리 이름("전체 화면" 등)이 첫 줄, 제목이 둘째 줄이다(같은 제목이 두 자리에 있을 때 스위치와 줄을 짝짓는다) */
  readonly placeFirst?: boolean;
}): ReactNode {
  const { screen, ops } = props;
  return (
    <li className={ROW}>
      {screen.where === "panel" ? (
        <PanelRight aria-hidden className={ICON} />
      ) : (
        <Monitor aria-hidden className={ICON} />
      )}
      <span className="grid min-w-0 flex-1">
        {props.placeFirst === true ? (
          <>
            <span className="truncate text-ui font-medium text-text-primary">
              {t(
                screen.where === "panel"
                  ? "desktop.addons.where.panel"
                  : "desktop.addons.where.page",
              )}
            </span>
            <span className="truncate text-ui text-text-tertiary">
              {screen.issue ?? screen.title}
            </span>
          </>
        ) : (
          <>
            <span className="truncate text-ui font-medium text-text-primary">{screen.title}</span>
            <span className="truncate text-ui text-text-tertiary">
              {screen.issue ??
                t(
                  screen.where === "panel"
                    ? "desktop.addons.where.panel"
                    : "desktop.addons.where.page",
                )}
            </span>
          </>
        )}
      </span>
      {screen.app ? (
        <Chip size="sm" tone="neutral" variant="soft" icon={<CodeXml aria-hidden />}>
          {t("desktop.workbench.uiMode.app")}
        </Chip>
      ) : null}
      {screenStateText(screen, props.pluginOff)}
      {screen.state === "blocked" ? (
        <Button size="sm" variant="ghost" onClick={ops.onAllowApps}>
          {t("desktop.addons.allowApps")}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={screen.state !== "ready" || props.hidden === true}
          onClick={() => {
            ops.onOpenScreen(screen);
          }}
        >
          {t("desktop.addons.detail.open")}
        </Button>
      )}
      {props.end}
    </li>
  );
}

export function FeatureRow(props: {
  readonly feature: AddonFeature;
  readonly pluginOff: boolean;
  readonly ops: SurfaceOps;
  /** 사용자가 숨긴 기능이면 참: 명령의 "실행"이 꺼진다 */
  readonly hidden?: boolean;
  /** 줄 끝 칸(순서 메뉴와 보이기 스위치) */
  readonly end?: ReactNode;
  /** 참이면 자리 이름이 첫 줄, 제목이 둘째 줄이다(`ScreenRow`와 같다) */
  readonly placeFirst?: boolean;
}): ReactNode {
  const { feature, ops } = props;
  const look = FEATURE[feature.kind];
  return (
    <li className={ROW}>
      {look.icon}
      <span className="grid min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-ui font-medium text-text-primary">
            {props.placeFirst === true ? t(look.label) : feature.title}
          </span>
          <InfoTip text={t(look.where)} />
        </span>
        <span className="text-ui text-text-tertiary">
          {props.placeFirst === true ? feature.title : t(look.label)}
        </span>
      </span>
      {feature.off && !props.pluginOff ? (
        <Badge size="sm">{t("desktop.addons.badge.off")}</Badge>
      ) : null}
      {feature.kind === "command" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={feature.off || props.hidden === true}
          iconStart={<Terminal aria-hidden />}
          onClick={() => {
            ops.onRunCommand(feature);
          }}
        >
          {t("desktop.addons.feature.run")}
        </Button>
      ) : null}
      {props.end}
    </li>
  );
}

function riskLine(risk: AddonRisk): {
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
  readonly danger: boolean;
} {
  switch (risk.kind) {
    case "toolHooks":
      return {
        icon: <TriangleAlert aria-hidden className="size-4 flex-none text-warning-text" />,
        title: t("desktop.addons.risk.toolHooks.title"),
        body: t("desktop.addons.risk.toolHooks.body", { hooks: risk.hooks.join(", ") }),
        danger: true,
      };
    case "requestHooks":
      return {
        icon: <TriangleAlert aria-hidden className="size-4 flex-none text-warning-text" />,
        title: t("desktop.addons.risk.requestHooks.title"),
        body: t("desktop.addons.risk.requestHooks.body", { hooks: risk.hooks.join(", ") }),
        danger: true,
      };
    case "otherHooks":
      return {
        icon: <History aria-hidden className={ICON} />,
        title: t("desktop.addons.risk.otherHooks.title", { count: risk.count }),
        body: t("desktop.addons.risk.otherHooks.body"),
        danger: false,
      };
    case "methods":
      return {
        icon: <Command aria-hidden className={ICON} />,
        title:
          risk.writes > 0
            ? t("desktop.addons.risk.methods.write", { count: risk.writes })
            : t("desktop.addons.risk.methods.read", { count: risk.methods.length }),
        body: risk.methods
          .map((method) =>
            method.approval
              ? t("desktop.addons.risk.methods.approval", { verb: method.verb })
              : method.verb,
          )
          .join(", "),
        danger: false,
      };
    case "capability":
      return {
        icon: CAPABILITY[risk.capability].icon,
        title: t(CAPABILITY[risk.capability].title),
        body: t(CAPABILITY[risk.capability].body),
        danger: false,
      };
    default:
      return assertNever(risk, "riskLine");
  }
}

export function RiskSection(props: { readonly detail: AddonDetail }): ReactNode {
  const { detail } = props;
  const { row } = detail;
  const none = detail.risksKnown && detail.risks.length === 0;
  return (
    <Section title={t("desktop.addons.section.access")}>
      <ul aria-label={t("desktop.addons.section.access")} className={CARD}>
        {detail.risks.map((risk, index) => {
          const line = riskLine(risk);
          return (
            <li key={`${risk.kind}-${String(index)}`} className={ROW}>
              {line.icon}
              <span className="grid min-w-0 flex-1">
                <span className="text-ui font-medium text-text-primary">{line.title}</span>
                <span className="text-ui text-text-tertiary">{line.body}</span>
              </span>
            </li>
          );
        })}
        <li className={ROW}>
          <ShieldCheck aria-hidden className={ICON} />
          <span className="grid min-w-0 flex-1">
            <span className="text-ui font-medium text-text-primary">
              {t(ORIGIN_TEXT[row.trust])}
            </span>
            <span className="text-ui text-text-tertiary">{t(TRUST_BODY[row.trust])}</span>
          </span>
        </li>
      </ul>
      <p className="m-0 text-ui text-text-tertiary">
        {none
          ? t("desktop.addons.access.none")
          : detail.hasApp
            ? t("desktop.addons.access.confirm")
            : detail.risksKnown
              ? null
              : t("desktop.addons.access.unknown")}
      </p>
    </Section>
  );
}

/** 꺼짐, 안전 모드, 열 수 없는 화면 띠. 막힌 앱 화면이 있으면 "앱 화면 허용" 단추를 단다 */
export function ProblemsNotice(props: {
  readonly problems: readonly AddonProblem[];
  readonly onAllowApps: () => void;
}): ReactNode {
  const { problems } = props;
  if (problems.length === 0) return null;
  return (
    <Alert
      variant="outline"
      tone={problems.some((problem) => problem.kind === "invalid") ? "danger" : "neutral"}
      {...(problems.some((problem) => problem.kind === "blocked")
        ? { actions: [{ label: t("desktop.addons.allowApps"), onClick: props.onAllowApps }] }
        : {})}
    >
      {problems.map(problemText).join(" ")}
    </Alert>
  );
}
