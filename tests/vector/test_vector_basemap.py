"""벡터 배경지도 렌더 테스트 (dev 서버 https://localhost:3000 필요: npx vite)
실행: python tests/vector/test_vector_basemap.py  -> tests/vector/out/*.svg, *.png
"""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

BASE = "https://localhost:3000"
OUT = pathlib.Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

CASES = [
    ("z16", dict(lat=37.4979, lng=127.0276, zoom=16, tileScale=1)),
    ("z13", dict(lat=37.4979, lng=127.0276, zoom=13, tileScale=1)),
    ("z15", dict(lat=37.4979, lng=127.0276, zoom=15, tileScale=1)),
    ("z16-scale07", dict(lat=37.4979, lng=127.0276, zoom=16.5, tileScale=0.7)),
]
STYLES = ["plan-gray", "mono-line", "color"]

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(ignore_https_errors=True, viewport={"width": 800, "height": 450})
    page = ctx.new_page()
    page.on("console", lambda m: print("[console]", m.text[:200]) if m.type in ("error", "warning") else None)
    page.route(f"{BASE}/__blank", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><html><head><meta charset=utf-8><link rel=stylesheet href=/node_modules/leaflet/dist/leaflet.css></head><body style='margin:0'></body></html>"))
    page.goto(f"{BASE}/__blank")
    summary = {}
    for name, cfg in CASES:
        res = page.evaluate("""async (cfg) => { const m = await import('/tests/vector/harness.ts'); return await m.run(cfg); }""", {**cfg, "styles": STYLES})
        styles = res.pop("styles")
        summary[name] = {**res, "styles": {k: {kk: vv for kk, vv in v.items() if kk not in ("svg", "labels")} | {"labelCount": len(v["labels"])} for k, v in styles.items()}}
        for sid, v in styles.items():
            f = OUT / f"{name}-{sid}.svg"
            f.write_text(v["svg"], encoding="utf-8")
            pg = ctx.new_page()
            pg.set_content(f"<html><body style='margin:0'>{v['svg']}</body></html>")
            pg.screenshot(path=str(OUT / f"{name}-{sid}.png"), clip={"x": 0, "y": 0, "width": 800, "height": 450})
            pg.close()
        (OUT / f"{name}-labels.json").write_text(json.dumps(styles["plan-gray"]["labels"], ensure_ascii=False, indent=0), encoding="utf-8")
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    b.close()
