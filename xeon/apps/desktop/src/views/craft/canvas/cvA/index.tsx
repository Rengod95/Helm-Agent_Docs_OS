// cvA(HUD) 시안의 진입 부품 둘. 모양(cvA.css)은 styles.css가 불러온다. `ProfileCanvas`는 프로필 캔버스이고 노드를 열면 같은 자리에서 `PluginInside`로 들어간다.
// 프로필 편집은 이 시안 안의 상태에만 남는다(저장하지 않는다). 표본 프로필 둘(개발, 빈 새 프로필)을 고를 수 있다.
// 실제 프로필 연결은 통합 자리에서 한다: 이 폴더 깊이에서는 `views/commands.ts`를 상대 경로로 부를 수 없다(no-restricted-imports).
import { t } from "@fresnel/client/i18n";
import { ReactFlowProvider } from "@xyflow/react";
import { useMemo, useState, type ReactNode } from "react";
import { Board, type ProfileChoice } from "./board.tsx";
import { InsideBoard } from "./inside.tsx";
import { catalogOf, handoffsOf, type ProfileModel } from "./model.ts";
import { EMPTY_PROFILE, SAMPLE_PLUGINS, SAMPLE_PROFILE } from "./sample.ts";

const SAMPLE_CATALOG = catalogOf(SAMPLE_PLUGINS);

export function ProfileCanvas(): ReactNode {
  const [edits, setEdits] = useState<ReadonlyMap<string, ProfileModel>>(new Map());
  const [current, setCurrent] = useState(SAMPLE_PROFILE.id);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [inside, setInside] = useState<string | null>(null);

  const choices = useMemo(
    (): readonly ProfileChoice[] => [
      { id: SAMPLE_PROFILE.id, title: t("desktop.craft.canvas.cvA.profile.sample") },
      { id: EMPTY_PROFILE.id, title: t("desktop.craft.canvas.cvA.profile.empty") },
    ],
    [],
  );
  const base = current === EMPTY_PROFILE.id ? EMPTY_PROFILE : SAMPLE_PROFILE;
  const profile = edits.get(base.id) ?? base;
  const specs = SAMPLE_PLUGINS;
  const catalog = SAMPLE_CATALOG;
  const title = choices.find((c) => c.id === profile.id)?.title ?? "";

  const opened = inside === null ? undefined : catalog.get(inside);
  if (opened !== undefined) {
    const from = handoffsOf(profile, catalog).find((h) => h.to === opened.name)?.from ?? null;
    return (
      <ReactFlowProvider key={`inside:${opened.name}`}>
        <InsideBoard
          spec={opened}
          catalog={catalog}
          profileTitle={title}
          start={profile.startDrive === opened.name}
          receivesFrom={from}
          onBack={() => {
            setInside(null);
          }}
        />
      </ReactFlowProvider>
    );
  }
  return (
    <ReactFlowProvider key={`profile:${profile.id}`}>
      <Board
        profile={profile}
        choices={choices}
        specs={specs}
        catalog={catalog}
        closed={closed}
        onProfile={(next) => {
          setEdits((m) => new Map(m).set(next.id, next));
        }}
        onChoose={setCurrent}
        onToggleGroup={(group) => {
          setClosed((s) => {
            const next = new Set(s);
            if (next.has(group)) next.delete(group);
            else next.add(group);
            return next;
          });
        }}
        onOpen={setInside}
      />
    </ReactFlowProvider>
  );
}

/** 플러그인 하나의 내부(표본). 통합에서 따로 띄울 때 쓴다 */
export function PluginInside(props: {
  readonly plugin: string;
  readonly onBack: () => void;
}): ReactNode {
  const spec = SAMPLE_CATALOG.get(props.plugin);
  if (spec === undefined) return null;
  const from =
    handoffsOf(SAMPLE_PROFILE, SAMPLE_CATALOG).find((h) => h.to === spec.name)?.from ?? null;
  return (
    <ReactFlowProvider>
      <InsideBoard
        spec={spec}
        catalog={SAMPLE_CATALOG}
        profileTitle={t("desktop.craft.canvas.cvA.profile.sample")}
        start={SAMPLE_PROFILE.startDrive === spec.name}
        receivesFrom={from}
        onBack={props.onBack}
      />
    </ReactFlowProvider>
  );
}
