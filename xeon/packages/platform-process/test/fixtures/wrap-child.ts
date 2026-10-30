export {};
// 샌드박스 래퍼 대역. 사용: bun wrap-child.ts <감싸인 명령…>
// 받은 argv와 env를 JSON 한 줄로 stdout에 쓰고 stdin이 닫힐 때까지 산다. 감싸인 명령은 돌리지 않는다(시험은 명령줄 모양만 본다)
process.stdout.write(`${JSON.stringify({ argv: process.argv.slice(2), env: process.env })}\n`);
process.stdin.resume();
