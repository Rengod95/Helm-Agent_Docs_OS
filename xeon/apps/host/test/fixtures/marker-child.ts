// 표식 대역. 사용: bun marker-child.ts <표식 파일>
// 뜨면 표식 파일을 쓰고 끝난다. 감싼 명령줄이 실제로 떴는지, 샌드박스가 기동을 막아 아무것도 뜨지 않았는지를 표식 파일의 유무로 본다
import { writeFileSync } from "node:fs";

const marker = process.argv[2];
if (marker !== undefined) writeFileSync(marker, "ran\n");
