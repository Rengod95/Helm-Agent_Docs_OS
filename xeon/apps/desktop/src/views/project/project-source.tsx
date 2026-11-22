import { detach, rethrow } from "@fresnel/contracts";
import type { ProjectListItem } from "@fresnel/contracts/wire";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";

// 프로젝트 목록의 원천 하나(C10, T7). 왼쪽 패널과 대화 화면의 알림이 같은 값을 본다. 실제 엔진의 `project.list`를 읽고 프로젝트마다
// `project.get`의 리뷰 대기 수를 붙인다. `project.changed`나 `pluginReview.changed`가 오거나 연결이 다시 서면 다시 읽는다.
// 준비되지 않은 값을 빈 목록으로 그리지 않는다: 읽는 중, 엔진에 메서드 없음, 실패를 따로 둔다. 원천이 없는 자리(시험의 부분 화면)는 읽는 중이다.

export type ProjectsLoad =
  | { readonly status: "loading" }
  /** 연결된 엔진에 `project.*`가 없다(오래된 엔진). 패널은 예전 작업 폴더 묶음을 그린다 */
  | { readonly status: "unsupported" }
  | { readonly status: "offline" }
  | { readonly status: "failed" }
  | {
      readonly status: "ready";
      readonly projects: readonly ProjectListItem[];
      /** 프로젝트 id → 그 프로젝트 출처의 리뷰 대기 수. 읽지 못한 프로젝트는 없다(0으로 채우지 않는다) */
      readonly pending: ReadonlyMap<string, number>;
    };

export interface ProjectsSource {
  readonly load: ProjectsLoad;
  reload(): void;
}

const LOADING: ProjectsSource = { load: { status: "loading" }, reload: () => {} };

const ProjectsContext = createContext<ProjectsSource>(LOADING);

export function useProjects(): ProjectsSource {
  return useContext(ProjectsContext);
}

/** 읽기가 이미 끝난 원천(시험과 개발 빌드의 표본) */
export function StaticProjects(props: {
  readonly load: ProjectsLoad;
  readonly children: ReactNode;
}): ReactNode {
  const value = useMemo(() => ({ load: props.load, reload: () => {} }), [props.load]);
  return <ProjectsContext value={value}>{props.children}</ProjectsContext>;
}

export function ProjectsProvider(props: { readonly children: ReactNode }): ReactNode {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [load, setLoad] = useState<ProjectsLoad>({ status: "loading" });
  // 늦게 온 응답이 새 응답을 덮지 않게 차례 번호를 둔다
  const turn = useRef(0);

  const reload = useCallback((): void => {
    turn.current += 1;
    const mine = turn.current;
    const run = async (): Promise<void> => {
      const listed = await commands.projects.list();
      if (mine !== turn.current) return;
      if (!listed.ok) {
        const kind = listed.error.kind;
        // 다시 읽다 끊긴 것이면 읽어 둔 목록을 남긴다(연결이 다시 서면 또 읽는다)
        setLoad((prev) =>
          kind === "offline" && prev.status === "ready"
            ? prev
            : {
                status:
                  kind === "unsupported"
                    ? "unsupported"
                    : kind === "offline"
                      ? "offline"
                      : "failed",
              },
        );
        return;
      }
      const projects = listed.value.projects;
      const counts = await Promise.all(
        projects.map(async (project) => {
          const got = await commands.projects.get(project.projectId);
          return got.ok ? ([project.projectId, got.value.pendingReview] as const) : null;
        }),
      );
      if (mine !== turn.current) return;
      const pending = new Map<string, number>();
      for (const entry of counts) if (entry !== null) pending.set(entry[0], entry[1]);
      setLoad({ status: "ready", projects, pending });
    };
    detach(run(), rethrow);
  }, [commands]);

  // 연결이 서면(처음과 다시 붙을 때) 읽는다
  useEffect(() => {
    if (phase === "live") reload();
  }, [phase, reload]);

  // 알림은 지금 연결에서 듣는다. 연결이 바뀌면(다시 붙으면) 새 연결에서 다시 듣는다
  useEffect(() => {
    if (phase !== "live") return undefined;
    return commands.projects.onChanged(reload);
  }, [commands, reload, phase]);

  const value = useMemo(() => ({ load, reload }), [load, reload]);
  return <ProjectsContext value={value}>{props.children}</ProjectsContext>;
}
