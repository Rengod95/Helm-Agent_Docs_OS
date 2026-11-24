// 플러그인 상세 "개요" 탭(plugTab, AGE-76). 한 질문에 답한다: 이것은 무엇이고 믿을 만한가.
// 맨 위는 진단 경고(전체 폭, 숨기지 않는다). 왼쪽 단 "하는 일": 목적, 설명, 종류와 셈(Hook, 도구, Drive).
// 오른쪽 단 "쓰임과 믿음": 쓰는 프로필, 설치 위치, 비용(늘 드는 토큰), 권한, 준비 상태(도구 플러그인이거나 도구에 기댈 때, `tool-ready.ts`).
import { t } from "@fresnel/client/i18n";
import { rowOf } from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { Alert, Button, ListDescription, ListDescriptionRow, toast } from "@caustic/react";
import { CircleCheck, Clock, TriangleAlert } from "@caustic/react/icons";
import { useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { revealFullOutput } from "../convo/reveal-full-output.ts";
import { useDesktopShell, type DesktopShell } from "../desktop-shell-context.ts";
import { tokens } from "../craft/canvas/cv6/words.ts";
import { useAddonData } from "../plugin/addon-data.ts";
import { addonDetailOf } from "../plugin/addon-model.ts";
import { RiskSection } from "../plugin/addon-parts.tsx";
import { KindTag, pluginKindOf } from "./plugin-kind.tsx";
import { originText } from "./origin-text.ts";
import {
  LOCATION_LIMIT,
  locationTextOf,
  middleEllipsisOf,
  revealablePathOf,
} from "./location-text.ts";
import type { ProfileSetLoad } from "./profile-put-menu.tsx";
import { ColumnHead, MUTED, TwoColumns } from "./tab-body.tsx";
import { profileTitleOf } from "../convo/profile-chip-model.ts";
import { profileUseOf, profileUseText, type ProfileUse } from "./profile-use.ts";
import {
  cardLeadOf,
  cardTextIn,
  hookCountOf,
  profilesWithOf,
  readinessWordOf,
  toolCountOf,
} from "./overview-model.ts";
import { needsAttentionOf, type ToolNeedVM, type ToolReadinessVM } from "./tool-ready.ts";

/** 설명 목록 자리: 줄 머리 8rem, 바깥 칸 없이(`ext-detail.tsx`의 옛 자리와 같다). 크기는 sm(줄 36 이상, 글 13, plugSize) */
/** 긴 문단의 줄 길이(plugSize): 내용 칸은 넓게 쓰고, 문단만 720px(`max-w-180`, 설정 표 구역과 같은 눈금)에서 줄을 바꾼다 */
const PROSE = "max-w-180";

const LD = "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

export function DetailOverview(props: {
  readonly entry: ExtListEntry;
  readonly card: PluginCard | null;
  /** 준비 상태(`toolReadinessOf`). 도구 플러그인도 아니고 도구에 기대지도 않으면 null이라 구역을 그리지 않는다 */
  readonly readiness: ToolReadinessVM | null;
  readonly profiles: ProfileSetLoad;
  readonly onRecheck: () => void;
}): ReactNode {
  const { entry, card } = props;
  return (
    <div className="grid gap-8">
      {entry.diagnostics.length === 0 ? null : (
        <section aria-label={t("desktop.workbench.detail.diagnostics")} className="grid gap-1">
          {entry.diagnostics.map((d) => (
            <Alert
              key={`${d.code}:${d.message}`}
              tone={d.severity === "error" ? "danger" : "warning"}
              layout="inline"
              size="sm"
            >
              {d.message}
              {d.file !== undefined && (
                <span className="font-mono">
                  {" "}
                  {d.file}
                  {d.line === undefined ? "" : `:${d.line}`}
                </span>
              )}
            </Alert>
          ))}
        </section>
      )}
      <TwoColumns
        start={<DoesColumn card={card} />}
        end={
          <TrustColumn
            entry={entry}
            card={card}
            readiness={props.readiness}
            profiles={props.profiles}
            onRecheck={props.onRecheck}
          />
        }
      />
    </div>
  );
}

/** 왼쪽 단 "하는 일": 목적(굵게), 설명, 종류와 셈. 카드를 못 읽었으면 한 줄이다 */
function DoesColumn(props: { readonly card: PluginCard | null }): ReactNode {
  const { card } = props;
  const head = <ColumnHead title={t("desktop.workbench.detail.overview.does")} />;
  if (card === null) {
    return (
      <div className="grid gap-4">
        {head}
        <p className={MUTED}>{t("desktop.workbench.detail.overview.noCard")}</p>
      </div>
    );
  }
  // 카드와 같은 규칙: 목적이 있으면 목적, 없으면 설명의 첫 문장, 둘 다 없으면 "목적이 없어요"(rerun4 U-01).
  // 첫 줄이 설명을 올렸거나 설명과 같은 글이면 아래 설명 줄은 그리지 않는다(같은 글을 두 번 보이지 않게)
  const lead = cardLeadOf(card);
  const description = cardTextIn(card, "description");
  const kind = pluginKindOf(card);
  const hooks = hookCountOf(card);
  const tools = toolCountOf(card);
  return (
    <div className="grid gap-4">
      {head}
      {lead === null ? (
        <p className={MUTED}>{t("desktop.workbench.detail.overview.noPurpose")}</p>
      ) : (
        <p className={`m-0 text-ui-lg text-text-primary ${PROSE}`}>{lead.text}</p>
      )}
      {description === null ||
      lead?.fromDescription === true ||
      description === lead?.text ? null : (
        <p className={`m-0 text-ui-dense-relaxed text-text-secondary ${PROSE}`}>{description}</p>
      )}
      <ListDescription
        variant="ghost"
        size="sm"
        aria-label={t("desktop.workbench.detail.overview.does")}
        className={LD}
      >
        {kind === null ? null : (
          <ListDescriptionRow term={t("desktop.workbench.detail.overview.kind")}>
            <KindTag kind={kind} />
          </ListDescriptionRow>
        )}
        {hooks > 0 && (
          <ListDescriptionRow term={t("desktop.craft.canvas.cv3.part.hooks")}>
            {String(hooks)}
          </ListDescriptionRow>
        )}
        {tools > 0 && (
          <ListDescriptionRow term={t("desktop.craft.canvas.cv3.cost.toolCount")}>
            {String(tools)}
          </ListDescriptionRow>
        )}
        {card.does.drive === null ? null : (
          <ListDescriptionRow term={t("desktop.craft.canvas.cv3.part.steps")}>
            {t("desktop.workbench.detail.overview.yes")}
          </ListDescriptionRow>
        )}
      </ListDescription>
    </div>
  );
}

/**
 * 오른쪽 단 "쓰임과 믿음": 쓰는 프로필, 설치 위치, 비용, 권한, 준비 상태.
 * 권한은 화면과 설정 탭에서 옮겼고(`useAddonData`로 읽는다), 준비 상태는 값이 있을 때만 그린다
 */
function TrustColumn(props: {
  readonly entry: ExtListEntry;
  readonly card: PluginCard | null;
  readonly readiness: ToolReadinessVM | null;
  readonly profiles: ProfileSetLoad;
  readonly onRecheck: () => void;
}): ReactNode {
  const { entry, card } = props;
  const row = rowOf(entry);
  const data = useAddonData(true, true);
  const detail =
    data.phase === "ready"
      ? addonDetailOf(entry.name, data.source, data.meta, data.locale)
      : undefined;
  const set = props.profiles.set;
  const use: ProfileUse | null = set === null ? null : profileUseOf(entry.name, row.appCore, set);
  const cost = card === null ? null : card.cost.always;
  const readiness = props.readiness;
  return (
    <div className="grid gap-4">
      <ColumnHead title={t("desktop.workbench.detail.overview.trust")} />
      <ListDescription
        variant="ghost"
        size="sm"
        aria-label={t("desktop.workbench.detail.overview.trust")}
        className={LD}
      >
        {set === null || use === null ? null : (
          <ListDescriptionRow term={t("desktop.workbench.detail.overview.profiles")}>
            {use.kind === "profiles" ? (
              <span className="grid justify-items-start">
                {profilesWithOf(entry.name, set.profiles).map((profile) => (
                  <span key={profile.id}>{profileTitleOf(profile.id, profile.title)}</span>
                ))}
              </span>
            ) : (
              profileUseText(use)
            )}
          </ListDescriptionRow>
        )}
        <ListDescriptionRow term={t("desktop.workbench.detail.origin")}>
          <LocationValue origin={originText(entry.origin)} location={entry.location} />
        </ListDescriptionRow>
        {cost === null ? null : (
          <ListDescriptionRow term={t("desktop.craft.canvas.cv3.sec.cost")}>
            {`${t("desktop.craft.canvas.cv3.cost.always")} ${tokens(cost)}`}
          </ListDescriptionRow>
        )}
      </ListDescription>
      {detail === undefined ? null : <RiskSection detail={detail} />}
      {readiness === null ? null : (
        <ReadinessSection readiness={readiness} onRecheck={props.onRecheck} />
      )}
    </div>
  );
}

/** 데이터 폴더 경로를 이 실행 동안 한 번 알아 둔다(한 번 읽으면 다시 셸을 부르지 않는다). 모르면 null */
let knownDataDir: string | null = null;

/**
 * 데이터 폴더 경로. 클라이언트는 이 값을 연결 응답으로 받지 않으므로, 셸의 저장 공간 읽기(`db usage`)로 한 번 읽는다.
 * 읽지 못하면(웹 셸, 실패) null이고 설치 위치는 홈 줄이기만 한다
 */
function useDataDir(): string | null {
  const commands = useCommands();
  const [dir, setDir] = useState<string | null>(knownDataDir);
  useEffect(() => {
    if (knownDataDir !== null) return undefined;
    let stale = false;
    detach(
      commands.storage.usage().then((read) => {
        if (!read.ok) return undefined;
        knownDataDir = read.value.dataDir;
        if (!stale) setDir(read.value.dataDir);
        return undefined;
      }),
      rethrow,
    );
    return () => {
      stale = true;
    };
  }, [commands]);
  return dir;
}

/**
 * 설치 위치 칸(AGE-77 S-09 라, rerun3 T-04): 출처 글 뒤에 경로를 가운데 말줄임으로 보이고, 전체 경로는 제목 글로 둔다.
 * 데이터 폴더 아래는 "Fresnel 데이터 폴더" 뒤 상대 경로로, 홈 아래는 `~/…`로 보인다.
 * 셸이 있고 실제 경로면 "폴더에서 보기" 단추를 옆에 둔다. 웹처럼 셸이 없으면 단추를 그리지 않는다
 */
function LocationValue(props: { readonly origin: string; readonly location: string }): ReactNode {
  const shell = useDesktopShell();
  const dataDir = useDataDir();
  const path = revealablePathOf(props.location);
  const shown = locationTextOf(
    props.location,
    dataDir,
    t("desktop.workbench.detail.origin.dataFolder"),
  );
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <span>{props.origin}</span>
      <span className="min-w-0 font-mono text-mono text-text-tertiary" title={props.location}>
        {middleEllipsisOf(shown, LOCATION_LIMIT)}
      </span>
      {shell === null || path === null ? null : <RevealButton shell={shell} path={path} />}
    </span>
  );
}

/** "폴더에서 보기": 셸 명령 `reveal_path`로 설치 폴더를 파일 관리자에서 연다. 못 찾거나 못 열면 알린다 */
function RevealButton(props: {
  readonly shell: Pick<DesktopShell, "invoke">;
  readonly path: string;
}): ReactNode {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="flex-none"
      onClick={() => {
        detach(
          revealFullOutput(props.shell, props.path).then((result) => {
            if (result !== "revealed") {
              toast({
                tone: "danger",
                title: t(
                  result === "missing"
                    ? "desktop.workbench.detail.origin.revealMissing"
                    : "desktop.workbench.detail.origin.revealFailed",
                ),
              });
            }
            return undefined;
          }),
          rethrow,
        );
      }}
    >
      {t("desktop.item.output.reveal")}
    </Button>
  );
}

/**
 * 준비 상태 구역: 도구마다 한 줄. 없거나 버전이 낮거나 쓸 수 없는 줄은 숨기지 않고 경고로 두며, 설치 안내와 "복사"를 단다.
 * 앱이 대신 설치하지 않는다. 머리의 "다시 확인"은 엔진에 도구 점검을 다시 시키고(`host.status { includeBinaries }`) 카드를 다시 읽는다
 */
function ReadinessSection(props: {
  readonly readiness: ToolReadinessVM;
  readonly onRecheck: () => void;
}): ReactNode {
  return (
    <div className="grid gap-4">
      <ColumnHead
        title={t("desktop.workbench.detail.ready.title")}
        end={
          <Button size="sm" variant="ghost" onClick={props.onRecheck}>
            {t("desktop.workbench.detail.ready.recheck")}
          </Button>
        }
      />
      <ul className="m-0 grid list-none gap-1 p-0">
        {props.readiness.needs.map((need) => (
          <NeedLine key={need.plugin} need={need} />
        ))}
      </ul>
    </div>
  );
}

/**
 * 도구 한 줄. 모든 줄이 같은 세 칸(표시 그림, 글, 복사)이라 글의 왼쪽 끝이 맞는다. 그림은 첫 줄 높이(`h-lh`) 안에서 세로 가운데다.
 * 없거나 버전이 낮거나 쓸 수 없으면 숨기지 않는 경고 면(warning tint)과 경고 그림, 필요한 버전과 지금 버전, 설치 안내(mono)와 "복사"를 둔다.
 * 점검 값이 아직 없으면(`unchecked`) 경고 없이 흐린 그림과 "아직 확인하지 않았어요"다
 */
function NeedLine(props: { readonly need: ToolNeedVM }): ReactNode {
  const { need } = props;
  const commands = useCommands();
  const warn = needsAttentionOf(need);
  const install = warn ? need.install : null;
  const versions = [
    need.minVersion === null
      ? null
      : t("desktop.workbench.detail.ready.minVersion", { min: need.minVersion }),
    need.foundVersion === null
      ? null
      : t("desktop.workbench.detail.ready.foundVersion", { found: need.foundVersion }),
  ].filter((text) => text !== null);
  return (
    <li
      data-need={need.state}
      data-warn={warn ? "" : undefined}
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 rounded-lg px-3 py-2 text-ui${warn ? " bg-warning-tint" : ""}`}
    >
      <span aria-hidden className="flex h-lh items-center">
        {warn ? (
          <TriangleAlert className="size-icon-md text-warning-text" />
        ) : need.state === "unchecked" ? (
          <Clock className="size-icon-md text-text-tertiary" />
        ) : (
          <CircleCheck className="size-icon-md text-success-text" />
        )}
      </span>
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-mono text-text-primary">{need.tool}</span>
          <span className={warn ? "text-warning-text" : "text-text-secondary"}>
            {t(readinessWordOf(need.state))}
          </span>
          {need.required ? null : (
            <span className="text-text-tertiary">
              {t("desktop.workbench.detail.ready.optional")}
            </span>
          )}
        </div>
        {warn && versions.length > 0 ? (
          <div className="flex flex-wrap gap-x-2 text-text-secondary">
            {versions.map((text) => (
              <span key={text}>{text}</span>
            ))}
          </div>
        ) : null}
        {install === null ? null : (
          <code className="font-mono text-mono text-text-primary">{install}</code>
        )}
      </div>
      {install === null ? (
        <span />
      ) : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            detach(commands.copyText(install), rethrow);
          }}
        >
          {t("desktop.workbench.detail.ready.copy")}
        </Button>
      )}
    </li>
  );
}
