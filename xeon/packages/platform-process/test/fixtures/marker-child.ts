// 표식 대역. 사용: bun marker-child.ts <표식 파일>
// 뜨면 표식 파일을 쓰고 끝난다. 샌드박스가 기동을 막았는지 보는 시험이 표식 파일의 유무로 확인한다
import { writeFileSync } from "node:fs";

const marker = process.argv[2];
if (marker !== undefined) writeFileSync(marker, "ran\n");
