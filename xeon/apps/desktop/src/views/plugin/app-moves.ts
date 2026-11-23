import { detach, rethrow } from "@fresnel/contracts";
import { useContext, useMemo } from "react";
import { ShellStoreContext, type ShellActions } from "../../state/shell/index.ts";
import { WorkbenchStoreContext, type WorkbenchActions } from "../../state/workbench/index.ts";
import { useCommands } from "../commands.ts";
import { useOpenTestChat } from "../craft/test-chat/use-test-chat.ts";
import { APP_BESIDE_TAB, placeBeside } from "./app-beside.ts";
import { openTab, PLAYGROUND_TAB_SCREEN } from "./playground-tab-store.ts";

// 앱(플러그인이 낸 화면, AGE-78)에서 가는 길을 한곳에 모은다. 홈 타일 메뉴, 앱 작업 공간 머리, 대화 옆 패널, 대화의 도구 줄이 같이 쓴다.
// - 열기: 머리 줄 탭 화면(`playground-tab`, keepAlive)에 그 앱을 연다. 고정 탭과 같은 화면이라 같은 상태를 본다.
// - 홈: 플레이그라운드(화면 id `plugins`).
// - 대화 옆에: 대화 화면으로 가서 오른쪽 패널의 "앱" 탭에 그 화면을 둔다.
// - 관리: 크래프트 > 플러그인 > 그 상세. 고치기: 그 플러그인의 테스트 챗. 만들기: 크래프트의 플러그인 빌더 상자.

/** 크래프트로 가는 동작 */
export interface AddonMoves {
  /** 크래프트 > 플러그인 목록 */
  readonly findPlugins: () => void;
  /** 크래프트 > 플러그인 > 그 상세 */
  readonly manage: (name: string) => void;
  /** 크래프트의 플러그인 빌더 상자 */
  readonly buildPlugin: () => void;
}

/** 크래프트로 가는 동작. 셸이나 워크벤치 문맥이 없는 곳(시험)에서는 그 부분을 건너뛴다 */
export function addonMovesOf(
  shell: ShellActions | undefined,
  workbench: WorkbenchActions | undefined,
): AddonMoves {
  const go = (screen: string): void => {
    shell?.switchArea("workbench");
    shell?.updatePlace({ screen, scroll: 0 });
  };
  return {
    findPlugins: () => {
      go("extensions");
    },
    manage: (name) => {
      go("extensions");
      workbench?.pickPlugin(name);
      workbench?.openDetail(name);
    },
    buildPlugin: () => {
      go("extensions");
      workbench?.requestBuilder(null);
    },
  };
}

export interface AppMoves {
  /** 앱 작업 공간에 연다. 화면 키를 주면 그 화면으로 */
  readonly open: (name: string, screenKey?: string) => void;
  /** 플레이그라운드 홈 */
  readonly home: () => void;
  /** 화면 하나를 대화 옆(오른쪽 패널 "앱" 탭)에 둔다 */
  readonly beside: (screenKey: string) => void;
  /** 크래프트의 그 플러그인 상세 */
  readonly manage: (name: string) => void;
  /** 그 플러그인의 테스트 챗(가장 최근 것, 없으면 새로) */
  readonly fix: (name: string) => void;
  /** 플러그인 빌더 상자 */
  readonly create: () => void;
}

export function useAppMoves(): AppMoves {
  const shell = useContext(ShellStoreContext)?.actions;
  const workbench = useContext(WorkbenchStoreContext)?.actions;
  const commands = useCommands();
  const openTestChat = useOpenTestChat();
  return useMemo(() => {
    const craft = addonMovesOf(shell, workbench);
    const toChat = (screen: string): void => {
      shell?.switchArea("chat");
      commands.showScreen("chat");
      shell?.updatePlace({ screen, scroll: 0 });
    };
    return {
      open: (name, screenKey) => {
        openTab(name, screenKey);
        toChat(PLAYGROUND_TAB_SCREEN);
      },
      home: () => {
        toChat("plugins");
      },
      beside: (screenKey) => {
        placeBeside(screenKey);
        toChat("chat");
        shell?.openEndTab(APP_BESIDE_TAB, "chat");
      },
      manage: craft.manage,
      fix: (name) => {
        detach(
          openTestChat({ plugin: name, reuse: "last", context: [{ kind: "plugin", name }] }).then(
            () => undefined,
          ),
          rethrow,
        );
      },
      create: craft.buildPlugin,
    };
  }, [shell, workbench, commands, openTestChat]);
}
