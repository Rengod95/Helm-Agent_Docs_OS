// P-09 설정 보탬(p09-settings 모양 그대로, 공용 틀 _settings): "플러그인과 그룹" 탭에 프레임 행(N-27)과 "묻지 않기" 목록(계획에 없음 13),
// 계측 행(N-28), 개발 모드 행(N-30), 확장 설정 구역의 settings slot(N-25). "외관" 탭에 언어 행(N-29).
// 720 아래는 탭 열 대신 머리 Select(DP-37, 공용 틀이 맡음). 배지는 행마다 하나(DP-36), "다시 시작하면 적용"만 warning.
import {
  Badge,
  Button,
  Input,
  NumberField,
  Select,
  SelectOption,
  Switch,
  Toaster,
  toast,
} from "@caustic/react";
import { useEffect, useRef } from "react";
import {
  CircleCheck,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  ScenarioDock,
  T,
  useShell,
} from "../_shell";
import { useMachine, usePrefill } from "../_chat-rt";
import { SettingsFrame } from "../_settings/frame";
import { SettingRow, SettingSection } from "../_settings/row";
import { gotoTabPage, type TabId } from "../_settings/tabs";
import { goFolder } from "../_wb-c/frame";
import { ExtName, Mono } from "../_wb-c/parts";
import { SettingsSlot } from "../_wb-c/settings-slot";
import { effect, init, reduce, SCRIPTS, type A, type Locale, type S, type Tab } from "./flow";

export const STATES = [
  { id: "plugins", label: "플러그인과 그룹: 프레임·계측·개발 모드" },
  { id: "frames-off", label: "프레임 끔" },
  { id: "frames-fail", label: "실패: 프로젝트 프레임 허용 거부" },
  { id: "trace", label: "계측 행" },
  { id: "trace-off", label: "계측 끔: 턴 다시 보기 잠김" },
  { id: "trace-fail", label: "실패: 계측 저장 거부" },
  { id: "dev", label: "개발 모드 켬" },
  { id: "web", label: "웹: 원격 호스트 개발 모드" },
  { id: "slot", label: "확장 설정 + 플러그인 부분" },
  { id: "locale", label: "외관: 언어" },
  { id: "locale-en", label: "언어 English: 다시 시작하면 적용" },
  { id: "locale-auto", label: "언어 자동: OS 언어 지원 밖" },
  { id: "narrow", label: "좁은 폭(390): 탭이 Select" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, { script: string; n: number; scroll?: string }> = {
  plugins: { script: "base", n: 0 },
  "frames-off": { script: "settings-frames", n: 1 },
  "frames-fail": { script: "settings-frames-fail", n: 2 },
  trace: { script: "base", n: 0, scroll: "sec-trace" },
  "trace-off": { script: "trace-off", n: 1, scroll: "sec-trace" },
  "trace-fail": { script: "trace-off-fail", n: 2, scroll: "sec-trace" },
  dev: { script: "dev", n: 1, scroll: "sec-dev" },
  web: { script: "base", n: 0, scroll: "sec-dev" },
  slot: { script: "base", n: 0, scroll: "sec-ext" },
  locale: { script: "locale-switch", n: 1 },
  "locale-en": { script: "locale-switch", n: 3 },
  "locale-auto": { script: "locale-auto-fallback", n: 3 },
  narrow: { script: "base", n: 0 },
};

export const SCENARIOS = [
  { id: "settings-frames", label: "프레임 끄기 → 묻지 않기 되돌리기" },
  { id: "settings-frames-fail", label: "실패: 프로젝트 프레임 허용 거부" },
  { id: "trace-off", label: "계측 끄기 → 턴 다시 보기 잠김" },
  { id: "trace-off-fail", label: "실패: 계측 저장 거부" },
  { id: "locale-switch", label: "English로 → 다시 시작하면 적용" },
  { id: "locale-auto-fallback", label: "자동(OS) → 지원 밖이라 English" },
];

const HERE = "c04-settings-rows";
const LOCALE_WORD: Record<Locale, string> = { auto: "자동(OS 언어)", ko: "한국어", en: "English" };

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const at = AT[state];
  const pre = usePrefill(SCRIPTS, at);
  const [s, dispatch] = useMachine<S, A>({
    init: init(pre.script),
    reduce,
    prefill: pre.prefill,
    effect,
    kick: pre.live,
  });
  const web = state === "web";
  const devOn = s.devMode || web;

  const seen = useRef<number | null>(
    pre.live || state === "trace-off" ? null : (s.note?.id ?? null),
  );
  useEffect(() => {
    if (s.note === null || s.note.id === seen.current) return;
    seen.current = s.note.id;
    const to = s.note.to;
    toast({
      title: s.note.title,
      ...(s.note.body !== undefined ? { description: s.note.body } : {}),
      tone: s.note.tone ?? "neutral",
      ...(to !== undefined
        ? {
            actionLabel: `${T.trials} 보기`,
            onAction: () => goFolder(to, "state=trace-off"),
            duration: 8000,
          }
        : {}),
    });
  }, [s.note]);
  useEffect(() => {
    if (state === "narrow") shell.setStartOpen(false);
    if (at.scroll !== undefined)
      window.setTimeout(
        () => document.getElementById(at.scroll ?? "")?.scrollIntoView({ block: "start" }),
        50,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTabSelect = (id: TabId) => {
    if (id === "plugins" || id === "appearance") dispatch({ t: "tab", tab: id as Tab });
    else gotoTabPage(id, HERE);
  };

  const hint = (() => {
    if (!pre.live) return undefined;
    switch (pre.script) {
      case "settings-frames":
        return s.frames
          ? `"${T.viewFrame} 허용"을 끄세요`
          : s.skips.length === 3
            ? `목록에서 "${T.askAgain}"를 누르세요`
            : "끝났어요";
      case "settings-frames-fail":
        return s.projectFramesError
          ? "관리 정책이 거부했어요"
          : `"${T.trustProject} 확장의 ${T.viewFrame}"을 켜세요`;
      case "trace-off":
        return s.trace ? `"${T.instrumentation}"을 끄세요` : `토스트의 "${T.trials} 보기"`;
      case "trace-off-fail":
        return s.traceError
          ? "저장이 거부돼 켜짐으로 돌아갔어요"
          : `"${T.instrumentation}"을 끄세요`;
      case "locale-switch":
      case "locale-auto-fallback":
        return s.tab !== "appearance"
          ? `"외관" 탭`
          : s.locale === "ko"
            ? `${T.uiLocale}를 바꾸세요`
            : "끝났어요";
      default:
        return undefined;
    }
  })();

  const plugins = (
    <>
      <SettingSection title={T.pluginView}>
        <SettingRow
          label={`${T.viewFrame} 허용`}
          k="x.views.frames"
          scope="user"
          apply="now"
          saved={s.saved === "frames"}
          hint={
            s.frames
              ? `확장이 자기 코드로 그린 화면을 격리된 틀 안에 보여요.`
              : `${T.viewFrame} 2개를 ${T.viewDeclarative}이나 자리표시로 보여요.`
          }
        >
          <Switch
            size="sm"
            aria-label={`${T.viewFrame} 허용`}
            checked={s.frames}
            onCheckedChange={(on) => dispatch({ t: "frames", on })}
          />
        </SettingRow>
        <SettingRow
          label={`${T.trustProject} 확장의 ${T.viewFrame}`}
          k="x.views.allowProjectFrames"
          scope="user"
          apply="now"
          saved={s.saved === "projectFrames"}
          disabled={!s.frames}
          {...(s.projectFramesError
            ? { error: "관리 정책이 이 값을 막았어요 · 3102 · /etc/xeon/managed.json" }
            : { hint: `저장소에 든 확장은 기본으로 막아요. 사용자·관리 범위에서만 켤 수 있어요.` })}
        >
          <span className="inline-flex items-center gap-2">
            <Switch
              size="sm"
              aria-label={`${T.trustProject} 확장의 ${T.viewFrame}`}
              checked={s.projectFrames}
              disabled={!s.frames || s.saving === "projectFrames"}
              onCheckedChange={(on) => dispatch({ t: "projectFrames", on })}
            />
            {s.saving === "projectFrames" && (
              <LoaderCircle aria-hidden className="size-icon-sm animate-spin text-text-tertiary" />
            )}
          </span>
        </SettingRow>
        <div role="group" aria-labelledby="skips-l" className="grid gap-1.5 py-2">
          <div className="flex min-h-6 items-baseline gap-2">
            <span id="skips-l" className="text-ui font-medium text-text-primary">
              {`"${T.askSkip}"로 고른 동작`}
            </span>
            <span className="text-ui-sm text-text-tertiary">{s.skips.length}개</span>
          </div>
          {s.skips.length === 0 ? (
            <p className="m-0 text-ui-sm text-text-tertiary">{`${T.viewFrame}의 동작은 모두 확인 줄을 띄워요.`}</p>
          ) : (
            <ul className="m-0 grid max-w-[36rem] list-none gap-0.5 p-0">
              {s.skips.map((k) => (
                <li
                  key={k.id}
                  className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 max-compact:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <span className="grid min-w-0 gap-0 text-ui-dense">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-text-primary">{k.action}</span>
                      <span className="truncate text-text-secondary">
                        <ExtName id={k.ext} showId={false} />
                      </span>
                    </span>
                    <span className="truncate">
                      <Mono>{k.view}</Mono>
                    </span>
                  </span>
                  <span className="text-ui-xs text-text-tertiary max-compact:hidden">
                    {k.scope}
                  </span>
                  <Button
                    size="xs"
                    tone="neutral"
                    variant="ghost"
                    iconStart={<RotateCcw />}
                    onClick={() => dispatch({ t: "askAgain", id: k.id })}
                  >
                    {T.askAgain}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 text-ui-xs text-text-tertiary">
            승인이 필요한 동작은 묻지 않기를 고를 수 없어 이 목록에 없어요.
          </p>
        </div>
      </SettingSection>

      <div id="sec-trace" className="scroll-mt-2">
        <SettingSection title={T.instrumentation}>
          <SettingRow
            label={T.instrumentation}
            k="x.operations.trace.enabled"
            scope="user"
            apply="nextTurn"
            saved={s.saved === "trace" && !s.traceError}
            {...(s.traceError
              ? { error: "저장하지 못했어요 · 엔진에 연결되지 않아 켜짐으로 돌렸어요" }
              : {
                  hint: s.trace
                    ? `${T.turn}마다 핸들러 시간과 결과를 메모리에만 남겨 ${T.turnReplay}에 써요.`
                    : `꺼져 있어요. ${T.trials}·구성기의 ${T.turnReplay}가 잠겨요.`,
                })}
          >
            <span className="inline-flex items-center gap-2">
              <Switch
                size="sm"
                aria-label={T.instrumentation}
                checked={s.trace}
                disabled={s.saving === "trace"}
                onCheckedChange={(on) => dispatch({ t: "trace", on })}
              />
              {s.saving === "trace" && (
                <LoaderCircle
                  aria-hidden
                  className="size-icon-sm animate-spin text-text-tertiary"
                />
              )}
            </span>
          </SettingRow>
          <SettingRow
            label={`대화마다 남길 ${T.turn}`}
            k="x.operations.trace.turnsPerThread"
            scope="default"
            apply="nextTurn"
            disabled={!s.trace}
          >
            <NumberField
              size="xs"
              aria-label={`대화마다 남길 ${T.turn}`}
              defaultValue={8}
              min={1}
              max={64}
              disabled={!s.trace}
              containerClassName="w-36"
            />
          </SettingRow>
          <p className="m-0 pb-2 text-ui-sm text-text-tertiary">
            비용: 대화마다 약 0.3MB, 턴 시간 1% 안쪽(추정). 실제 값은 성능 측정 뒤 이 자리에 보여요.
          </p>
        </SettingSection>
      </div>

      <div id="sec-dev" className="scroll-mt-2">
        <SettingSection title={`만들기와 ${T.trial}`}>
          <SettingRow
            label={T.devMode}
            k="l3.authoring.devMode"
            {...(web
              ? {
                  flag: (
                    <Badge size="sm" tone="neutral" variant="soft">
                      원격 컴퓨터
                    </Badge>
                  ),
                }
              : { scope: "user" as const, apply: "now" as const })}
            saved={s.saved === "devMode"}
            hint={
              web
                ? `원격 컴퓨터 build-box의 ${T.devMode}를 따라요. 바꾸려면 그 컴퓨터의 설정에서 바꿔요.`
                : `${T.replay}, ${T.bench}, ${T.coreDiff}를 ${T.repoPath}의 시험 도구로 돌려요.`
            }
          >
            <Switch
              size="sm"
              aria-label={T.devMode}
              checked={devOn}
              disabled={web}
              onCheckedChange={(on) => dispatch({ t: "devMode", on })}
            />
          </SettingRow>
          <SettingRow
            label={T.repoPath}
            k="l3.authoring.repoPath"
            scope={web ? undefined : "user"}
            disabled={!devOn || web}
          >
            <div className="flex max-w-[28rem] items-center gap-1.5">
              <Input
                size="xs"
                defaultValue="~/code/xeon"
                disabled={!devOn || web}
                className="font-mono"
                containerClassName="min-w-0 flex-1"
              />
              {!web && (
                <Button
                  size="xs"
                  tone="neutral"
                  variant="outline"
                  iconStart={<FolderOpen />}
                  disabled={!devOn}
                >
                  고르기
                </Button>
              )}
            </div>
          </SettingRow>
          {devOn && (
            <p className="m-0 flex items-center gap-1.5 pb-2 text-ui-sm text-text-secondary">
              <CircleCheck
                aria-hidden
                emphasis="muted"
                className="size-icon-sm text-text-tertiary"
              />
              시험 도구 3개를 찾았어요 · 상태 표시줄에 "{T.devMode}" 칸이 보여요
            </p>
          )}
        </SettingSection>
      </div>

      <div id="sec-ext" className="scroll-mt-2">
        <SettingSection
          title={
            <span className="inline-flex items-baseline gap-2">
              <ExtName id="helm" />
            </span>
          }
          end={
            <Button
              size="xs"
              tone="neutral"
              variant="ghost"
              onClick={() => goFolder("c02-ext-detail", "state=settings")}
            >
              {`${T.workbench}에서 관리`}
            </Button>
          }
        >
          <SettingRow
            label={`${T.lens} 최대 수`}
            k="ext.helm.maxLenses"
            scope="user"
            apply="boundary"
          >
            <NumberField
              size="xs"
              aria-label={`${T.lens} 최대 수`}
              defaultValue={4}
              min={1}
              max={8}
              containerClassName="w-36"
            />
          </SettingRow>
          <SettingRow label="신호가 오면" k="ext.helm.signal.mode" scope="project" apply="boundary">
            <Select
              size="xs"
              aria-label="신호가 오면"
              defaultValue="suggest"
              className="w-[min(20rem,100%)]"
            >
              <SelectOption value="suggest">제안만</SelectOption>
              <SelectOption value="start">바로 시작</SelectOption>
            </Select>
          </SettingRow>
          <SettingsSlot ext="helm" onOpenPage={() => goFolder("b01-plugin-frame")} />
        </SettingSection>
      </div>
    </>
  );

  const restart = s.locale !== "ko" && s.saving === null;
  const appearance = (
    <SettingSection title="언어와 지역">
      <SettingRow
        label={T.uiLocale}
        k="l4.ui.locale"
        scope="user"
        {...(restart
          ? {
              flag: (
                <Badge size="sm" tone="warning">
                  다시 시작하면 적용
                </Badge>
              ),
            }
          : { apply: "now" as const })}
        hint={
          s.locale === "auto" && restart
            ? "OS 언어 일본어(ja-JP)는 아직 없어 English로 보여요."
            : restart
              ? "화면 글은 바로 바뀌어요. 앱 메뉴·트레이·OS 알림은 다시 시작하면 바뀌어요."
              : "자동이면 OS 언어를 따르고, 없는 언어면 English로 보여요."
        }
      >
        <span className="inline-flex items-center gap-2">
          <Select
            size="xs"
            aria-label={T.uiLocale}
            value={s.locale}
            onValueChange={(v) => dispatch({ t: "locale", v: v as Locale })}
            className="w-[min(20rem,100%)]"
          >
            {(["auto", "ko", "en"] as Locale[]).map((l) => (
              <SelectOption key={l} value={l}>
                {LOCALE_WORD[l]}
              </SelectOption>
            ))}
          </Select>
          {s.saving === "locale" && (
            <LoaderCircle aria-hidden className="size-icon-sm animate-spin text-text-tertiary" />
          )}
        </span>
      </SettingRow>
      {restart && (
        <div className="pb-2">
          <Button size="xs" tone="neutral" variant="outline" iconStart={<RotateCcw />}>
            지금 다시 시작
          </Button>
        </div>
      )}
      <SettingRow label="날짜 형식" k="l4.ui.dateStyle" scope="default" apply="now">
        <Select
          size="xs"
          aria-label="날짜 형식"
          defaultValue="locale"
          className="w-[min(20rem,100%)]"
        >
          <SelectOption value="locale">언어를 따름</SelectOption>
        </Select>
      </SettingRow>
    </SettingSection>
  );

  return (
    <>
      <SettingsFrame
        tab={s.tab}
        onTabSelect={onTabSelect}
        meta={
          s.tab === "plugins" ? `${T.pluginView} · ${T.instrumentation} · ${T.devMode}` : undefined
        }
        actions={
          s.tab === "plugins" ? (
            <Button
              size="xs"
              tone="neutral"
              variant="ghost"
              onClick={() => goFolder("c03-ext-list")}
            >
              {`${T.workbench}에서 관리`}
            </Button>
          ) : undefined
        }
      >
        {s.tab === "plugins" ? plugins : appearance}
      </SettingsFrame>
      <Toaster label="알림" />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}
