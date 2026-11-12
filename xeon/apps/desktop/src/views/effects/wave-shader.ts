// 화면 전체 물결의 색 셰이더(DP-161). WebGL2(GLSL ES 3.00). 앞선을 따라 흐르는 색 띠와, 띠가 지나간 뒤 화면 가장자리에 남는 색·머리카락 선을 그린다.
//
// 옮긴 출처: Libraries.dev "Distortion waves" iOS 포트의 DistortionWaveShaders.metal `waveBand`(와 fieldAt·perimeterAt·continuousRectSDF·rimThickness)
//   https://github.com/Jakubantalik/Libraries.dev/blob/main/packages/distortion-waves/ports/ios/DistortionWavesKit/Sources/DistortionWavesKit/DistortionWaveShaders.metal
// MIT License, Copyright (c) 2026 Jakub Antalik (전문은 wave-front.ts 머리와 docs의 제3자 표기).
//
// 다른 점: Metal의 stitchable colorEffect를 화면 전체 삼각형 하나의 조각 셰이더로 옮겼다. 좌표는 CSS px이고 위가 0이다(원본 pt와 같은 방향).
// waveLens(렌즈)·waveBlurMask(점진 흐림)는 화면을 읽어야 해서 옮기지 않았다. 앞선 방향(n)은 렌즈만 쓰므로 뺐다.

export const WAVE_VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export const WAVE_FRAGMENT = `#version 300 es
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

const float PI = 3.14159265;

float heldAt(vec2 p) {
  float hold = u_f[16];
  if (hold <= 0.0) return 1.0;
  return smoothstep(hold * 0.9, hold * 1.8, length(p - vec2(u_f[0], u_f[1])));
}

struct Field { float d; vec2 q; float g; };

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
  Field o;
  o.d = (l - radius) / g + swell * bend;
  o.q = q;
  o.g = g;
  return o;
}

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
  outColor = vec4(clamp(rgb * total + noise, 0.0, 1.0), clamp(total + noise, 0.0, 1.0));
}
`;
