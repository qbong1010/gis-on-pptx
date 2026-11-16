"""UI 스크린샷 (브라우저 모드): python tests/core/shots_pane.py [width] — tests/core/out/ui-<width>-*.png"""
import sys, os
from playwright.sync_api import sync_playwright

W = int(sys.argv[1]) if len(sys.argv) > 1 else 340
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out")
SAMPLES = os.path.abspath(os.path.join(ROOT, "..", "..", "samples"))
IDLE = "(()=>{const b=document.querySelector('[data-testid=bake]');return !b.disabled && b.innerText.includes('슬라이드에 반영')})()"

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": W, "height": 760}, ignore_https_errors=True)
    page = ctx.new_page()
    page.goto("https://localhost:3000/taskpane.html"); page.wait_for_selector("[data-testid=add-map]")
    page.evaluate("localStorage.clear()"); page.reload(); page.wait_for_selector("[data-testid=add-map]")
    page.screenshot(path=f"{OUT}/ui-{W}-0-empty.png")
    page.click("[data-testid=settings]"); page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/ui-{W}-1-settings.png")
    page.keyboard.press("Escape")
    page.click("[data-testid=add-map]")
    page.wait_for_function("window.__slidemapMock.shapes.length>=1", timeout=30000); page.wait_for_function(IDLE, timeout=30000); page.wait_for_timeout(600)
    page.set_input_files("[data-testid=file-input]", [f"{SAMPLES}/shp-test/공공데이터_묶음.zip", f"{SAMPLES}/gangnam-sample.geojson"])
    page.wait_for_selector("[data-testid=layer-list] li"); page.wait_for_timeout(1500)
    page.locator("[data-testid=layer-menu]").first.click(); page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/ui-{W}-2-layermenu.png")
    page.locator("[data-testid=layer-delete]").click(); page.wait_for_timeout(200)
    page.screenshot(path=f"{OUT}/ui-{W}-3-layerconfirm.png")
    page.locator("button", has_text="취소").first.click()
    page.click("[data-testid=onboarding-dismiss]")
    page.click("[data-testid=preview-toggle]"); page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/ui-{W}-4-collapsed.png")
    page.click("[data-testid=preview-toggle]")
    page.get_by_role("button", name="작게").click(); page.wait_for_timeout(500)
    page.click("[data-tab=bake]"); page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/ui-{W}-5-compact-bake.png")
    page.click("[data-tab=basemap]"); page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/ui-{W}-6-basemap.png")
    b.close()
