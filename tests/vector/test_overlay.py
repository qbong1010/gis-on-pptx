"""Leaflet 레이어(이미지 오버레이) 실제 표시 확인: 지도에 얹고 스크린샷, 이동 후 재요청 확인"""
import pathlib
from playwright.sync_api import sync_playwright
BASE = "https://localhost:3000"
OUT = pathlib.Path(__file__).parent / "out"; OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(ignore_https_errors=True, viewport={"width": 800, "height": 450}); pg = ctx.new_page()
    pg.route(f"{BASE}/__blank", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><html><head><meta charset=utf-8><link rel=stylesheet href=/node_modules/leaflet/dist/leaflet.css></head><body style='margin:0'></body></html>"))
    pg.goto(f"{BASE}/__blank")
    r = pg.evaluate("""async () => (await import('/tests/vector/harness.ts')).overlayDemo()""")
    print(r); pg.wait_for_timeout(800)
    pg.screenshot(path=str(OUT / "overlay-pan.png")); b.close()
