"""브라우저 모드(Mock 슬라이드) E2E: python tests/core/e2e_pane.py [width]"""
import json, sys, os
from playwright.sync_api import sync_playwright

W = int(sys.argv[1]) if len(sys.argv) > 1 else 380
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out")
SAMPLES = os.path.abspath(os.path.join(ROOT, "..", "..", "samples"))
os.makedirs(OUT, exist_ok=True)

def shapes(page):
    return page.evaluate("window.__slidemapMock.shapes.map(s=>({id:s.id,name:s.name,kind:s.kind,part:s.tags.SLIDEMAP_PART,map:s.tags.SLIDEMAP_MAP,ver:s.tags.SLIDEMAP_VER,left:s.left,top:s.top,width:s.width,height:s.height}))")

def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        global failed
        failed = True
failed = False

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": W, "height": 900}, ignore_https_errors=True)
    page = ctx.new_page()
    logs = []
    page.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
    page.goto("https://localhost:3000/taskpane.html")
    page.wait_for_selector("[data-testid=add-map]")
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_selector("[data-testid=add-map]")
    page.screenshot(path=f"{OUT}/{W}-0-empty.png")

    page.click("[data-testid=add-map]")
    page.wait_for_function("window.__slidemapMock.shapes.length>=1", timeout=30000)
    s = shapes(page)
    check(len(s) == 1 and s[0]["part"] == "basemap", "placeholder basemap inserted on 지도 추가")
    check(s[0]["ver"] == "2" and s[0]["map"], "tags MAP/VER present")
    mapid = s[0]["map"]
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/{W}-1-added.png")

    # 드래그 패닝 검증 (CSS 배율에서 동작)
    box = page.locator(".sm-map").bounding_box()
    before = page.evaluate("JSON.stringify(Object.keys(localStorage).filter(k=>k.includes('map')))")
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down(); page.mouse.move(box["x"] + box["width"] / 2 + 60, box["y"] + box["height"] / 2 + 30, steps=5); page.mouse.up()
    try:
        page.wait_for_function("(()=>{const k=Object.keys(localStorage).find(k=>k.includes('slidemap.map.'));return k && Math.abs(JSON.parse(localStorage[k]).view.center[1]-127.0276)>1e-5})()", timeout=6000)
    except Exception:
        pass
    view = page.evaluate("(()=>{const k=Object.keys(localStorage).find(k=>k.includes('slidemap.map.'));return JSON.parse(localStorage[k]).view})()")
    check(abs(view["center"][1] - 127.0276) > 1e-5, f"pan by drag changed center {view['center']}")

    # 레이어 가져오기
    page.set_input_files("[data-testid=file-input]", [f"{SAMPLES}/shp-test/공공데이터_묶음.zip", f"{SAMPLES}/gangnam-sample.geojson"])
    page.wait_for_selector("[data-testid=layer-list] li", timeout=20000)
    page.wait_for_timeout(1200)
    n = page.locator("[data-testid=layer-list] > li").count()
    check(n >= 2, f"layers imported: {n}")
    page.screenshot(path=f"{OUT}/{W}-2-layers.png")

    # 스타일 변경: 첫 레이어 펼치고 프리셋
    page.locator("[data-testid=layer-list] > li").first.locator("button[aria-label='스타일 펼치기']").click()
    page.locator("button[title='빨간 굵은 점선, 채움 없음']").first.click()
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/{W}-3-style.png", full_page=False)

    # 꾸미기
    page.click("[data-tab=deco]")
    page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/{W}-4-deco.png")
    page.click("[data-tab=bake]")
    page.screenshot(path=f"{OUT}/{W}-5-bake-tab.png")

    page.click("[data-testid=bake]")
    page.wait_for_function("document.querySelector('[data-testid=bake-result]').innerText.includes('객체')", timeout=60000)
    page.wait_for_timeout(500)
    s = shapes(page)
    parts = [x["part"] for x in s]
    print(parts)
    check("basemap" in parts, "basemap present")
    check(sum(1 for x in parts if x and x.startswith("layer:")) >= 2, "per-layer svg present")
    for part in ("north", "scale", "legend"):
        check(part in parts, f"{part} present")
    check(all(x["ver"] == "2" and x["map"] == mapid for x in s), "all shapes tagged with map id/ver")
    check(all(x["name"].startswith("SlideMap · ") for x in s), "names")
    check(len([x for x in s if x["part"] == "basemap"]) == 1, "single basemap after replace")
    page.screenshot(path=f"{OUT}/{W}-6-baked.png")

    # 슬라이드에서 north 이동 + basemap 리사이즈
    north = [x for x in s if x["part"] == "north"][0]
    base = [x for x in s if x["part"] == "basemap"][0]
    page.evaluate(f"window.__slidemapMock.move('{north['id']}', -200, 120)")
    page.evaluate(f"window.__slidemapMock.setRect('{base['id']}', {{left: 80, top: 30, width: 700, height: 420}})")
    page.click("[data-testid=bake]")
    page.wait_for_function("document.querySelector('[data-testid=bake-result]').innerText.includes('영역')", timeout=60000)
    page.wait_for_timeout(500)
    s2 = shapes(page)
    b2 = [x for x in s2 if x["part"] == "basemap"][0]
    n2 = [x for x in s2 if x["part"] == "north"][0]
    check(abs(b2["left"] - 80) < 0.6 and abs(b2["width"] - 700) < 0.6 and abs(b2["height"] - 420) < 0.6, f"new frame adopted {b2['left']},{b2['top']},{b2['width']},{b2['height']}")
    check(abs(n2["left"] - north["left"] + 200) < 0.6 and abs(n2["top"] - north["top"] - 120) < 0.6, f"moved north arrow kept ({n2['left']:.1f},{n2['top']:.1f})")
    check(len(s2) == len(s), f"shape count stable {len(s)} -> {len(s2)}")
    page.wait_for_timeout(1000)
    frame = page.evaluate("(()=>{const k=Object.keys(localStorage).find(k=>k.includes('slidemap.map.'));return JSON.parse(localStorage[k]).frame})()")
    check(abs(frame["width"] - 700) < 0.6, f"doc frame updated {frame}")
    page.screenshot(path=f"{OUT}/{W}-7-rebaked.png")
    page.locator("[data-testid=mock-slide]").screenshot(path=f"{OUT}/{W}-8-mockslide.png")

    IDLE = "(()=>{const b=document.querySelector('[data-testid=bake]');return !b.disabled && b.innerText.includes('슬라이드에 반영')})()"
    def do_bake():
        page.click("[data-testid=bake]")
        page.wait_for_timeout(150)
        page.wait_for_function(IDLE, timeout=60000)
        page.wait_for_timeout(500)
    def part(name):
        return [x for x in shapes(page) if x["part"] == name and x["map"] == mapid][0]
    def pane_doc():
        return page.evaluate("(()=>{const k=Object.keys(localStorage).find(k=>k.includes('slidemap.map.'));return JSON.parse(localStorage[k])})()")

    # --- 반영 직후에는 '변경 있음' 배지가 없고, 편집하면 생기며 이전 결과 줄이 사라진다 (B3)
    check(page.locator("[data-testid=dirty-badge]").count() == 0, "no dirty badge right after bake")
    page.click("[data-tab=layers]")
    page.locator("[data-testid=layer-list] > li").first.locator("button[aria-label='스타일 펼치기']").click()
    page.locator("button[title='주황 채움 30%']").first.click()
    page.wait_for_timeout(400)
    check(page.locator("[data-testid=dirty-badge]").count() == 1, "dirty badge after edit")
    check("객체" not in page.inner_text("[data-testid=bake-result]"), "stale result line cleared when dirty")
    page.locator("[data-testid=tab-body]").evaluate("e=>e.scrollTop=50")
    page.click("[data-tab=deco]")
    check(page.locator("[data-testid=tab-body]").evaluate("e=>e.scrollTop") == 0, "tab body scrollTop reset on tab change")

    # --- H3: 패널에서 프레임 편집 → 반영하면 슬라이드가 패널 값으로 바뀐다(슬라이드 값으로 되돌아가지 않음)
    page.click("[data-tab=bake]")
    page.click("button[title='슬라이드 전체 크기로']")
    page.wait_for_timeout(500)
    do_bake()
    bb = part("basemap")
    check(abs(bb["left"]) < 0.6 and abs(bb["width"] - 960) < 0.6 and abs(bb["height"] - 540) < 0.6, f"H3 pane frame edit wins ({bb['left']},{bb['top']},{bb['width']},{bb['height']})")
    check(abs(pane_doc()["frame"]["width"] - 960) < 0.6, "H3 doc frame stays full")
    # H4: 사용자가 옮긴 방위표는 영역 기준 오프셋(440,203)으로 유지, 안 옮긴 범례/축척은 모서리 프리셋
    nn = part("north")
    check(abs(nn["left"] - 440) < 1.5 and abs(nn["top"] - 203) < 1.5, f"H4 moved north follows frame ({nn['left']:.1f},{nn['top']:.1f})")
    lg = part("legend"); sc = part("scale")
    check(abs(lg["left"] + lg["width"] - (960 - 12)) < 1.5 and abs(lg["top"] + lg["height"] - (540 - 12)) < 1.5, f"H4 legend at br corner of new frame ({lg['left']+lg['width']:.1f},{lg['top']+lg['height']:.1f})")
    check(abs(sc["left"] - 12) < 1.5 and abs(sc["top"] + sc["height"] - (540 - 12)) < 1.5, f"H4 scale at bl corner of new frame ({sc['left']:.1f})")
    # H4: 슬라이드에서 프레임을 옮기면 꾸미기가 따라간다
    base = part("basemap")
    page.evaluate(f"window.__slidemapMock.setRect('{base['id']}', {{left: 100, top: 50, width: 800, height: 450}})")
    do_bake()
    lg2 = part("legend"); n2b = part("north")
    check(abs(lg2["left"] + lg2["width"] - (900 - 12)) < 1.5 and abs(lg2["top"] + lg2["height"] - (500 - 12)) < 1.5, f"H4 legend follows moved frame ({lg2['left']+lg2['width']:.1f},{lg2['top']+lg2['height']:.1f})")
    check(abs(n2b["left"] - (100 + 440)) < 1.5 and abs(n2b["top"] - (50 + 203)) < 1.5, f"H4 user offset follows moved frame ({n2b['left']:.1f},{n2b['top']:.1f})")
    # H4: 모서리를 바꾸면 사용자 오프셋이 초기화되어 프리셋 위치로
    page.click("[data-tab=deco]")
    page.locator("[role=group][aria-label='꾸미기 위치']").first.locator("button[title='왼쪽 위']").click()
    page.wait_for_timeout(400)
    do_bake()
    n3 = part("north")
    check(abs(n3["left"] - (100 + 12)) < 1.5 and abs(n3["top"] - (50 + 12)) < 1.5, f"H4 corner change resets offset ({n3['left']:.1f},{n3['top']:.1f})")

    # --- H2: 반영 중에는 지도 전환이 막히고, 다른 지도의 객체는 건드리지 않는다
    page.click("[data-testid=add-map]")
    page.wait_for_function("window.__slidemapMock.shapes.filter(s=>s.tags.SLIDEMAP_PART==='basemap').length>=2", timeout=30000)
    page.wait_for_function(IDLE, timeout=30000)
    page.wait_for_timeout(600)
    ids = page.evaluate("Object.keys(localStorage).filter(k=>k.includes('slidemap.map.')).map(k=>JSON.parse(localStorage[k])).map(d=>[d.name,d.id])")
    m1 = [i for n, i in ids if n == "지도 1"][0]
    page.select_option("[data-testid=map-select]", m1)
    page.wait_for_timeout(1200)
    before = {}
    for x in shapes(page):
        before.setdefault(x["map"], []).append(x["part"])
    page.click("[data-testid=bake]")
    disabled = page.evaluate("document.querySelector('[data-testid=map-select]').disabled")
    check(disabled and page.locator("[data-testid=add-map]").is_disabled(), "H2 map select/add disabled while baking")
    page.wait_for_function(IDLE, timeout=60000)
    page.wait_for_timeout(600)
    after = {}
    for x in shapes(page):
        after.setdefault(x["map"], []).append(x["part"])
    other = [k for k in after if k != m1][0]
    check(after[other] == before[other] and len(after[m1]) == len(before[m1]), f"H2 other map untouched {before[other]} -> {after[other]}")

    # --- M1: 지도 삭제는 인라인 확인
    page.select_option("[data-testid=map-select]", other)  # 레이어가 없는 두 번째 지도를 지운다
    page.wait_for_timeout(500)
    page.click("[data-testid=map-delete]")
    check(page.locator("[data-testid=map-delete-confirm]").count() == 1, "M1 inline delete confirm shown")
    page.click("[data-testid=map-delete-no]")
    check(page.locator("[data-testid=map-select] option").count() == 2, "M1 cancel keeps map")
    page.click("[data-testid=map-delete]"); page.click("[data-testid=map-delete-yes]")
    page.wait_for_timeout(300)
    check(page.locator("[data-testid=map-select] option").count() == 1, "M1 delete confirmed removes map")
    page.screenshot(path=f"{OUT}/{W}-7b-after-h2.png")

    # 문서 저장 재로드 복원
    page.reload()
    page.wait_for_selector("[data-testid=map-select]")
    page.wait_for_timeout(1500)
    check(page.locator("[data-testid=layer-list] > li").count() >= 2, "layers restored after reload")
    page.screenshot(path=f"{OUT}/{W}-9-reloaded.png")

    errs = [l for l in logs if "error" in l.lower() and "tile" not in l.lower() and "ERR_" not in l]
    print("console errors:", errs[:5])
    b.close()
print("FAILED" if failed else "ALL PASSED")
sys.exit(1 if failed else 0)
