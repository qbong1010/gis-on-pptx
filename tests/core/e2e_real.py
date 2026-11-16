"""실제 PowerPoint(WebView2 CDP 9229) E2E. 사용: python tests/core/e2e_real.py [basemap-id]
PowerPoint 가 열려 있고 작업창이 https://localhost:3000/taskpane.html 이어야 한다. (PYTHONIOENCODING=utf-8)
검증: 가져오기·반영·프레임 채택·H3(패널 프레임 편집 유지)·H4(꾸미기 위치)·M6(z 순서)·H1(반영 중 슬라이드 전환)·M7(슬라이드 선택)·M1(삭제 확인)
"""
import faulthandler; faulthandler.dump_traceback_later(900, exit=True)
import subprocess, sys, os, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out")
SAMPLES = os.path.abspath(os.path.join(ROOT, "..", "..", "samples"))
BASEMAP = sys.argv[1] if len(sys.argv) > 1 else None
PS = os.path.join(ROOT, "com.ps1")
IDLE = "(()=>{const b=document.querySelector('[data-testid=bake]');return !!b && !b.disabled && b.innerText.includes('슬라이드에 반영')})()"
os.makedirs(OUT, exist_ok=True)


def com(action, arg="", idx=1):
    r = subprocess.run(["powershell", "-NoProfile", "-File", PS, action, arg, str(idx)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (r.stdout or "").strip()


def shapes(idx=1):
    out = []
    for line in com("list", "", idx).splitlines():
        p = line.split("|")
        if len(p) < 7:
            continue
        out.append({"name": p[0], "part": p[1], "left": float(p[2]), "top": float(p[3]), "width": float(p[4]), "height": float(p[5])})
    return out


def part(name, idx=1):
    return [s for s in shapes(idx) if s["part"] == name][0]


failed = False


def check(c, m):
    global failed
    print(("PASS " if c else "FAIL ") + m)
    failed = failed or not c


with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://localhost:9229")
    page = [pg for c in b.contexts for pg in c.pages if "taskpane" in pg.url][0]
    page.on("console", lambda m: print("  CONSOLE", m.type, m.text[:200]) if m.type == "error" else None)
    print(com("trim-slides"), com("clear"))

    def reload():
        page.evaluate("setTimeout(()=>location.reload(),50)")
        time.sleep(3)
        page.wait_for_selector("[data-testid=add-map]")

    def bake_and_wait(timeout=120000, expect="개 객체"):
        page.locator("[data-testid=bake]").dispatch_event("click")
        page.wait_for_function(IDLE, timeout=timeout)
        page.wait_for_timeout(800)
        return page.inner_text("[data-testid=bake-result]")

    reload()
    page.evaluate("""()=>{const s=Office.context.document.settings;const idx=s.get('slidemap.index');(idx&&idx.order||[]).forEach(id=>{const m=s.get('slidemap.map.'+id);((m&&m.layers)||[]).forEach(l=>s.remove('slidemap.layer.'+l.id));s.remove('slidemap.map.'+id)});s.remove('slidemap.index');s.saveAsync(()=>{});return 1}""")
    time.sleep(2)
    reload()
    page.locator("[data-testid=add-map]").dispatch_event("click")
    page.wait_for_function("document.querySelector('[data-testid=bake-result]').innerText.includes('개 객체')", timeout=60000)
    check(len([s for s in shapes() if s["part"] == "basemap"]) == 1, "placeholder basemap on slide")
    if BASEMAP:
        page.locator("[data-tab=basemap]").dispatch_event("click")
        page.select_option("[data-testid=basemap-select]", BASEMAP)
        page.wait_for_timeout(2500)
    page.locator("[data-tab=layers]").dispatch_event("click")
    page.set_input_files("[data-testid=file-input]", [f"{SAMPLES}/shp-test/공공데이터_묶음.zip", f"{SAMPLES}/gangnam-sample.geojson"])
    page.wait_for_selector("[data-testid=layer-list] li", timeout=30000)
    page.wait_for_timeout(2500)
    li = page.locator("[data-testid=layer-list] > li").first
    li.locator("button[aria-label='스타일 펼치기']").dispatch_event("click")
    page.locator("button[title='빨간 굵은 점선, 채움 없음']").first.dispatch_event("click")
    opts = li.locator("select").nth(1).locator("option").all_inner_texts()
    if len(opts) > 1:
        li.locator("select").nth(1).select_option(index=1)
    print("bake#1:", bake_and_wait().replace("\n", " | "))
    sh = shapes()
    parts = [s["part"] for s in sh]
    check(all(x in parts for x in ("legend", "scale", "north")), "decorations on slide")
    check(sum(1 for x in parts if x.startswith("layer:")) >= 2, "per-layer SVG shapes")
    print(com("export", os.path.join(OUT, f"real-1-baked{'-' + BASEMAP if BASEMAP else ''}.png")))

    # ---- H3: 패널에서 프레임 편집 → 반영 → 패널 값이 이긴다
    page.locator("[data-tab=bake]").dispatch_event("click")
    page.locator("button[title='슬라이드 전체 크기로']").dispatch_event("click")
    page.wait_for_timeout(600)
    bake_and_wait()
    bm = part("basemap")
    check(abs(bm["left"]) < 1 and abs(bm["top"]) < 1 and abs(bm["width"] - 960) < 1 and abs(bm["height"] - 540) < 1, f"H3 pane frame edit wins {bm['left']},{bm['top']},{bm['width']},{bm['height']}")
    lg, sc, nn = part("legend"), part("scale"), part("north")
    check(abs(lg["left"] + lg["width"] - 948) < 2 and abs(lg["top"] + lg["height"] - 528) < 2, f"H4 legend at br of new frame ({lg['left']+lg['width']:.1f},{lg['top']+lg['height']:.1f})")
    check(abs(nn["left"] + nn["width"] - 948) < 2 and abs(nn["top"] - 12) < 2, f"H4 north at tr of new frame ({nn['left']:.1f},{nn['top']:.1f})")
    print(com("export", os.path.join(OUT, "real-2-h3-fullframe.png")))

    # ---- H4: 사용자가 옮긴 방위표는 유지
    n0 = part("north")
    print(com("move-north"))
    bake_and_wait()
    n1 = part("north")
    check(abs(n1["left"] - (n0["left"] - 150)) < 2 and abs(n1["top"] - (n0["top"] + 100)) < 2, f"H4 moved north kept ({n1['left']:.1f},{n1['top']:.1f})")
    # ---- H4: 슬라이드에서 지도 영역을 옮기고 줄이면 꾸미기가 따라간다
    print(com("move-frame"))
    msg = bake_and_wait()
    check("바꾼 영역" in msg, "frame change on slide adopted")
    lg2, sc2, n2 = part("legend"), part("scale"), part("north")
    check(abs(lg2["left"] + lg2["width"] - (840 - 12)) < 2 and abs(lg2["top"] + lg2["height"] - (450 - 12)) < 2, f"H4 legend follows frame ({lg2['left']+lg2['width']:.1f},{lg2['top']+lg2['height']:.1f})")
    check(abs(sc2["left"] - (200 + 12)) < 2, f"H4 scale follows frame ({sc2['left']:.1f})")
    exp_l = min(200 + n1["left"], 200 + 640 - n2["width"])
    exp_t = min(90 + n1["top"], 90 + 360 - n2["height"])
    check(abs(n2["left"] - exp_l) < 2 and abs(n2["top"] - exp_t) < 2 and n2["left"] >= 200 - 1 and n2["top"] >= 90 - 1, f"H4 user offset follows frame + clamped inside ({n2['left']:.1f},{n2['top']:.1f} exp {exp_l:.1f},{exp_t:.1f})")
    print(com("export", os.path.join(OUT, "real-3-h4-moved.png")))

    # ---- M6: 사용자가 지도 위에 올린 텍스트 상자는 다시 반영해도 맨 위
    print(com("add-textbox"))
    bake_and_wait()
    names = [s["name"] for s in shapes()]
    check(names[-1] == "USER_TITLE", f"M6 user textbox stays on top (last={names[-1][:30]})")
    check(names.index("USER_TITLE") > max(i for i, s in enumerate(shapes()) if s["part"]), "M6 textbox above all map parts")
    print(com("export", os.path.join(OUT, "real-4-m6.png")))

    # ---- H1: 반영 중에 슬라이드를 바꿔도 원래 슬라이드에만 반영
    n_before = len(shapes())
    mine2 = lambda: [x for x in shapes(2) if x["part"]]  # 새 슬라이드의 레이아웃 자리표시자는 제외
    print(com("add-slide"))
    # PowerPoint.run 마다 0.35초 지연시켜 반영이 수 초 걸리게 만든 뒤, 그 사이에 슬라이드를 2번으로 바꾼다
    page.evaluate("""()=>{window.__origRun=PowerPoint.run.bind(PowerPoint);PowerPoint.run=(...a)=>new Promise(r=>setTimeout(r,350)).then(()=>window.__origRun(...a));return PowerPoint.run.toString().slice(0,30)}""")
    page.locator("[data-testid=bake]").dispatch_event("click")
    time.sleep(1.2)
    print("goto:", com("goto", "2"))
    page.wait_for_function(IDLE, timeout=180000)
    page.evaluate("()=>{PowerPoint.run=window.__origRun}")
    page.wait_for_timeout(1000)
    res = page.inner_text("[data-testid=bake-result]").replace(chr(10), " | ")
    print("bake during goto:", res)
    diag = page.evaluate("window.__slidemapDiag.entries.map(e=>e.text).filter(t=>t.includes('슬라이드가 바뀜'))")
    print("slide-change diag:", diag[-1:] )
    s1 = shapes(1)
    check(len(mine2()) == 0, f"H1 slide 2 untouched (SlideMap shapes on slide 2 = {len(mine2())})")
    check(len(s1) == n_before and any(s["part"] == "basemap" for s in s1), f"H1 original slide keeps objects ({n_before} -> {len(s1)})")
    check("개 객체" in res, "H1 bake reported success")
    check(len(diag) > 0, "H1 mid-bake slide switch was detected and handled")
    com("goto", "2")
    time.sleep(1.5)

    # ---- M7: 다른 슬라이드에서 반영 → 선택지, 원래 슬라이드로 이동해서 반영
    page.locator("[data-testid=bake]").dispatch_event("click")
    page.wait_for_selector("[data-testid=slide-choice]", timeout=20000)
    check(True, "M7 slide choice shown on other slide")
    page.locator("[data-testid=choice-orig]").dispatch_event("click")
    page.wait_for_function(IDLE, timeout=120000)
    page.wait_for_timeout(1000)
    check(com("current") == "1", f"M7 navigated to original slide (current={com('current')})")
    check(len(mine2()) == 0 and len(shapes(1)) == n_before, "M7 slide 2 has no map objects, slide 1 intact")

    # ---- L6: 배경지도를 끄면 투명 영역 사각형으로 지도 영역을 추적
    page.locator("[data-tab=bake]").dispatch_event("click")
    page.locator("[data-testid=bake-basemap]").dispatch_event("click")
    bake_and_wait()
    fr = [x for x in shapes() if x["part"] == "frame"]
    check(len(fr) == 1 and not any(x["part"] == "basemap" for x in shapes()), f"L6 frame rect instead of basemap ({fr[0]['left']:.0f},{fr[0]['top']:.0f},{fr[0]['width']:.0f},{fr[0]['height']:.0f})" if fr else "L6 frame rect missing")
    page.locator("[data-testid=bake-basemap]").dispatch_event("click")
    bake_and_wait()
    check(not any(x["part"] == "frame" for x in shapes()) and any(x["part"] == "basemap" for x in shapes()), "L6 basemap back, frame rect replaced")
    print(com("export", os.path.join(OUT, "real-5-final.png")))

    # ---- M1: 지도 삭제 인라인 확인 (window.confirm 미사용)
    page.locator("[data-testid=map-delete]").dispatch_event("click")
    check(page.locator("[data-testid=map-delete-confirm]").count() == 1, "M1 inline confirm shown")
    page.locator("[data-testid=map-delete-no]").dispatch_event("click")
    check(page.locator("[data-testid=map-select]").count() == 1, "M1 cancel keeps map")
    page.locator("[data-testid=map-delete]").dispatch_event("click")
    page.locator("[data-testid=map-delete-yes]").dispatch_event("click")
    page.wait_for_timeout(500)
    check(page.locator("[data-testid=map-select]").count() == 0, "M1 delete removes map (slide objects remain)")
    check(len(shapes(1)) == n_before, "slide objects kept after map delete")
    print(com("trim-slides"))
    print(page.evaluate("window.__slidemapDiag.entries.slice(-8).map(e=>e.level+' '+e.text).join(' || ')"))
print("FAILED" if failed else "ALL PASSED")
sys.exit(1 if failed else 0)
