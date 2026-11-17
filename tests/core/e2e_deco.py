"""꾸미기(범례·축척·방위표) 네이티브 텍스트 상자 + 그룹 검증/보정 — 실제 PowerPoint.
사용: PYTHONIOENCODING=utf-8 python tests/core/e2e_deco.py
각 조합을 반영한 뒤 슬라이드 PNG 와 패널 미리보기 svg 를 저장하고, 글자 잉크 위치(슬라이드 vs 미리보기) 오차를 pt 로 출력한다.
배경지도·도형을 끄므로 슬라이드는 흰 바탕에 꾸미기만 남는다."""
import io
import os
import re
import subprocess
import sys
import time

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out", "deco")
SAMPLES = os.path.abspath(os.path.join(ROOT, "..", "..", "samples"))
PS = os.path.join(ROOT, "com.ps1")
IDLE = "(()=>{const b=document.querySelector('[data-testid=bake]');return !!b && !b.disabled && b.innerText.includes('슬라이드에 반영')})()"
os.makedirs(OUT, exist_ok=True)
EXP = 1280 / 960  # 내보낸 PNG px / pt


def com(action, arg="", idx=1):
    r = subprocess.run(["powershell", "-NoProfile", "-File", PS, action, arg, str(idx)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (r.stdout or "").strip()


def shapes():
    out = []
    for line in com("list").splitlines():
        p = line.split("|")
        if len(p) >= 7:
            out.append({"name": p[0], "part": p[1], "left": float(p[2]), "top": float(p[3]), "width": float(p[4]), "height": float(p[5]), "type": p[6]})
    return out


failed = False


def check(c, m):
    global failed
    print(("PASS " if c else "FAIL ") + m)
    failed = failed or not c


def text_ink(full, graphic):
    """(글자 포함) 에서 (글자 없는 도형) 을 뺀 잉크: (x0,y0,x1,y1,cx,cy)"""
    d = np.abs(np.asarray(full.convert("L"), dtype=float) - np.asarray(graphic.convert("L"), dtype=float)) > 70
    ys, xs = np.nonzero(d)
    if not len(xs):
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1, xs.mean(), ys.mean()


def render(browser, svg, scale):
    pg = browser.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=1)
    pg.set_content(f"<body style='margin:0;background:#fff'><div id=x style='display:inline-block;line-height:0;transform:scale({scale});transform-origin:0 0'>{svg}</div></body>")
    bb = pg.locator("#x svg").bounding_box()
    png = pg.screenshot(clip={"x": 0, "y": 0, "width": int(bb["width"]) + 2, "height": int(bb["height"]) + 2})
    pg.close()
    return Image.open(io.BytesIO(png)).convert("RGB")


COMBOS = [
    {"north": "화살표", "scale": "선", "legend": "박스"},
    {"north": "나침반", "scale": "막대", "legend": "배경 없음"},
    {"north": "N 원형", "scale": "1:n 문자", "legend": "박스"},
    {"north": "단순", "scale": "선", "legend": "배경 없음"},
]

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://localhost:9229")
    page = [pg for c in b.contexts for pg in c.pages if "taskpane" in pg.url][0]
    page.on("console", lambda m: print("  CONSOLE", m.type, m.text[:200]) if m.type == "error" else None)
    hb = p.chromium.launch()
    print(com("trim-slides"), com("clear"))

    def reload():
        page.evaluate("setTimeout(()=>location.reload(),50)")
        time.sleep(3)
        page.wait_for_selector("[data-testid=add-map]")

    def bake():
        page.locator("[data-testid=bake]").dispatch_event("click")
        page.wait_for_function(IDLE, timeout=120000)
        page.wait_for_timeout(800)
        return page.inner_text("[data-testid=bake-result]").replace("\n", " | ")

    reload()
    page.evaluate("""()=>{const s=Office.context.document.settings;const idx=s.get('slidemap.index');(idx&&idx.order||[]).forEach(id=>{const m=s.get('slidemap.map.'+id);((m&&m.layers)||[]).forEach(l=>s.remove('slidemap.layer.'+l.id));s.remove('slidemap.map.'+id)});s.remove('slidemap.index');s.saveAsync(()=>{});return 1}""")
    time.sleep(2)
    reload()
    page.locator("[data-testid=add-map]").dispatch_event("click")
    page.wait_for_function("document.querySelector('[data-testid=bake-result]').innerText.includes('개 객체')", timeout=60000)
    page.locator("[data-tab=layers]").dispatch_event("click")
    page.set_input_files("[data-testid=file-input]", [f"{SAMPLES}/shp-test/공공데이터_묶음.zip", f"{SAMPLES}/gangnam-sample.geojson"])
    page.wait_for_selector("[data-testid=layer-list] li", timeout=30000)
    page.wait_for_timeout(2500)
    page.locator("[data-tab=bake]").dispatch_event("click")
    page.locator("[data-testid=bake-basemap]").dispatch_event("click")
    page.locator("[data-testid=bake-shapes]").dispatch_event("click")

    pos0 = {}
    for ci, combo in enumerate(COMBOS):
        page.locator("[data-tab=deco]").dispatch_event("click")
        for key in ("north", "scale", "legend"):
            page.locator(f"button[aria-pressed]:text-is('{combo[key]}')").first.dispatch_event("click")
        page.wait_for_timeout(500)
        svgs = {n: page.evaluate(f"(document.querySelector('[data-deco={n}]')||{{}}).innerHTML||null") for n in ("legend", "scale", "north")}
        page.locator("[data-tab=bake]").dispatch_event("click")
        print(f"bake#{ci + 1} {combo}:", bake())
        sh = shapes()
        print("\n".join(f"   {s['name']}|{s['part']}|{s['left']}|{s['top']}|{s['width']}|{s['height']}|type{s['type']}" for s in sh))
        png = os.path.join(OUT, f"slide-{ci + 1}.png")
        com("export", png)
        full = Image.open(png).convert("RGB")
        for n in ("legend", "scale", "north"):
            g = [s for s in sh if s["part"] == n]
            check(len(g) == 1 and g[0]["type"] == "6", f"{n}: single group (type 6) on slide")
            if not g or not svgs[n]:
                continue
            g = g[0]
            x0, y0, w = g["left"] * EXP, g["top"] * EXP, g["width"] * EXP
            h = g["height"] * EXP
            svg = svgs[n]
            sw = float(re.search(r'width="([\d.]+)"', svg).group(1))
            scale = w / sw
            prev = render(hb, svg, scale)
            prev_g = render(hb, re.sub(r"<text.*?</text>", "", svg), scale)
            prev.save(os.path.join(OUT, f"prev-{ci + 1}-{n}.png"))
            pad = 6
            cx, cy = int(x0) - pad, int(y0) - pad
            crop = full.crop((cx, cy, int(x0 + w) + pad + 2, int(y0 + h) + pad + 2))
            crop.save(os.path.join(OUT, f"crop-{ci + 1}-{n}.png"))
            # 슬라이드 크롭 좌표계에서 미리보기 도형을 같은 자리(서브픽셀 반올림)에 놓아 글자만 남긴다
            ox, oy = int(round(x0 - cx)), int(round(y0 - cy))
            canvas = Image.new("RGB", crop.size, (255, 255, 255))
            canvas.paste(prev_g, (ox, oy))
            canvas_t = Image.new("RGB", crop.size, (255, 255, 255))
            canvas_t.paste(prev, (ox, oy))
            ts = text_ink(crop, canvas)
            tp = text_ink(canvas_t, canvas)
            if tp and ts:
                dx, dy = (ts[4] - tp[4]) / EXP, (ts[5] - tp[5]) / EXP
                print(f"   CAL {n}#{ci + 1}: slide-vs-preview text centroid dx={dx:+.2f}pt dy={dy:+.2f}pt | bbox prev={tuple(int(v) for v in tp[:4])} slide={tuple(int(v) for v in ts[:4])}")
            else:
                print(f"   CAL {n}#{ci + 1}: no text ink prev={tp is not None} slide={ts is not None}")
    com("export", os.path.join(OUT, "slide-final.png"))

    # ---- 구조: 범례 그룹 = 도형(Graphic) 1 + 글자 상자 N, 여백 0·Malgun Gothic·외곽선 없음
    kids = com("children", "legend").splitlines()
    print(chr(10).join("   " + k for k in kids))
    check(sum("type=28" in k for k in kids) == 1 and sum("type=17" in k for k in kids) >= 2, f"legend group = 1 graphic + {sum('type=17' in k for k in kids)} text boxes")
    tk = [k for k in kids if "type=17" in k]
    check(all("margins=0/0/0/0" in k and "font=Malgun Gothic" in k and "line=0" in k for k in tk), "text boxes: zero margins, Malgun Gothic, no outline")

    # ---- 드리프트: 아무것도 안 건드리고 두 번 더 반영 → 위치 동일
    def pos():
        return {s["part"]: (s["left"], s["top"]) for s in shapes() if s["part"] in ("legend", "scale", "north")}
    p0 = pos()
    bake(); p1 = pos()
    bake(); p2 = pos()
    check(all(abs(p0[k][0] - p2[k][0]) < 0.2 and abs(p0[k][1] - p2[k][1]) < 0.2 for k in p0), f"no drift after 2 re-bakes {p0} -> {p2}")

    # ---- 사용자가 범례 그룹을 옮기면 유지
    print(com("move-part", "legend"))
    m0 = pos()["legend"]
    bake()
    m1 = pos()["legend"]
    check(abs(m1[0] - m0[0]) < 0.3 and abs(m1[1] - m0[1]) < 0.3 and abs(m0[0] - p2["legend"][0]) > 50, f"moved legend group kept {m0} -> {m1}")
    bake()
    m2 = pos()["legend"]
    check(abs(m2[0] - m0[0]) < 0.3 and abs(m2[1] - m0[1]) < 0.3, f"moved legend stays on 2nd re-bake {m2}")

    # ---- 그룹 해제(COM Ungroup) 해도 글자는 제자리
    before = {k.split("|")[0]: k.split("|")[2] for k in com("children", "legend").splitlines()}
    print(com("ungroup", "legend"))
    after = {s["name"]: f"{s['left']},{s['top']},{s['width']},{s['height']}" for s in shapes()}
    diffs = []
    for nme, geo in before.items():
        a = [float(v) for v in after.get(nme, "nan,nan,nan,nan").split(",")]
        b0 = [float(v) for v in geo.split(",")]
        if max(abs(x - y) for x, y in zip(a, b0)) > 0.15:
            diffs.append((nme[-12:], b0, a))
    check(not diffs, f"ungroup leaves children in place ({len(before)} shapes) {diffs[:2]}")
    # 낱개로 풀린 뒤 다시 반영 → 이전 지도 객체로 인식해 교체(중복 없음)
    bake()
    sh = shapes()
    check(sum(1 for s in sh if s["part"] == "legend") == 1 and not any("글자" in s["name"] and s["part"] == "legend-text" for s in sh), "re-bake after user ungroup replaces old pieces (no duplicates)")

    # ---- 지도 전체 묶기(중첩 그룹) → 재반영 때 풀고 다시 만든다
    page.locator("[data-testid=bake-group]").dispatch_event("click")
    print("group bake:", bake())
    sh = shapes()
    top = [s for s in sh if s["part"] == "group"]
    check(len(top) == 1 and len(sh) <= 2 + 1, f"map-level group wraps everything ({len(sh)} top-level shapes)")
    g0 = pos() if top == [] else None
    bake()
    sh = shapes()
    check(len([s for s in sh if s["part"] == "group"]) == 1, "map group re-created on re-bake (single)")
    print(chr(10).join(f"   {s['name']}|{s['part']}|{s['left']}|{s['top']}|{s['width']}|{s['height']}|type{s['type']}" for s in sh))
    page.locator("[data-testid=bake-group]").dispatch_event("click")
    bake()
    p3 = pos()
    check(all(abs(p3[k][0] - p3[k][0]) < 0.2 for k in p3) and len(p3) == 3, f"after ungrouping option decorations are top-level groups again {p3}")
    com("export", os.path.join(OUT, "slide-final2.png"))
    hb.close()
print("FAILED" if failed else "ALL PASSED")
sys.exit(1 if failed else 0)
