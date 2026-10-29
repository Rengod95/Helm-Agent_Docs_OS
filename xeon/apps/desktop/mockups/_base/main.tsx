// 목업 실행 기반 점검: caustic 스타일과 부품이 빌드되는지만 본다
import "@caustic/react/styles.css";
import { Button } from "@caustic/react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(<Button>caustic 버튼</Button>);
}
