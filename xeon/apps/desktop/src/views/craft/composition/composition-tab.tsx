// 플러그인 상세의 "구성" 탭(Drive 플러그인만, 읽기 전용). 설치본 매니페스트의 `orchestration.composition`을 블록 캔버스와 검사 띠로 보인다.
// 복제해서 고치기, 흐름 보기, 코드 보기와 새 플러그인 동작은 두지 않는다. 선언이 없으면 "구성 정보 없음" 빈 상태다.
import { t } from "@fresnel/client/i18n";
import {
  blockRowsOf,
  compositionOf,
  issuesByBlockOf,
  type MemberTitleSource,
  type TabLink,
} from "@fresnel/client/workbench";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import { Alert, EmptyState, Skeleton } from "@caustic/react";
import { useMemo, type ReactNode } from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { FolderArt } from "../../illustrations/index.tsx";
import { tabLinkOf } from "../../workbench/tab-read.ts";
import { membersOfManifest } from "../members/members-model.ts";
import { GroupCanvas } from "./composition-canvas.tsx";
import { CheckBanner, useCompositionCheck } from "./composition-check.tsx";

/** 매니페스트를 아직 못 읽었을 때의 자리: 읽는 중 글을 낭독기에 주고 줄 하나를 흐리게 보인다 */
function Loading(): ReactNode {
  return (
    <div role="status" aria-busy="true" className="grid gap-2">
      <span className="sr-only">{t("desktop.craft.composition.loading")}</span>
      <Skeleton height={24} />
    </div>
  );
}

/** 구성을 선언하지 않은 플러그인의 빈 상태 */
function NoComposition(): ReactNode {
  return (
    <EmptyState
      media={<FolderArt />}
      size="sm"
      surface="none"
      title={t("desktop.craft.composition.none.title")}
      description={t("desktop.craft.composition.none.body")}
    />
  );
}

/** 선언이 있을 때의 본문. 검사는 여기서 읽어 띠와 블록 이슈에 같이 쓴다 */
function CompositionBody(props: {
  readonly composition: CompositionDecl;
  readonly members: readonly MemberTitleSource[];
  readonly link: TabLink;
}): ReactNode {
  const check = useCompositionCheck(props.composition, props.link);
  const issues = check.kind === "done" ? check.issues : [];
  return (
    <div className="grid gap-3">
      <CheckBanner check={check} />
      <GroupCanvas
        rows={blockRowsOf(props.composition, props.members)}
        issuesByBlock={issuesByBlockOf(props.composition, issues)}
      />
    </div>
  );
}

export function CompositionTab(props: {
  readonly name: string;
  /** 설치본 매니페스트(`ext.get`). 아직 못 읽었거나 실패했으면 null */
  readonly manifest: Readonly<Record<string, unknown>> | null;
  /** 매니페스트 읽기(`ext.get`)가 실패했나. 참이면 읽는 중 대신 실패 한 줄을 보인다(다른 상세 탭과 같은 글) */
  readonly failed?: boolean;
}): ReactNode {
  const { name, manifest } = props;
  const link = tabLinkOf(useLinkPhase());
  // `compositionOf`는 호출마다 새 객체를 주므로 매니페스트가 바뀔 때만 다시 읽어 검사 효과가 반복되지 않게 한다
  const composition = useMemo(
    () => (manifest === null ? null : compositionOf(manifest)),
    [manifest],
  );
  if (props.failed === true) {
    return <Alert tone="danger">{t("desktop.workbench.detail.load.failed")}</Alert>;
  }
  if (manifest === null || composition === null) return <Loading />;
  if (composition.kind === "none") return <NoComposition />;
  return (
    <CompositionBody
      composition={composition.composition}
      members={membersOfManifest(name, manifest)}
      link={link}
    />
  );
}
