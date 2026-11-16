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
