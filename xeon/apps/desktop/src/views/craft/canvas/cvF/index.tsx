// cvF 시안("도면")의 진입 부품. 모양(cvF.css)은 styles.css가 불러온다. 캔버스와 플러그인 안을 같은 자리에서 오간다.
// 프로필 편집은 이 시안 안의 상태에만 남는다(저장하지 않는다).
import { t } from "@fresnel/client/i18n";
import { ReactFlowProvider } from "@xyflow/react";
import { useState, type ReactNode } from "react";
import { ProfileCanvas } from "./canvas.tsx";
import { PluginInside } from "./inside.tsx";
import { CATALOG, PROFILES } from "./model.ts";

export function Screen(): ReactNode {
  const [inside, setInside] = useState<string | null>(null);
  const from =
    inside === null
      ? null
      : ([...CATALOG.values()].find((p) => p.handoffTo?.includes(inside) === true)?.name ?? null);
  return (
    <>
      {/* 안에 들어가도 캔버스는 그대로 둔다(편집·펼침·시점이 남는다) */}
      <div className={inside === null ? "contents" : "hidden"}>
        <ReactFlowProvider>
          <ProfileCanvas onOpen={setInside} />
        </ReactFlowProvider>
      </div>
      {inside !== null ? (
        <ReactFlowProvider key={`inside:${inside}`}>
          <PluginInside
            name={inside}
            profileName={t("desktop.craft.canvas.cvF.profile.dev")}
            startDrive={PROFILES.dev.startDrive === inside}
            from={from}
            onBack={() => {
              setInside(null);
            }}
          />
        </ReactFlowProvider>
      ) : null}
    </>
  );
}
