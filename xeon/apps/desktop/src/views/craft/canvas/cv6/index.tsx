// 프로필 화면(C3)의 캔버스 진입 부품: 프로필 캔버스와, 노드를 열면 같은 자리에서 들어가는 플러그인 내부. 모양은 `cv6.css`(styles.css가 불러온다).
// 화면을 열 때마다 엔진 값을 읽는다(`store.ts`의 `startLive`). 읽는 동안과 실패는 이 판이 말하고, 읽힌 뒤에 캔버스를 그린다.
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState, type ReactNode } from "react";
import { ProgressOrb } from "../../../effects/progress-orb.tsx";
import { useProfileCommands } from "../profile-source.ts";
import { ProfileCanvas } from "./canvas.tsx";
import { PluginInside } from "./inside.tsx";
import { startLive, useCanvasStore } from "./store.ts";

export function Screen(): ReactNode {
  const store = useCanvasStore();
  const commands = useProfileCommands();
  const [inside, setInside] = useState<string | null>(null);
  useEffect(() => {
    detach(startLive(commands), rethrow);
  }, [commands]);
  if (store.status === "loading" || store.status === "failed")
    return (
      <div className="cv6-root flex min-h-0 flex-1 items-center justify-center">
        <p role="status" className="m-0 flex items-center gap-2 text-ui text-text-secondary">
          {store.status === "loading" ? (
            <ProgressOrb />
          ) : (
            <span aria-hidden="true" className="cv6-orb" data-tone="danger" />
          )}
          {t(
            store.status === "loading"
              ? "desktop.craft.canvas.cv9.loading"
              : store.error?.kind === "offline"
                ? "desktop.compose.offline"
                : "desktop.craft.canvas.cv9.failed",
          )}
        </p>
      </div>
    );
  if (inside !== null)
    return (
      <ReactFlowProvider key={`inside:${inside}`}>
        <PluginInside
          name={inside}
          onBack={() => {
            setInside(null);
          }}
        />
      </ReactFlowProvider>
    );
  return (
    <ReactFlowProvider key={`profile:${store.current}`}>
      <ProfileCanvas onOpen={setInside} />
    </ReactFlowProvider>
  );
}
