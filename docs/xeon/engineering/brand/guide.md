---
id: eng.brand.guide
layer: eng
domain: brand
kind: guide
status: draft
depends_on: []
binds: []
---

# 브랜드 자산 사용 가이드

Fresnel 로고는 두 조각으로 갈라진 유리 결정이다(6차 확정, 2026-11-10). 모든 그림은 경로 추적으로 그린 고해상도 렌더 한 벌에서 나왔다. 작은 크기도 다시 그리지 않고 그 렌더를 줄였다. 그래서 16 px에서도 큰 그림과 같은 유리로 보인다.

## 1. 어디에 무엇이 있나

| 쓰임 | 파일 | 크기 |
|---|---|---|
| macOS 앱 아이콘(Dock, Finder, ⌘Tab) | `xeon/apps/desktop-shell/build/icon.icns` | 16~1024 (10장) |
| 브라우저 탭 아이콘 | `xeon/apps/desktop/public/favicon.ico`, `public/brand/favicon-{16,32,48}.png` | 16, 32, 48 |
| iOS 홈 화면 | `public/brand/apple-touch-icon.png` | 180 (모서리는 iOS가 깎는다) |
| 웹 앱 설치(PWA) | `public/brand/site.webmanifest`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | 192, 512 |
| 화면 안 로고 | `public/brand/logo/fresnel-logo-{20,24,32}{,@2x,@3x}.png` | 20·24·32 pt × 1~3배 |
| 큰 그림(정보 창, 첫 실행, 빈 화면) | `public/brand/render/fresnel-{light,dark}-{512,1024}.webp` | 512, 1024 |
| 한 가지 색 마크 | `public/brand/mark/fresnel-mark-current{,-16,-20,-24,-32}.svg` | 벡터 |

`public/`은 Vite가 화면 번들(`dist/ui`) 바로 아래로 복사한다. 데스크톱 앱과 웹 게이트웨이가 같은 번들을 쓰므로 한 곳에 두면 두 쪽 다 된다. 게이트웨이는 번들 안 정적 파일을 로그인 없이 내준다. 로그인 화면도 `/brand/...`를 쓴다.

## 2. 쓰는 법

### 화면 안 로고

표시 크기의 2배와 3배 파일을 `srcset`으로 준다. 1배 파일은 일반 해상도 화면용으로만 있다.

```tsx
<img
  src="./brand/logo/fresnel-logo-20@2x.png"
  srcSet="./brand/logo/fresnel-logo-20@2x.png 2x, ./brand/logo/fresnel-logo-20@3x.png 3x"
  width={20}
  height={20}
  alt=""
/>
```

- 옆에 "Fresnel" 글자가 있으면 `alt=""`(장식)로 둔다. 로고만 있으면 `alt="Fresnel"`.
- 경로는 데스크톱 화면에서 `./brand/...`(번들 기준 상대 경로)로, 게이트웨이의 로그인 화면처럼 번들 밖 문서에서는 `/brand/...`로 쓴다.
- 표에 없는 크기는 가장 가까운 큰 파일을 CSS로 줄인다. 키우지 않는다.
- 현재 쓰는 곳: 왼쪽 패널 머리(`apps/desktop/src/views/shell/start-panel.tsx`, 20), 웹 로그인 화면(`apps/desktop-shell/src/web/static/login.html`, 40).

### 큰 그림

밝은 테마와 어두운 테마를 `<picture>`로 고른다. 화면에 보이는 크기의 2배 이상인 파일을 고른다(256 px로 보이면 512).

```html
<picture>
  <source srcset="./brand/render/fresnel-dark-1024.webp" media="(prefers-color-scheme: dark)" />
  <img src="./brand/render/fresnel-light-1024.webp" width="320" height="320" alt="Fresnel" />
</picture>
```

### 문서 머리(HTML `<head>`)

`apps/desktop/index.html`과 `login.html`에 이미 들어 있다. 새 문서를 만들면 같은 다섯 줄을 붙인다.

```html
<link rel="icon" href="./favicon.ico" sizes="48x48" />
<link rel="icon" type="image/png" sizes="32x32" href="./brand/favicon-32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="./brand/favicon-16.png" />
<link rel="apple-touch-icon" href="./brand/apple-touch-icon.png" />
<link rel="manifest" href="./brand/site.webmanifest" />
```

### 한 가지 색 마크

유리 렌더는 색과 배경이 있는 그림이다. 한 가지 색이어야 하는 곳에서만 SVG 마크를 쓴다. macOS 메뉴 막대의 템플릿 아이콘, 인쇄, 글자 색을 따라야 하는 아이콘 줄이 그렇다. `fill="currentColor"`라 글자 색을 따른다.

## 3. 하지 않는 것

- 작은 크기를 다시 그리거나 평면 그림으로 바꾸지 않는다. 크기가 모자라면 마스터에서 다시 줄인다(4절).
- 렌더를 늘리거나, 잘라 쓰거나, 색을 바꾸거나, 그림자와 테두리를 더하지 않는다.
- 아이콘 타일 바깥에 둥근 테두리나 배경을 또 두르지 않는다. 타일에 이미 모서리와 가는 테두리가 있다.

## 4. 다시 만들기

원본과 도구는 저장소 밖 디자인 노트(`~/fresnel-tracks/_notes/design/logo/v6/`)에 있다.

- 마스터: `render/icon-source-1648.png`(타일), `appicon/fresnel.svg`(macOS 격자, 2048로 그림), `render/{light,dark}-2048.png`, `render/hero-*-2048x1280.png`.
- `bun _tools/assets6.mjs`가 `assets/` 아래에 모든 크기를 만든다. 크기를 줄일 때는 선형 빛 공간에서 Lanczos-3을 쓴다. 64 px 이하는 줄인 뒤 약하게 선명하게 한다. `.icns`는 `iconutil`로, `.ico`는 PNG를 담아 만든다.
- 만든 파일을 1절의 자리로 복사한다. 마케팅 사이트용 히어로(`assets/render/fresnel-hero-*.webp`)와 실시간 히어로(`hero.html`)는 앱 번들에 넣지 않는다.
