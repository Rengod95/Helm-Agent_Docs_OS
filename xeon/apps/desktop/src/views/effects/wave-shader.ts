// 화면 전체 물결의 셰이더(DP-161·166). WebGL2(GLSL ES 3.00). 네 프로그램이다:
// - 렌즈(`WAVE_LENS_FRAGMENT`): 데스크톱 셸이 찍은 창 한 장을 읽어 앞선을 따라 부풀리고(굴절), 색을 갈라지게 하고(색수차), 앞선 위에서 흐린다.
//   원천 쪽으로 당기는 모으기(중력)도 여기서다. 내용이 움직이거나 흐려지지 않는 곳은 투명이라 그 아래 실제 화면이 그대로 보인다.
// - 흐림 준비(`WAVE_BLUR_FRAGMENT`): 찍은 그림을 줄여 가까운 흐림·먼 흐림 두 장을 한 번만 만든다(그림이 물결 동안 바뀌지 않는다).
// - 색(`WAVE_FRAGMENT`): 앞선을 따라 흐르는 색 띠와, 띠가 지나간 뒤 화면 가장자리에 남는 색·머리카락 선.
// - 입자(`WAVE_DOT_*`): 원천으로 모였다가 앞선과 함께 흩어지는 작은 점.
//
// 옮긴 출처: Libraries.dev "Distortion waves" iOS 포트의 DistortionWaveShaders.metal `waveLens`, `waveBlurMask`, `waveBand`(와 fieldAt·perimeterAt·
//   continuousRectSDF·rimThickness), DistortionWave.swift(흐린 사본 두 장을 쌓는 방식), WaveParticles.swift(점 그리기)
//   https://github.com/Jakubantalik/Libraries.dev/blob/main/packages/distortion-waves/ports/ios/DistortionWavesKit/Sources/DistortionWavesKit/DistortionWaveShaders.metal
// MIT License, Copyright (c) 2026 Jakub Antalik (전문은 wave-front.ts 머리와 docs의 제3자 표기).
//
// 다른 점: Metal의 stitchable layerEffect·colorEffect를 화면 전체 삼각형 하나의 조각 셰이더로 옮겼다. 좌표는 CSS px이고 위가 0이다(원본 pt와 같은 방향).
// 원본은 두 화면(떠나는 것·드러나는 것)을 앞선에서 섞는다. 여기서는 같은 화면 위를 지나가므로 한 장이고 덮기(cover)는 없다.
// 원본은 흐린 사본을 내용째 SwiftUI blur로 만든다. 여기서는 찍은 그림을 반 해상도로 줄여 가우스 흐림 두 장(7px, blur)을 미리 만든다.

const FIELD_GLSL = `
const float PI = 3.14159265;

float heldAt(vec2 p) {
  float hold = u_f[16];
  if (hold <= 0.0) return 1.0;
  return smoothstep(hold * 0.9, hold * 1.8, length(p - vec2(u_f[0], u_f[1])));
}

struct Field { float d; vec2 n; vec2 q; vec2 raw; float g; };

Field fieldAt(vec2 p) {
  vec2 raw = p - vec2(u_f[0], u_f[1]);
  float cs = cos(u_f[14]), sn = sin(u_f[14]);
  vec2 q = vec2(cs * raw.x + sn * raw.y, -sn * raw.x + cs * raw.y);
  float spine = u_f[2], radius = u_f[3], squash = u_f[4], time = u_f[5], swell = u_f[7];
  float mx = q.x * squash;
  vec2 v = vec2(max(abs(mx) - spine, 0.0), q.y);
  float l = max(length(v), 1e-3);
  vec2 grad = vec2(v.x * sign(q.x) * squash, v.y) / l;
  float g = max(length(grad), 1e-3);
  float bend;
  if (u_f[15] > 0.5) {
    float a = atan(q.y, q.x);
    bend = 0.62 * sin(2.0 * a + time * 1.1) + 0.38 * sin(3.0 * a - time * 1.5 + 1.7);
  } else {
    float s = mx * 0.0058;
    bend = 0.62 * sin(s + time * 1.1) + 0.38 * sin(s * 2.1 - time * 1.5 + 1.7);
  }
  vec2 n = grad / g;
  Field o;
  o.d = (l - radius) / g + swell * bend;
  o.n = vec2(cs * n.x - sn * n.y, sn * n.x + cs * n.y);
  o.q = q;
  o.raw = raw;
  o.g = g;
  return o;
}
`;

export const WAVE_VERTEX: string = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/**
 * 렌즈(원본 `waveLens` + `waveBlurMask`). 찍은 그림(u_tex, BGRA를 RGBA로 올린 것)과 미리 흐린 두 장(u_near, u_far, RGB)을 읽는다.
 * 내놓는 값은 premultiplied이고, 내용이 4분의 1 px 넘게 움직였거나 흐려진 곳만 덮는다(그 밖은 0이라 아래 실제 화면이 보인다)
 */
export const WAVE_LENS_FRAGMENT: string = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 u_size;      // CSS px
uniform float u_scale;    // canvas device px per CSS px
uniform float u_f[19];
uniform sampler2D u_tex;
uniform sampler2D u_near;
uniform sampler2D u_far;
uniform float u_amplitude;
uniform float u_lensWidth;
uniform float u_aberration;
uniform float u_blur;
uniform float u_blurAhead;
uniform float u_blurBehind;
uniform float u_alpha;    // 1; fades to 0 over 150ms when the screen changes (lens retired)
${FIELD_GLSL}
const float NEAR_BLUR = 7.0;
const int SPECTRUM = 5;
const vec3 spectrum[5] = vec3[5](
  vec3(0.571, 0.000, 0.000),
  vec3(0.343, 0.206, 0.000),
  vec3(0.086, 0.588, 0.086),
  vec3(0.000, 0.206, 0.343),
  vec3(0.000, 0.000, 0.571)
);

float blurAt(vec2 p) {
  Field w = fieldAt(p);
  float u = w.d / (w.d > 0.0 ? u_blurAhead : u_blurBehind);
  return u_f[6] * u_blur * exp(-u * u) * heldAt(p);
}

float ramp(float x) {
  float t = clamp(x, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Content here: two blurred copies take over from the sharp one as the blur radius grows (the original stacks two copies)
vec3 contentAt(vec2 s, float radius) {
  vec2 uv = clamp(s, vec2(0.5), u_size - 0.5) / u_size;
  vec3 sharp = texture(u_tex, uv).bgr;
  if (radius <= 0.01) return sharp;
  vec3 near = texture(u_near, uv).rgb;
  vec3 c = mix(sharp, near, ramp(radius / NEAR_BLUR));
  if (radius <= NEAR_BLUR) return c;
  return mix(c, texture(u_far, uv).rgb, ramp((radius - NEAR_BLUR) / max(u_blur - NEAR_BLUR, 1e-3)));
}

void main() {
  vec2 frag = gl_FragCoord.xy / u_scale;
  vec2 p = vec2(frag.x, u_size.y - frag.y);
  float energy = u_f[6], gravity = u_f[10];
  if (energy <= 0.0 && gravity <= 0.0) { outColor = vec4(0.0); return; }
  Field w = fieldAt(p);
  float u = w.d / (u_lensWidth * (w.d > 0.0 ? 0.85 : 1.5));
  float lift = exp(-u * u);
  float r = max(length(w.raw), 1.0);
  float held = heldAt(p);
  vec2 swollen = w.n * energy * u_amplitude * lift * held;
  vec2 inward = w.raw / r;
  vec2 s = p - swollen + inward * gravity * exp(-r / 900.0) * held;
  vec2 split = (swollen - inward * gravity * exp(-r / 240.0) * held) * u_aberration;
  float radius = energy > 0.0 ? blurAt(s) : 0.0;
  float moved = length(p - s) + length(split);
  // Coverage: the original redraws the whole screen; here only moved or blurred pixels are covered so the live DOM shows elsewhere
  float cover = max(smoothstep(0.1, 0.5, moved), smoothstep(0.05, 0.6, radius)) * u_alpha;
  if (cover <= 0.0) { outColor = vec4(0.0); return; }
  vec3 c;
  if (dot(split, split) < 0.0625) {
    c = contentAt(s, radius);
  } else {
    c = vec3(0.0);
    for (int i = 0; i < SPECTRUM; i++) {
      float along = float(i) / float(SPECTRUM - 1) * 2.0 - 1.0;
      c += contentAt(s + split * along, radius) * spectrum[i];
    }
  }
  outColor = vec4(c * cover, cover);
}
`;

/**
 * 흐림 준비. 한 방향 가우스(시그마 u_sigma, 받는 쪽 텍셀). u_swizzle이 1이면 BGRA 원본을 RGB로 바꿔 읽는다.
 * 한 번 줄이고(가로·세로) 두 번(가까운·먼) 돌려 물결이 시작하기 전에 끝낸다
 */
export const WAVE_BLUR_FRAGMENT: string = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D u_src;
uniform vec2 u_dst;       // target size (texels)
uniform vec2 u_dir;       // (1,0) horizontal, (0,1) vertical
uniform float u_sigma;    // in target texels
uniform float u_swizzle;

vec3 at(vec2 uv) {
  vec4 t = texture(u_src, uv);
  return u_swizzle > 0.5 ? t.bgr : t.rgb;
}

void main() {
  // Texel row 0 is the top line (upload and FBO share the order, so no flip)
  vec2 uv = gl_FragCoord.xy / u_dst;
  vec2 step = u_dir / u_dst;
  if (u_sigma <= 0.0) { outColor = vec4(at(uv), 1.0); return; }
  int reach = int(ceil(u_sigma * 3.0));
  vec3 sum = at(uv);
  float total = 1.0;
  for (int i = 1; i <= 48; i++) {
    if (i > reach) break;
    float k = exp(-0.5 * float(i * i) / (u_sigma * u_sigma));
    sum += (at(uv + step * float(i)) + at(uv - step * float(i))) * k;
    total += 2.0 * k;
  }
  outColor = vec4(sum / total, 1.0);
}
`;

/** 입자: 점 하나가 정점 하나(a_dot = x, y, 지름, 불투명도). 원본처럼 테두리 없는 평평한 점이다 */
export const WAVE_DOT_VERTEX: string = `#version 300 es
in vec4 a_dot;
uniform vec2 u_size;
uniform float u_scale;
out float v_radius;
out float v_alpha;
void main() {
  vec2 clip = vec2(a_dot.x / u_size.x * 2.0 - 1.0, 1.0 - a_dot.y / u_size.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_radius = a_dot.z * 0.5 * u_scale;
  v_alpha = a_dot.w;
  gl_PointSize = a_dot.w > 0.0 ? ceil(a_dot.z * u_scale) + 2.0 : 0.0;
}
`;

export const WAVE_DOT_FRAGMENT: string = `#version 300 es
precision highp float;
in float v_radius;
in float v_alpha;
uniform vec3 u_dotColor;
uniform float u_opacity;
out vec4 outColor;
void main() {
  float size = v_radius * 2.0 + 2.0;
  float d = length((gl_PointCoord - 0.5) * size);
  float a = v_alpha * u_opacity * (1.0 - smoothstep(v_radius - 0.5, v_radius + 0.5, d));
  outColor = vec4(u_dotColor * a, a);
}
`;

export const WAVE_FRAGMENT: string = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 u_size;      // CSS px
uniform float u_scale;    // device px per CSS px
uniform float u_f[19];    // wave-front.ts waveFieldAt
uniform vec3 u_pal[9];    // OKLab: seven colours, then the warm and cool fringe
uniform vec3 u_lumps[7];  // centre along the perimeter, length, depth
uniform float u_lead;
uniform float u_tail;
uniform float u_strength;
uniform float u_rimWidth;
uniform float u_rimSoftness;
uniform float u_corner;
uniform float u_uneven;
uniform float u_pulse;
uniform float u_hairWidth;
uniform float u_hairOpacity;
uniform float u_hairWhite;
uniform float u_opacity;  // final color knob (never on the lens: the live DOM bleeding through a displaced lens doubles the image)

${FIELD_GLSL}
vec3 oklabToSRGB(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  vec3 lin = clamp(vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ), 0.0, 1.0);
  return mix(12.92 * lin, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), lin));
}

float sq(float x) { return x * x; }

float continuousRectSDF(vec2 p, vec2 halfSize, float radius) {
  float a = min(radius * 1.528665, min(halfSize.x, halfSize.y));
  vec2 q = abs(p) - (halfSize - a);
  if (q.x <= 0.0 || q.y <= 0.0) {
    return max(abs(p.x) - halfSize.x, abs(p.y) - halfSize.y);
  }
  const float n = 3.26;
  vec2 u = q / a;
  float norm = pow(pow(u.x, n) + pow(u.y, n), 1.0 / n);
  vec2 g = pow(u / max(norm, 1e-4), vec2(n - 1.0));
  return (norm - 1.0) * a / max(length(g), 1e-3);
}

float signOr(float v, float of) { return of >= 0.0 ? v : -v; }

vec2 perimeterAt(vec2 p, vec2 halfSize, float r) {
  float ex = max(halfSize.x - r, 0.0);
  float ey = max(halfSize.y - r, 0.0);
  float arc = 0.5 * PI * r;
  float P = 4.0 * (ex + ey + arc);
  float ax = abs(p.x), ay = abs(p.y);
  if (ax > ex && ay > ey) {
    vec2 v = p - vec2(signOr(ex, p.x), signOr(ey, p.y));
    float a, base;
    if (p.x >= 0.0 && p.y < 0.0) { a = atan(v.x, -v.y); base = ex; }
    else if (p.x >= 0.0)         { a = atan(v.y, v.x);  base = ex + arc + 2.0 * ey; }
    else if (p.y >= 0.0)         { a = atan(-v.x, v.y); base = 3.0 * ex + 2.0 * arc + 2.0 * ey; }
    else                         { a = atan(-v.y, -v.x); base = 3.0 * ex + 3.0 * arc + 4.0 * ey; }
    return vec2(base + r * clamp(a, 0.0, 0.5 * PI), P);
  }
  bool side = ax > ex ? true : (ay > ey ? false : (halfSize.x - ax) < (halfSize.y - ay));
  if (side) {
    return vec2(p.x >= 0.0 ? ex + arc + (p.y + ey) : 3.0 * ex + 3.0 * arc + 2.0 * ey + (ey - p.y), P);
  }
  return vec2(p.y < 0.0 ? (p.x >= 0.0 ? p.x : P + p.x) : ex + 2.0 * arc + 2.0 * ey + (ex - p.x), P);
}

float rimThickness(float s, float P) {
  float t = 0.08;
  for (int i = 0; i < 7; i++) {
    vec3 lump = u_lumps[i];
    float ds = s - lump.x;
    ds -= P * floor(ds / P + 0.5);
    t += lump.z * exp(-sq(ds / lump.y));
  }
  return t / 1.0498;
}

float dither(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))) - 0.5;
}

vec3 paletteAt(float u) {
  float x = fract(u) * 7.0;
  int i = min(int(x), 6);
  int j = (i + 1) % 7;
  float m = fract(x);
  m = m * m * (3.0 - 2.0 * m);
  return mix(u_pal[i], u_pal[j], m);
}

void main() {
  vec2 frag = gl_FragCoord.xy / u_scale;
  vec2 p = vec2(frag.x, u_size.y - frag.y);
  float glow = u_f[11], rim = u_f[13];
  vec2 size = u_size;
  vec2 c = p - size * 0.5;
  float inset = max(-continuousRectSDF(c, size * 0.5, u_corner), 0.0);
  bool nearEdge = rim > 0.0 && inset < max(u_rimWidth * 2.2 * (1.0 + 1.9 * u_uneven), u_hairWidth * 0.5 + 0.75);
  if (glow <= 0.0 && !nearEdge) { outColor = vec4(0.0); return; }

  Field w = fieldAt(p);
  float d = w.d, time = u_f[5];
  bool ring = u_f[15] > 0.5;
  float turn = atan(w.q.y, w.q.x);
  float along = w.q.x * 0.0068;
  float lobes = ring
    ? 0.5 + 0.5 * sin(2.0 * turn + time * 1.4) * cos(turn - time * 0.7 + 1.2)
    : 0.5 + 0.5 * sin(along * 1.3 + time * 1.4) * cos(along * 0.6 - time * 0.7 + 1.2);
  float bandA = 0.0;
  if (glow > 0.0 && d < u_lead) {
    if (d >= 0.0) {
      float k = 1.0 - d / u_lead;
      bandA = k * k * k * (k * (k * 6.0 - 15.0) + 10.0);
    } else {
      bandA = pow(1.0 - clamp(-d / (u_tail * mix(0.6, 1.3, lobes)), 0.0, 1.0), 2.3);
    }
    bandA *= glow * u_strength * mix(0.6, 1.0, exp(-inset / 140.0)) * heldAt(p);
  }

  float around = atan(c.y / size.y, c.x / size.x);
  float rimA = 0.0;
  float hairA = 0.0;
  float shimmer = 0.5;
  if (nearEdge) {
    vec2 edge = perimeterAt(c, size * 0.5, u_corner);
    float thickness = 1.0;
    if (u_uneven > 0.0) {
      thickness = max(1.0 + (rimThickness(edge.x, edge.y) - 1.0) * u_uneven, 0.04);
    }
    float hug = exp(-sq(inset / (u_rimWidth * thickness)));
    float reached = 1.0 - smoothstep(-u_lead * 0.7, u_lead * 0.5, d);
    float kept = smoothstep(-u_rimSoftness, u_rimSoftness, d + (u_f[3] - u_f[12]) / w.g);
    shimmer = 0.5 + 0.5 * sin(time * 3.4 - edge.x / edge.y * 4.0 * PI);
    rimA = hug * reached * kept * rim * mix(1.0, 0.7 + 0.3 * shimmer, u_pulse);
    if (u_hairWidth > 0.0) {
      float line = 1.0 - smoothstep(u_hairWidth * 0.5, u_hairWidth * 0.5 + 0.75, inset);
      float hairKept = smoothstep(-u_rimSoftness, u_rimSoftness, d + (u_f[3] - u_f[18]) / w.g);
      hairA = line * reached * hairKept * rim * u_hairOpacity
        * mix(0.5, 1.0, smoothstep(0.1, 1.5, thickness))
        * mix(1.0, 0.55 + 0.45 * shimmer, u_pulse);
    }
  }

  float a = 1.0 - (1.0 - bandA) * (1.0 - rimA);
  float total = 1.0 - (1.0 - a) * (1.0 - hairA);
  if (total <= 0.0005) { outColor = vec4(0.0); return; }

  float flow = 0.62 + (ring ? turn / (2.0 * PI) : along * 0.2) + time * 0.13 + d * 0.0015
    + (ring ? 0.0 : 0.05 * sin(w.q.y * 0.009 + time));
  vec3 lab = paletteAt(flow);
  vec3 warm = u_pal[7];
  vec3 cool = u_pal[8];
  lab = mix(lab, warm, 0.5 * exp(-sq((d - 30.0) / 50.0)));
  lab = mix(lab, cool, 0.5 * exp(-sq((d + 84.0) / 72.0)));
  lab.yz *= 1.22;
  lab = mix(lab, vec3(0.99, 0.0, 0.0), 0.7 * exp(-sq((d + 8.0) / 26.0)));

  vec3 rimLab = paletteAt(around / (2.0 * PI) + time * (0.12 + 0.25 * u_pulse) + inset * 0.0012);
  rimLab.yz *= 1.1;
  lab = mix(lab, rimLab, rimA / (rimA + bandA + 1e-4));

  vec3 rgb = oklabToSRGB(lab);
  if (hairA > 0.0) {
    vec3 hair = mix(oklabToSRGB(rimLab), vec3(1.0), u_hairWhite * (0.5 + 0.5 * shimmer));
    rgb = (rgb * a * (1.0 - hairA) + hair * hairA) / total;
  }

  float noise = dither(gl_FragCoord.xy) * 2.0 / 255.0;
  outColor = vec4(clamp(rgb * total + noise, 0.0, 1.0), clamp(total + noise, 0.0, 1.0)) * u_opacity;
}
`;
