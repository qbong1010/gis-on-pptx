"""whenDrawn 정산(제거/크기0/타임아웃) + 패닝 후 재그리기 정렬 확인"""
import pathlib
from playwright.sync_api import sync_playwright
BASE = "https://localhost:3000"
OUT = pathlib.Path(__file__).parent / "out"; OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(ignore_https_errors=True, viewport={"width": 800, "height": 450}); pg = ctx.new_page()
    pg.route(f"{BASE}/__blank", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><html><head><meta charset=utf-8><link rel=stylesheet href=/node_modules/leaflet/dist/leaflet.css></head><body style='margin:0'></body></html>"))
    pg.goto(f"{BASE}/__blank")
    print(pg.evaluate("""async () => (await import('/tests/vector/harness.ts')).settleDemo()"""))
    pg.goto(f"{BASE}/__blank")
    print(pg.evaluate("""async () => (await import('/tests/vector/harness.ts')).panRedrawDemo()"""))
    pg.wait_for_timeout(100)  # 재요청(250ms) 전에 캡처
    pg.screenshot(path=str(OUT / "pan-redraw-before-refetch.png")); b.close()
