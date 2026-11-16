"""타일 줌 안정성(패닝해도 같은 줌에서 z 가 흔들리지 않음) + 경도 래핑/범위 밖"""
from playwright.sync_api import sync_playwright
BASE = "https://localhost:3000"
JS = """async () => {
  const m = await import('/src/lib/vectorBasemap.ts');
  const out = {};
  for (const [name, zEq, wDeg] of [['z13.0', 13.0, 1200/256/2**13*360], ['z13.6', 13.6, 1200/256/2**13.6*360], ['z14.9', 14.9, 1200/256/2**14.9*360]]) {
    const hDeg = wDeg * 675/1200; const zs = new Set(); let minC = 99, maxC = 0;
    for (let i = 0; i < 400; i++) {
      const west = 127.0 + i * wDeg / 97, south = 37.4 + i * hDeg / 61;
      const r = m.tileRangeFor({ west, east: west + wDeg, south, north: south + hDeg }, zEq);
      zs.add(r.z); minC = Math.min(minC, r.count); maxC = Math.max(maxC, r.count);
    }
    out[name] = { zooms: [...zs], count: [minC, maxC] };
  }
  out.wrapEast = m.tileRangeFor({ west: 179.9, east: 180.2, south: 37, north: 37.1 }, 10);
  out.wrapWest = m.tileRangeFor({ west: -180.2, east: -179.9, south: 37, north: 37.1 }, 10);
  out.outside = m.tileRangeFor({ west: 200, east: 200.1, south: 37, north: 37.1 }, 10);
  return out;
}"""
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(ignore_https_errors=True); pg = ctx.new_page()
    pg.route(f"{BASE}/__blank", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><html><body></body></html>"))
    pg.goto(f"{BASE}/__blank")
    import json; print(json.dumps(pg.evaluate(JS), indent=1)); b.close()
