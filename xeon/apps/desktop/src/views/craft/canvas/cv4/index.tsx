// cv4(G3) 시안의 진입 부품: 프로필 캔버스와, 노드를 열면 같은 자리에서 들어가는 플러그인 내부. 모양은 `cv4.css`(styles.css가 불러온다).
// 프로필 편집은 이 시안의 모듈 상태에만 남는다(저장하지 않는다).
import { ReactFlowProvider } from "@xyflow/react";
import { useState, type ReactNode } from "react";
import { ProfileCanvas } from "./canvas.tsx";
import { PluginInside } from "./inside.tsx";
import { useCanvasStore } from "./store.ts";

export function Screen(): ReactNode {
  const store = useCanvasStore();
  const [inside, setInside] = useState<string | null>(null);
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
