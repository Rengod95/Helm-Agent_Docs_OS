# 런타임 일러스트 (`mockups/_art`)

크래프트 화면에 쓰는 아이소메트릭 선화 세트. 손으로 읽고 고칠 수 있는 SVG이고, 색은 전부 CSS 변수다.

## 파일

| 파일 | viewBox | 내용 |
| --- | --- | --- |
| `hero-lifecycle.svg` | 640×400 | X 수명 고리: 입력 → 요청 → 도구 → 단계 경계 → 대화·수명, 단계마다 훅 핀 2개, 가운데 확장 호스트 |
| `hero-lifecycle-active.svg` | 640×400 | 같은 고리, 도구 단계 강조(강조선·글로·핀에 꽂힌 플러그인), 나머지는 흐리게 |
| `layer-stack.svg` | 400×380 | F·X·L0·L1·L2·L3 계단식 판. 판마다 기본 부품(종이색) + 빈 점선 슬롯(+) 또는 사용자 블록(그라디언트) |
| `layer-stack-insert.svg` | 400×380 | 사용자 블록 하나를 L1 슬롯에 내려 꽂는 중 |
| `spot-*.svg` | 160×120 | plugin, intent-group, context, profile, trial, replay, hook, capability |
| `empty-*.svg` | 240×160 | no-plugins, context(이 맥락에 아무것도 없음), offline |
| `art.css` | | 토큰: 밝음·어두움, `[data-art-theme]`로 부분 전환 |
| `index.ts` | | `<Art name=… />` 컴포넌트, `artSvgs`(원문), `artSize`, `anchors` |
| `anchors.ts` | | 라벨을 HTML로 겹칠 기준점(viewBox 비율). SVG 안에는 글자가 없다 |
| `gen.py` | | 아이소 좌표 계산기. SVG를 다시 만든다: `python3 gen.py` 뒤 `just fmt` |

## 쓰는 법

```tsx
import "../_art/art.css";
import { Art, anchors } from "../_art";

<Art name="hero-lifecycle" className="w-[640px]" />          // 장식이면 aria-hidden
<Art name="empty-offline" label="오프라인" className="w-60" />  // 접근 이름
```

- 인라인으로 그린다(`?raw`). `<img src>`로 쓰면 CSS 변수가 안 닿아 색이 빠진다.
- 그라디언트 id(`a-*`)는 인스턴스마다 `useId` 접두어가 붙는다. 밝음·어두움 사본이 한 페이지에 있어도 섞이지 않는다.
- 선은 `vector-effect: non-scaling-stroke`로 렌더 크기와 무관하게 약 1.4px. 영웅을 280px로 줄여도 선이 가늘어지지 않는다.
- 단계·층 이름은 `anchors["hero-lifecycle"].tool` 같은 비율 좌표에 HTML로 얹는다(미리보기 참고).

## 토큰

| 변수 | 쓰임 |
| --- | --- |
| `--art-stroke` | 기본 선(잉크, 회보라 기 도는 짙은 회색 / 어두움에선 밝은 회색) |
| `--art-stroke-soft` | 점선 슬롯, 흐름 점선, 화살촉 |
| `--art-hi` | 강조선(iris 쪽) |
| `--art-paper`, `--art-shade` | 면 채움: 윗면·앞면 / 그늘 면 |
| `--art-g1..g4` | 라일락(iris) · 복숭아(coral) · 민트(mint) · 안개(iris+mint), 종이색에 26–38% |
| `--art-bg` | 미리보기 판 바탕 |

정체 색은 caustic 토큰(`--cs-color-identity-*`)에서 `color-mix`로 만든다. SVG 안에는 hex·글꼴·래스터가 없다.

## 그림 원칙

- 축은 정확히 30°(x→오른쪽 아래, y→왼쪽 아래, z→위). 상자는 윗면·앞왼면·앞오른면 세 면만 그리고 화가 알고리즘(x+y 깊이)으로 겹친다.
- 그라디언트는 "고른 면"에만: 사용자 플러그인, 강조 단계, 맥락 렌즈의 유리. 기본 부품은 종이색이라 "그라디언트 = 내가 꽂은 것"으로 읽힌다.
- 글로는 캔버스 안에서 완전히 사라지게 반지름을 자른다(가장자리에 각이 생기지 않게).
- 맥락 = 하나의 대화 런타임을 둘러싼 초점 상자(모서리 괄호), 프로필 = 저장된 카드 더미 위 스위치 줄.
