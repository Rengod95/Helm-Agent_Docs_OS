// lucide-react 진입점. 데스크톱 패키지는 lucide-react를 직접 의존하지 않아서(bun 격리 설치) 목업 폴더에서
// 맨 이름 import가 풀리지 않는다. caustic이 쓰는 같은 lucide-react를 상대 경로로 다시 내보낸다.
// 앱 코드로 옮길 때는 package.json에 lucide-react를 넣고 이 파일을 지우면 된다.
export * from "../../node_modules/@caustic/react/node_modules/lucide-react";
