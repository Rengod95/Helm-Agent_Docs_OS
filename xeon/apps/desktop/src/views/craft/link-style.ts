// 링크 보기의 스타일. 파일 가져오기(CSS import)는 데스크톱 타입 검사에 선언이 없어 문자열로 두고 <style>로 낸다.
// 색은 caustic 토큰(--cs-*)만 쓴다. 이름은 craft-link-로 시작해 다른 화면과 겹치지 않는다.
export const LINK_CSS: string = `.craft-link-strand {
  fill: none;
  stroke-width: var(--craft-link-w);
  stroke-linecap: round;
  stroke-dasharray: 1;
  transition: stroke-width 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
  animation: craft-link-draw 700ms cubic-bezier(0.3, 0.7, 0.2, 1) both;
}
.craft-link-head {
  stroke-width: calc(var(--craft-link-w) * 1.6);
}
@keyframes craft-link-draw {
  from {
    stroke-dashoffset: 1;
  }
  to {
    stroke-dashoffset: 0;
  }
}

.craft-link-bundle {
  --craft-link-w: 0.8px;
  transition: opacity 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.craft-link-bundle[data-state="hot"] {
  --craft-link-w: 0.95px;
}
.craft-link-bundle[data-state="sel"] {
  --craft-link-w: 1.1px;
}

.craft-link-end {
  animation: craft-link-end 240ms ease-out both;
}
@keyframes craft-link-end {
  from {
    opacity: 0;
  }
}

.craft-link-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14px;
  cursor: pointer;
}

.craft-link-light {
  fill: none;
  stroke-width: 1.5px;
  stroke-linecap: round;
  stroke-dasharray: 0.07 0.93;
  animation: craft-link-travel 3.2s linear infinite;
}
@keyframes craft-link-travel {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: -1;
  }
}

.craft-link-arrive {
  animation: craft-link-arrive 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes craft-link-arrive {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

.craft-link-caps {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--cs-color-text-tertiary);
}

.craft-link-tick {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
}

.craft-link-anchor {
  display: block;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: currentColor;
  box-shadow:
    0 0 0 2px var(--cs-color-surface-raised),
    0 0 0 3px color-mix(in oklab, currentColor 40%, transparent);
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.craft-link-anchor[data-hot] {
  transform: scale(1.35);
}

.craft-link-dot {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  outline: none;
}
.craft-link-dot > span {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
  transition: transform 200ms;
}
.craft-link-dot:hover > span {
  transform: scale(1.4);
}
.craft-link-dot[aria-pressed="true"] > span {
  box-shadow:
    0 0 0 2px var(--cs-color-surface-raised),
    0 0 0 3.5px currentColor;
}
.craft-link-dot:focus-visible {
  box-shadow: var(--cs-focus);
}

.craft-link-row {
  transition:
    background-color 180ms,
    opacity 260ms;
}
.craft-link-row[data-hot] {
  background-color: color-mix(in oklch, var(--cs-color-surface-raised), var(--cs-color-text-primary) 10%);
}
:root[data-theme="light"] .craft-link-row[data-hot] {
  background-color: color-mix(in oklch, var(--cs-color-surface-raised), var(--cs-color-text-primary) 5%);
}
.craft-link-row[data-pick] {
  outline: 1px solid var(--cs-color-text-primary);
  outline-offset: -1px;
}
.craft-link-main:focus-visible {
  box-shadow: var(--cs-focus);
  border-radius: 8px;
}

.craft-link-root {
  container-type: inline-size;
  --craft-link-hue-hook: var(--cs-color-info-graphic);
  --craft-link-hue-cap: var(--cs-color-agent-graphic);
  --craft-link-hue-group: var(--cs-color-neutral-graphic);
  --craft-link-hue-drive: var(--cs-color-warning-graphic);
  --craft-link-hue-record: var(--cs-color-success-graphic);
}
:root[data-theme="light"] .craft-link-root {
  --craft-link-hue-hook: color-mix(in oklch, var(--cs-color-info-graphic), var(--cs-color-text-primary) 22%);
  --craft-link-hue-cap: color-mix(in oklch, var(--cs-color-agent-graphic), var(--cs-color-text-primary) 15%);
  --craft-link-hue-drive: color-mix(in oklch, var(--cs-color-warning-graphic), var(--cs-color-text-primary) 28%);
  --craft-link-hue-record: color-mix(in oklch, var(--cs-color-success-graphic), var(--cs-color-text-primary) 22%);
}

.craft-link-box {
  padding-inline: clamp(20px, 3cqw, 48px);
  pointer-events: none;
}
.craft-link-left,
.craft-link-col {
  pointer-events: auto;
}
.craft-link-left {
  width: clamp(216px, 24cqw, 300px);
}
.craft-link-float {
  width: clamp(168px, 28cqw, 248px);
}

.craft-link-col {
  width: clamp(180px, 21cqw, 280px);
  scrollbar-width: none;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,
    currentColor 10px,
    currentColor calc(100% - 10px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    currentColor 10px,
    currentColor calc(100% - 10px),
    transparent 100%
  );
}
.craft-link-col::-webkit-scrollbar {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .craft-link-strand,
  .craft-link-arrive,
  .craft-link-end {
    animation: none;
  }
  .craft-link-light {
    display: none;
  }
  .craft-link-strand,
  .craft-link-bundle,
  .craft-link-row,
  .craft-link-anchor,
  .craft-link-dot > span {
    transition: none;
  }
  .craft-link-anchor[data-hot] {
    transform: none;
  }
}
`;
