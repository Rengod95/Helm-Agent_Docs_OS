#!/usr/bin/env python3
"""Fresnel runtime illustration set: writes the SVG files next to this script.

The SVGs are the deliverable; this script only keeps the isometric math exact (30 degree axes)
and the markup uniform. Run: python3 gen.py

Conventions in every SVG
- No hex, no fonts, no raster. Colours come from CSS custom properties defined in art.css:
  --art-stroke, --art-stroke-soft, --art-hi, --art-paper, --art-shade, --art-g1..--art-g4.
- Gradient ids are `a-top`, `a-side`, `a-hot`, `a-glow`, `a-glow2`, `a-glass`; index.ts prefixes
  them per instance so light and dark copies on one page never share a gradient.
- Stroke width is set once on the root group; art.css adds vector-effect: non-scaling-stroke so
  lines stay about 1.4px at any rendered size.
"""

import math
import os

C = math.cos(math.pi / 6)  # 0.866: iso x/y axes run at 30 degrees
OUT = os.path.dirname(os.path.abspath(__file__))

FILL = {
    None: "",
    "none": ' fill="none"',
    "paper": ' fill="var(--art-paper)"',
    "shade": ' fill="var(--art-shade)"',
    "top": ' fill="url(#a-top)"',
    "side": ' fill="url(#a-side)"',
    "hot": ' fill="url(#a-hot)"',
    "glass": ' fill="url(#a-glass)"',
    "ink": ' fill="var(--art-stroke)"',
    "hi": ' fill="var(--art-hi)"',
}
DASH = ' stroke-dasharray="3 3"'
SOFT = ' stroke="var(--art-stroke-soft)"'
HI = ' stroke="var(--art-hi)"'


def n(v: float) -> str:
    s = f"{v:.1f}"
    if s.endswith(".0"):
        s = s[:-2]
    return "0" if s == "-0" else s


class Scene:
    def __init__(self, w, h, ox, oy, k=1.0):
        self.w, self.h, self.ox, self.oy, self.k = w, h, ox, oy, k
        self.out: list[str] = []
        self.bounds = [1e9, 1e9, -1e9, -1e9]
        self.anchors: list[tuple[str, float, float]] = []

    def track(self, x, y):
        b = self.bounds
        b[0], b[1], b[2], b[3] = min(b[0], x), min(b[1], y), max(b[2], x), max(b[3], y)

    # projection ---------------------------------------------------------------
    def p(self, x, y, z=0.0):
        return (self.ox + (x - y) * C * self.k, self.oy + ((x + y) * 0.5 - z) * self.k)

    def add(self, s: str):
        self.out.append(s)

    # primitives ---------------------------------------------------------------
    def path(self, pts, fill=None, extra="", close=True):
        for a, b in pts:
            self.track(a, b)
        d = "M" + " ".join(f"{n(a)} {n(b)}" for a, b in pts)
        return f'<path d="{d}{"Z" if close else ""}"{FILL[fill]}{extra}/>'

    def poly3(self, pts3, fill=None, extra="", close=True):
        return self.path([self.p(*q) for q in pts3], fill, extra, close)

    def line3(self, a, b, extra=""):
        return self.path([self.p(*a), self.p(*b)], None, extra, close=False)

    def box(self, x, y, z, w, d, h, top="paper", fl="paper", fr="shade", extra=""):
        """Three visible faces: top, front-left (y+d plane), front-right (x+w plane)."""
        P = self.p
        t = [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)]
        l = [P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)]
        r = [P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)]
        return (
            f"<g{extra}>"
            + self.path(l, fl)
            + self.path(r, fr)
            + self.path(t, top)
            + "</g>"
        )

    def cbox(self, cx, cy, z, w, d, h, **kw):
        return self.box(cx - w / 2, cy - d / 2, z, w, d, h, **kw)

    def rect_top(self, x, y, z, w, d, fill=None, extra=""):
        return self.poly3([(x, y, z), (x + w, y, z), (x + w, y + d, z), (x, y + d, z)], fill, extra)

    def plus_top(self, cx, cy, z, s, extra=""):
        return self.line3((cx - s, cy, z), (cx + s, cy, z), extra) + self.line3(
            (cx, cy - s, z), (cx, cy + s, z), extra
        )

    def ell(self, cx, cy, z, r):
        """Iso circle on a ground-parallel plane: screen ellipse (cx, cy, rx, ry)."""
        sx, sy = self.p(cx, cy, z)
        rx, ry = r * C * math.sqrt(2) * self.k, r * math.sqrt(2) / 2 * self.k
        self.track(sx - rx, sy - ry)
        self.track(sx + rx, sy + ry)
        return sx, sy, rx, ry

    def ellipse(self, cx, cy, z, r, fill=None, extra=""):
        sx, sy, rx, ry = self.ell(cx, cy, z, r)
        return f'<ellipse cx="{n(sx)}" cy="{n(sy)}" rx="{n(rx)}" ry="{n(ry)}"{FILL[fill]}{extra}/>'

    def cyl(self, cx, cy, z, r, h, top="paper", side="shade", extra=""):
        sx, syb, rx, ry = self.ell(cx, cy, z, r)
        syt = syb - h * self.k
        band = (
            f'<path d="M{n(sx - rx)} {n(syb)}A{n(rx)} {n(ry)} 0 0 0 {n(sx + rx)} {n(syb)}'
            f'L{n(sx + rx)} {n(syt)}A{n(rx)} {n(ry)} 0 0 1 {n(sx - rx)} {n(syt)}Z"{FILL[side]}/>'
        )
        return f"<g{extra}>{band}{self.ellipse(cx, cy, z + h, r, top)}</g>"

    def arc3(self, fn, t0, t1, steps=48, fill=None, extra="", close=False):
        pts = [self.p(*fn(t0 + (t1 - t0) * i / steps)) for i in range(steps + 1)]
        return self.path(pts, fill, extra, close)

    def glow(self, cx, cy, rx, ry, which="a-glow", opacity=1.0):
        # keep the whole falloff inside the canvas so no hard edge shows
        rx = max(8.0, min(rx, cx - 2, self.w - cx - 2))
        ry = max(6.0, min(ry, cy - 2, self.h - cy - 2))
        o = "" if opacity == 1 else f' opacity="{opacity}"'
        return (
            f'<ellipse cx="{n(cx)}" cy="{n(cy)}" rx="{n(rx)}" ry="{n(ry)}" '
            f'fill="url(#{which})" stroke="none"{o}/>'
        )

    # output -------------------------------------------------------------------
    def svg(self, title: str) -> str:
        w, h = self.w, self.h
        defs = (
            "<defs>"
            f'<linearGradient id="a-top" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{w}" y2="{h}">'
            '<stop offset="0" stop-color="var(--art-g1)"/>'
            '<stop offset=".5" stop-color="var(--art-g2)"/>'
            '<stop offset="1" stop-color="var(--art-g3)"/></linearGradient>'
            f'<linearGradient id="a-side" gradientUnits="userSpaceOnUse" x1="{w}" y1="0" x2="0" y2="{h}">'
            '<stop offset="0" stop-color="var(--art-g3)"/>'
            '<stop offset=".55" stop-color="var(--art-g4)"/>'
            '<stop offset="1" stop-color="var(--art-g1)"/></linearGradient>'
            '<linearGradient id="a-hot" x1="0" y1="0" x2="1" y2="1">'
            '<stop offset="0" stop-color="var(--art-g2)"/>'
            '<stop offset=".6" stop-color="var(--art-g1)"/>'
            '<stop offset="1" stop-color="var(--art-g4)"/></linearGradient>'
            '<linearGradient id="a-glass" x1="0" y1="0" x2="1" y2="1">'
            '<stop offset="0" stop-color="var(--art-g4)" stop-opacity=".5"/>'
            '<stop offset="1" stop-color="var(--art-g1)" stop-opacity=".15"/></linearGradient>'
            '<radialGradient id="a-glow">'
            '<stop offset="0" stop-color="var(--art-g1)" stop-opacity=".75"/>'
            '<stop offset=".45" stop-color="var(--art-g2)" stop-opacity=".35"/>'
            '<stop offset="1" stop-color="var(--art-g3)" stop-opacity="0"/></radialGradient>'
            '<radialGradient id="a-glow2">'
            '<stop offset="0" stop-color="var(--art-g3)" stop-opacity=".6"/>'
            '<stop offset=".5" stop-color="var(--art-g4)" stop-opacity=".28"/>'
            '<stop offset="1" stop-color="var(--art-g4)" stop-opacity="0"/></radialGradient>'
            "</defs>"
        )
        body = "".join(self.out)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="{title}">'
            f"{defs}"
            '<g fill="none" stroke="var(--art-stroke)" stroke-width="1.4" '
            f'stroke-linejoin="round" stroke-linecap="round">{body}</g></svg>\n'
        )


def fit(make, w, h, k=1.0, pad=(0, 0)):
    """Dry-run a drawing, then re-run it centred in the canvas (pad shifts the centre)."""
    probe = Scene(w, h, w / 2, h / 2, k)
    make(probe)
    x0, y0, x1, y1 = probe.bounds
    s = Scene(w, h, w / 2 + (w - x1 - x0) / 2 + pad[0], h / 2 + (h - y1 - y0) / 2 + pad[1], k)
    make(s)
    return s


def write(name: str, scene: Scene, title: str):
    if scene.anchors:
        ANCHORS[name] = scene.anchors
    with open(os.path.join(OUT, f"{name}.svg"), "w") as fh:
        fh.write(scene.svg(title))


ANCHORS: dict[str, list[tuple[str, float, float]]] = {}


def anchor(name, key, scene, x, y, z):
    sx, sy = scene.p(x, y, z)
    scene.anchors.append((key, sx / scene.w, sy / scene.h))


# ---------------------------------------------------------------------------
# 1. Hero: X lifecycle ring
# ---------------------------------------------------------------------------
STAGES = [  # key, angle (deg, increasing = clockwise on screen)
    ("input", 153),
    ("request", 225),
    ("tool", 297),
    ("boundary", 9),
    ("session", 81),
]


def stage_block(s: Scene, key, cx, cy, z, hot: bool, dim: bool):
    tp = "hot" if hot else ("paper" if dim else "top")
    fl = "hot" if hot else "paper"
    fr = "side" if hot else "shade"
    ex = HI if hot else ""
    if key == "input":  # low pad with a message tile on it
        return s.cbox(cx, cy, z, 40, 40, 8, top="paper", fl=fl, fr=fr, extra=ex) + s.cbox(
            cx - 4, cy + 2, z + 8, 20, 14, 14, top=tp, fl=fl, fr=fr, extra=ex
        )
    if key == "request":  # tall slab: the request leaving for the model
        return s.cbox(cx, cy, z, 30, 30, 46, top=tp, fl=fl, fr=fr, extra=ex)
    if key == "tool":  # two-tier block: a tool head on its base
        return s.cbox(cx, cy, z, 38, 38, 20, top="paper", fl=fl, fr=fr, extra=ex) + s.cbox(
            cx, cy, z + 20, 20, 20, 18, top=tp, fl=fl, fr=fr, extra=ex
        )
    if key == "boundary":  # gate: the step boundary the turn passes through
        return (
            s.cbox(cx - 17, cy, z, 9, 12, 42, top="paper", fl=fl, fr=fr, extra=ex)
            + s.cbox(cx + 17, cy, z, 9, 12, 42, top="paper", fl=fl, fr=fr, extra=ex)
            + s.cbox(cx, cy, z + 42, 44, 14, 8, top=tp, fl=fl, fr=fr, extra=ex)
        )
    # session / lifecycle: terraced stack
    return (
        s.cbox(cx, cy, z, 38, 38, 9, top="paper", fl=fl, fr=fr, extra=ex)
        + s.cbox(cx, cy, z + 9, 28, 28, 9, top="paper", fl=fl, fr=fr, extra=ex)
        + s.cbox(cx, cy, z + 18, 18, 18, 9, top=tp, fl=fl, fr=fr, extra=ex)
    )


def hero(highlight: str | None, name: str):
    def draw(s: Scene):
        r_in, r_out, th = 124, 170, 10
        r_mid = (r_in + r_out) / 2
        # background glows
        s.add(s.glow(s.w * 0.4, s.h * 0.48, 250, 170, "a-glow", 0.9))
        s.add(s.glow(s.w * 0.66, s.h * 0.62, 200, 130, "a-glow2", 0.85))
        # ring slab: side band (front), top annulus, inner far wall
        sx, sy, rxo, ryo = s.ell(0, 0, th, r_out)
        _, syb, _, _ = s.ell(0, 0, 0, r_out)
        s.add(
            f'<path d="M{n(sx - rxo)} {n(syb)}A{n(rxo)} {n(ryo)} 0 0 0 {n(sx + rxo)} {n(syb)}'
            f'L{n(sx + rxo)} {n(sy)}A{n(rxo)} {n(ryo)} 0 0 1 {n(sx - rxo)} {n(sy)}Z"{FILL["shade"]}/>'
        )
        _, _, rxi, ryi = s.ell(0, 0, th, r_in)
        s.add(
            f'<path fill-rule="evenodd" d="M{n(sx - rxo)} {n(sy)}A{n(rxo)} {n(ryo)} 0 1 0 {n(sx + rxo)} {n(sy)}'
            f'A{n(rxo)} {n(ryo)} 0 1 0 {n(sx - rxo)} {n(sy)}Z'
            f'M{n(sx - rxi)} {n(sy)}A{n(rxi)} {n(ryi)} 0 1 0 {n(sx + rxi)} {n(sy)}'
            f'A{n(rxi)} {n(ryi)} 0 1 0 {n(sx - rxi)} {n(sy)}Z"{FILL["paper"]}/>'
        )
        # floor inside the ring: faint gradient
        s.add(s.ellipse(0, 0, 0, r_in, "top", ' opacity=".35" stroke="none"'))
        # far inner wall bottom edge (seen through the hole)
        s.add(
            s.arc3(
                lambda t: (r_in * math.cos(t), r_in * math.sin(t), 0),
                math.radians(135),
                math.radians(315),
                48,
                None,
                SOFT,
            )
        )
        # flow line along the middle of the track, broken at each stage
        angles = [a for _, a in STAGES]
        for i, a in enumerate(angles):
            b = angles[(i + 1) % len(angles)]
            if b < a:
                b += 360
            s.add(
                s.arc3(
                    lambda t: (r_mid * math.cos(t), r_mid * math.sin(t), th),
                    math.radians(a + 17),
                    math.radians(b - 17),
                    24,
                    None,
                    SOFT + ' stroke-dasharray="1 4"',
                )
            )
        # flow chevrons on the track
        angles = [a for _, a in STAGES]
        for i, a in enumerate(angles):
            b = angles[(i + 1) % len(angles)]
            if b < a:
                b += 360
            m = math.radians((a + b) / 2)
            for dm in (0.0,):
                mm = m + dm
                tx, ty = -math.sin(mm), math.cos(mm)  # tangent (clockwise)
                rx_, ry_ = math.cos(mm), math.sin(mm)
                c = (r_mid * rx_, r_mid * ry_)
                tip = (c[0] + tx * 5, c[1] + ty * 5, th)
                w1 = (c[0] - tx * 4 + rx_ * 7, c[1] - ty * 4 + ry_ * 7, th)
                w2 = (c[0] - tx * 4 - rx_ * 7, c[1] - ty * 4 - ry_ * 7, th)
                s.add(s.poly3([w1, tip, w2], None, SOFT, close=False))
        # highlighted sector on the track
        if highlight:
            a = dict(STAGES)[highlight]
            s.add(
                s.arc3(
                    lambda t: (r_mid * math.cos(t), r_mid * math.sin(t), th),
                    math.radians(a - 30),
                    math.radians(a + 30),
                    24,
                    None,
                    HI + ' stroke-width="2.2"',
                )
            )
        # items sorted by depth (x + y)
        items: list[tuple[float, str]] = []
        # host in the centre (X extension host)
        host = s.cyl(0, 0, 0, 40, 10, top="top", side="shade") + s.cyl(0, 0, 10, 24, 8, top="hot", side="paper")
        host += "".join(
            s.ellipse(30 * math.cos(math.radians(q)), 30 * math.sin(math.radians(q)), 10, 2.2, "ink", ' stroke="none"')
            for q in range(0, 360, 45)
        )
        items.append((0.0, host))
        for key, a in STAGES:
            t = math.radians(a)
            cx, cy = r_mid * math.cos(t), r_mid * math.sin(t)
            hot = highlight == key
            dim = highlight is not None and not hot
            g = ""
            if hot:
                hx, hy = s.p(cx, cy, th + 20)
                g = s.glow(hx, hy, 80, 56, "a-glow")
            blk = stage_block(s, key, cx, cy, th, hot, dim)
            if dim:
                blk = f'<g opacity=".72">{blk}</g>'
            items.append((cx + cy, g + blk))
            top_z = {"input": 22, "request": 46, "tool": 38, "boundary": 50, "session": 27}[key] + th
            anchor(name, key, s, cx, cy, top_z + 14)
            # hook pins on the outer edge, before and after the stage
            for k_, da in enumerate((-15, 15)):
                u = math.radians(a + da)
                px, py = (r_out - 7) * math.cos(u), (r_out - 7) * math.sin(u)
                hp = 16 + 4 * k_
                pin = s.ellipse(px, py, th, 2.4, "paper", SOFT)
                pin += s.line3((px, py, th), (px, py, th + hp), HI if hot else "")
                if hot:
                    pin += s.cbox(px, py, th + hp, 8, 8, 7, top="hot", fl="paper", fr="side", extra=HI)
                else:
                    pin += s.poly3(
                        [(px - 3, py, th + hp), (px, py - 3, th + hp), (px + 3, py, th + hp), (px, py + 3, th + hp)],
                        "top" if not dim else "paper",
                    )
                items.append((px + py + 0.1, pin))
        for _, svg in sorted(items, key=lambda q: q[0]):
            s.add(svg)
    s = fit(draw, 640, 400, 1.22, (0, 6))
    write(name, s, "X lifecycle: input, request, tool, step boundary, session" + (f", {highlight} highlighted" if highlight else ""))


# ---------------------------------------------------------------------------
# 2. Layer stack: six terraced slabs, every one takes a plugin
# ---------------------------------------------------------------------------
LAYERS = ["F", "X", "L0", "L1", "L2", "L3"]


def stack(insert: bool, name: str):
    def draw(s: Scene):
        W, D, H, P, LEDGE = 150, 70, 13, 27, 28
        # (user block?, empty slot?) per layer
        plan = {
            "F": (False, True),
            "X": (True, False),
            "L0": (False, True),
            "L1": (False, True),
            "L2": (True, False),
            "L3": (True, True),
        }
        if insert:  # keep the drop column clear above L1
            plan["L2"] = (False, True)
        s.add(s.glow(s.w * 0.42, s.h * 0.55, 190, 170, "a-glow", 0.85))
        s.add(s.glow(s.w * 0.62, s.h * 0.62, 150, 130, "a-glow2", 0.8))
        x0 = -W / 2
        for i, L in enumerate(LAYERS):
            y0 = -i * LEDGE
            z0 = i * P
            s.add(s.box(x0, y0, z0, W, D, H, top="paper", fl="paper", fr="shade"))
            # subtle gradient veil on the long front face
            s.add(
                s.poly3(
                    [(x0, y0 + D, z0), (x0 + W, y0 + D, z0), (x0 + W, y0 + D, z0 + H), (x0, y0 + D, z0 + H)],
                    "top",
                    ' opacity=".55"',
                )
            )
            anchor(name, L, s, x0, y0 + D, z0 + H / 2)
        for i in reversed(range(len(LAYERS))):
            L = LAYERS[i]
            y0 = -i * LEDGE
            z0 = i * P + H
            ly = y0 + D - LEDGE / 2  # ledge centre line
            user, slot = plan[L]
            # built-in parts (paper)
            s.add(s.cbox(x0 + 20, ly, z0, 18, 16, 11, top="paper"))
            s.add(s.cbox(x0 + 44, ly, z0, 18, 16, 7, top="paper"))
            sx = x0 + W - 50
            if user:
                s.add(s.cbox(sx, ly, z0, 22, 17, 15, top="hot", fl="top", fr="side"))
                s.add(s.ellipse(sx - 4, ly - 2, z0 + 15, 1.8, "paper"))
                s.add(s.ellipse(sx + 4, ly + 2, z0 + 15, 1.8, "paper"))
            if slot:
                ex = x0 + W - 20
                hi = insert and L == "L1"
                st = (HI if hi else SOFT) + DASH
                s.add(s.rect_top(ex - 11, ly - 8.5, z0, 22, 17, None, st))
                s.add(s.plus_top(ex, ly, z0, 3.5, HI if hi else SOFT))
        if insert:
            i = LAYERS.index("L1")
            y0 = -i * LEDGE
            z0 = i * P + H
            ly = y0 + D - LEDGE / 2
            ex = x0 + W - 20
            # the new block arrives from the front and above, sliding back onto the L1 slot
            fy, fz = ly, z0 + 44
            cx_, cy_ = s.p(ex, fy, fz + 8)
            s.add(s.glow(cx_, cy_, 60, 42, "a-glow"))
            for dx, dy in ((-11, 8.5), (11, 8.5), (11, -8.5)):
                s.add(s.line3((ex + dx, ly + dy, z0), (ex + dx, fy + dy, fz), HI + DASH))
            s.add(s.cbox(ex, fy, fz, 22, 17, 15, top="hot", fl="top", fr="side", extra=HI))
            s.add(s.ellipse(ex - 4, fy - 2, fz + 15, 1.8, "paper", HI))
            s.add(s.ellipse(ex + 4, fy + 2, fz + 15, 1.8, "paper", HI))
    s = fit(draw, 400, 380, 1.0)
    write(name, s, "Layer stack F, X, L0, L1, L2, L3: every layer accepts plugins" + (", one inserted into L1" if insert else ""))


# ---------------------------------------------------------------------------
# 3. Concept spots 160x120
# ---------------------------------------------------------------------------
def spot(name, title, draw):
    def full(s: Scene):
        s.add(s.glow(70, 58, 64, 44, "a-glow", 0.85))
        s.add(s.glow(98, 72, 46, 32, "a-glow2", 0.8))
        draw(s)

    write(name, fit(full, 160, 120), title)


def d_plugin(s: Scene):
    s.add(s.cbox(0, 0, 0, 34, 34, 28, top="top", fl="paper", fr="shade"))
    for cx, cy in ((-7, -7), (7, 7)):
        s.add(s.cyl(cx, cy, 28, 4.2, 3.5, top="hot", side="paper"))
    for z in (9, 19):  # connector pins out of the right face
        s.add(s.line3((17, 4, z), (28, 4, z)))
        s.add(s.cbox(30, 4, z - 2, 4, 4, 4, top="paper"))


def d_group(s: Scene):
    s.add(s.cbox(0, 0, 0, 50, 50, 11, top="paper"))
    s.add(s.cbox(-3, -3, 11, 38, 38, 11, top="paper", fl="top", fr="shade"))
    s.add(s.cbox(-6, -6, 22, 26, 26, 11, top="hot", fl="top", fr="side"))
    s.add(s.cbox(-7, -7, 33, 10, 10, 8, top="paper", extra=HI))


def d_context(s: Scene):
    # runtime of one live conversation behind the lens
    s.add(s.ellipse(-9, -9, 0, 30, "top", ' opacity=".4" stroke="none"'))
    a, b, zt, L = -40, 22, 40, 8
    s.add(s.poly3([(a + L, a, 0), (a, a, 0), (a, a + L, 0)], None, HI, close=False))  # far corner, behind
    s.add(s.cbox(-4, -26, 0, 13, 13, 12, top="paper"))
    s.add(s.cbox(-24, -6, 0, 13, 13, 16, top="top"))
    s.add(s.cbox(16, -10, 0, 13, 13, 22, top="hot", fl="top", fr="side"))
    # the conversation thread hopping across the runtime parts
    s.add(s.poly3([(-24, -6, 16), (-4, -26, 12), (16, -10, 22)], None, SOFT + ' stroke-dasharray="1.5 3"', close=False))
    # lens: corner brackets of a focus volume around this one runtime
    for (cx, cy, sx, sy) in ((a, a, 1, 1), (b, a, -1, 1), (b, b, -1, -1), (a, b, 1, -1)):
        for z in (0, zt):
            if (cx, cy, z) == (a, a, 0):
                continue
            s.add(s.poly3([(cx + sx * L, cy, z), (cx, cy, z), (cx, cy + sy * L, z)], None, HI, close=False))
    for (cx, cy) in ((b, a), (b, b), (a, b)):
        s.add(s.line3((cx, cy, 0), (cx, cy, L), HI) + s.line3((cx, cy, zt), (cx, cy, zt - L), HI))
    s.add(s.rect_top(a, a, zt, b - a, b - a, "glass", ' stroke="none" opacity=".55"'))


def d_profile(s: Scene):
    # a saved preset: a card on a short stack of earlier cards, each row a switch
    for k in (2, 1):
        s.add(s.cbox(0, 0, (2 - k) * 5, 74, 52, 3, top="paper"))
    z = 10
    s.add(s.cbox(0, 0, z, 74, 52, 4, top="top", fl="paper", fr="shade"))
    z += 4
    for row, on in ((-15, True), (0, False), (15, True)):
        s.add(s.line3((-30, row, z), (-12, row, z), SOFT))
        s.add(s.cbox(12, row, z, 30, 5, 1.5, top="shade"))
        kx = 23 if on else 1
        s.add(s.cbox(kx, row, z + 1.5, 8, 8, 5, top="hot" if on else "paper", fl="top" if on else "paper", fr="side" if on else "shade"))


def d_trial(s: Scene):
    W, H = 64, 46
    a, b = -W / 2, W / 2
    st = SOFT + DASH
    # back edges of the sandbox
    s.add(s.line3((a, a, 0), (b, a, 0), st) + s.line3((a, a, 0), (a, b, 0), st) + s.line3((a, a, 0), (a, a, H), st))
    s.add(s.rect_top(a, a, 0, W, W, "top", ' opacity=".35" stroke="none"'))
    s.add(s.cbox(0, 0, 0, 26, 26, 24, top="top", fl="paper", fr="shade"))
    s.add(s.poly3([(13, 7, 6), (13, 7, 19), (13, -7, 12.5)], "hot", HI))
    # front edges
    s.add(
        s.rect_top(a, a, H, W, W, None, st)
        + s.line3((b, a, 0), (b, a, H), st)
        + s.line3((b, b, 0), (b, b, H), st)
        + s.line3((a, b, 0), (a, b, H), st)
        + s.line3((b, a, 0), (b, b, 0), st)
        + s.line3((a, b, 0), (b, b, 0), st)
    )


def d_replay(s: Scene):
    xs = (-42, -21, 0, 21)
    for i, x in enumerate(xs):
        s.add(s.cbox(x, -8, 0, 15, 15, 6 if i != 2 else 10, top="hot" if i == 2 else "paper", fl="top" if i == 2 else "paper", fr="side" if i == 2 else "shade"))
    # replay arc on the ground, from the last tile back to the first
    s.add(s.arc3(lambda t: (-42 + 63 * (1 - t), 14 + 10 * math.sin(math.pi * t), 0), 0, 1, 30, None, SOFT))
    dx, dy = -63.0, 10 * math.pi  # arc tangent at the end, on the ground plane
    m = math.hypot(dx, dy)
    dx, dy = dx / m, dy / m
    tx, ty = -42, 14
    s.add(s.poly3([(tx - dx * 6 - dy * 4, ty - dy * 6 + dx * 4, 0), (tx, ty, 0), (tx - dx * 6 + dy * 4, ty - dy * 6 - dx * 4, 0)], None, SOFT, close=False))
    # loupe over tile 3: ring in the x-z plane plus handle
    cx, cy, cz, r = 0, -8, 32, 9
    s.add(s.arc3(lambda t: (cx + r * math.cos(t), cy, cz + r * math.sin(t)), 0, 2 * math.pi, 48, "glass", HI, close=True))
    s.add(s.line3((cx + r * 0.7, cy, cz - r * 0.7), (cx + r * 1.6, cy, cz - r * 1.6), HI + ' stroke-width="2.4"'))


def d_hook(s: Scene):
    s.add(s.cbox(0, 0, 0, 62, 62, 10, top="paper"))
    s.add(s.rect_top(-27, -27, 10, 62 - 8, 62 - 8, "top", ' opacity=".5" stroke="none"'))
    # main socket with visible inner walls
    hx, hy, hs, hd = 2, 2, 14, 6
    s.add(s.poly3([(hx - hs / 2, hy - hs / 2, 10), (hx + hs / 2, hy - hs / 2, 10), (hx + hs / 2, hy - hs / 2, 10 - hd), (hx - hs / 2, hy - hs / 2, 10 - hd)], "shade"))
    s.add(s.poly3([(hx - hs / 2, hy - hs / 2, 10), (hx - hs / 2, hy + hs / 2, 10), (hx - hs / 2, hy + hs / 2, 10 - hd), (hx - hs / 2, hy - hs / 2, 10 - hd)], "shade"))
    s.add(s.rect_top(hx - hs / 2, hy - hs / 2, 10, hs, hs, None, HI))
    for ox, oy in ((-18, 16), (18, -18)):
        s.add(s.rect_top(ox - 5, oy - 5, 10, 10, 10, None, SOFT + DASH))
    # peg descending into it
    s.add(s.line3((hx, hy, 12), (hx, hy, 26), HI + DASH))
    s.add(s.cbox(hx, hy, 28, 11, 11, 24, top="hot", fl="top", fr="side", extra=HI))


def d_capability(s: Scene):
    R, Hh = 30, 16
    verts = [(R * math.cos(math.radians(15 + 60 * k)), R * math.sin(math.radians(15 + 60 * k))) for k in range(6)]
    for k in range(6):
        a, b = verts[k], verts[(k + 1) % 6]
        nx, ny = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        if nx + ny > 0.5:
            fill = "paper" if (nx - ny) < 0 else "shade"
            s.add(s.poly3([(a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], Hh), (a[0], a[1], Hh)], fill))
    s.add(s.poly3([(x, y, Hh) for x, y in verts], "top"))
    s.add(s.cbox(0, 0, Hh, 16, 16, 16, top="hot", fl="top", fr="side"))
    for x, y, z, e in ((-24, -14, 34, 6), (18, -26, 42, 5), (-2, 26, 30, 4)):
        s.add(s.cbox(x, y, z, e, e, e, top="hot", fl="paper", fr="side", extra=HI))


# ---------------------------------------------------------------------------
# 4. Empty states 240x160
# ---------------------------------------------------------------------------
def empty(name, title, draw):
    def full(s: Scene):
        s.add(s.glow(110, 78, 100, 62, "a-glow", 0.7))
        s.add(s.glow(148, 96, 70, 44, "a-glow2", 0.7))
        draw(s)

    write(name, fit(full, 240, 160), title)


def e_no_plugins(s: Scene):
    s.add(s.cbox(0, 0, 0, 110, 74, 9, top="paper"))
    for x in (-30, 0, 30):
        s.add(s.rect_top(x - 10, -8, 9, 20, 16, None, SOFT + DASH))
        s.add(s.plus_top(x, 0, 9, 3.5, SOFT))
    s.add(s.line3((0, 0, 14), (0, 0, 32), SOFT + DASH))
    s.add(s.cbox(0, 0, 36, 20, 16, 16, top="glass", fl="glass", fr="glass", extra=SOFT + DASH))


def e_empty_context(s: Scene):
    # empty dotted floor inside the lens
    for i in range(5):
        t = -32 + i * 16
        s.add(s.line3((t, -32, 0), (t, 32, 0), SOFT + ' stroke-dasharray="1 5"'))
        s.add(s.line3((-32, t, 0), (32, t, 0), SOFT + ' stroke-dasharray="1 5"'))
    s.add(s.ellipse(0, 0, 0, 9, None, SOFT + DASH))
    # the same lens as spot-context: corner brackets of a focus volume, here with nothing inside
    a, b, zt, L = -40, 40, 24, 10
    for (cx, cy, sx, sy) in ((a, a, 1, 1), (b, a, -1, 1), (b, b, -1, -1), (a, b, 1, -1)):
        for z in (0, zt):
            s.add(s.poly3([(cx + sx * L, cy, z), (cx, cy, z), (cx, cy + sy * L, z)], None, close=False))
    for (cx, cy) in ((b, a), (b, b), (a, b)):
        s.add(s.line3((cx, cy, 0), (cx, cy, L)) + s.line3((cx, cy, zt), (cx, cy, zt - L)))
    s.add(s.rect_top(a, a, zt, b - a, b - a, "glass", ' stroke="none" opacity=".5"'))


def e_offline(s: Scene):
    s.add(s.cbox(-34, 34, 0, 30, 30, 26, top="paper", fl="paper", fr="shade"))
    s.add(s.cbox(34, -34, 0, 30, 30, 26, top="paper", fl="paper", fr="shade"))
    # cable from each block, ending in plugs that do not meet
    s.add(s.line3((-19, 30, 13), (-8, 19, 13)))
    s.add(s.cbox(-6, 17, 10, 6, 6, 6, top="paper"))
    s.add(s.line3((19, -30, 13), (8, -19, 13)))
    s.add(s.cbox(6, -17, 10, 6, 6, 6, top="paper"))
    mx, my = s.p(0, 0, 22)
    for dx, dy, ex_, ey in ((-4, -6, -7, -11), (4, -6, 7, -11), (0, -7, 0, -13)):
        s.add(s.path([(mx + dx, my + dy), (mx + ex_, my + ey)], None, SOFT, close=False))


def main():
    hero(None, "hero-lifecycle")
    hero("tool", "hero-lifecycle-active")
    stack(False, "layer-stack")
    stack(True, "layer-stack-insert")
    spot("spot-plugin", "Plugin", d_plugin)
    spot("spot-intent-group", "Intent group", d_group)
    spot("spot-context", "Context", d_context)
    spot("spot-profile", "Profile", d_profile)
    spot("spot-trial", "Trial run", d_trial)
    spot("spot-replay", "Inspect and replay", d_replay)
    spot("spot-hook", "Extension point", d_hook)
    spot("spot-capability", "Capability", d_capability)
    empty("empty-no-plugins", "No plugins yet", e_no_plugins)
    empty("empty-context", "Nothing in this context", e_empty_context)
    empty("empty-offline", "Offline", e_offline)
    # label anchors (fractions of the viewBox) for HTML overlays
    lines = ["// 생성됨: python3 gen.py. 라벨을 HTML로 겹칠 기준점(viewBox 대비 비율 0..1).", "export const anchors = {"]
    for k, v in ANCHORS.items():
        lines.append(f'  "{k}": {{')
        for key, fx, fy in v:
            lines.append(f'    "{key}": {{ x: {fx:.3f}, y: {fy:.3f} }},')
        lines.append("  },")
    lines.append("} as const;\n")
    with open(os.path.join(OUT, "anchors.ts"), "w") as fh:
        fh.write("\n".join(lines))


if __name__ == "__main__":
    main()
