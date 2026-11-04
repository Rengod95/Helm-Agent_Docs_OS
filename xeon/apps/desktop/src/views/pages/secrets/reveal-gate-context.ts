import { createContext, type Context } from "react";
import { UNAVAILABLE_GATE, type RevealGate } from "../../../app/secret-reveal-gate.ts";

// 시크릿 화면이 쓰는 값 보기 재인증 관문. 앱 진입점(`main.tsx`)이 운영 구현을 넣고, 넣지 않은 곳(웹, 시험)은 잠긴 관문이다.
export const RevealGateContext: Context<RevealGate> = createContext<RevealGate>(UNAVAILABLE_GATE);
