"""dedupeLabels 가 타일 캐시를 변형하지 않는지: 같은 범위를 다시 가져와도 라벨이 같아야 하고, 이웃 범위를 사이에 가져와도 같아야 한다"""
from playwright.sync_api import sync_playwright
BASE = "https://localhost:3000"
JS = """async () => {
  const m = await import('/src/lib/vectorBasemap.ts');
  const B = { west: 127.015, east: 127.04, south: 37.49, north: 37.505 };
  const a = await m.fetchVectorBasemap(B, 15);
  const sa = JSON.stringify(a.labels);
  await m.fetchVectorBasemap({ ...B, west: 127.03, east: 127.06 }, 15); // 겹치는 이웃 범위
  const b = await m.fetchVectorBasemap(B, 15);
  // 빈 타일(바다) 캐시 + 범위 밖
  const sea = await m.fetchVectorBasemap({ west: 125.0, east: 125.1, south: 34.0, north: 34.1 }, 14);
  return { same: sa === JSON.stringify(b.labels), n: a.labels.length, seaTiles: sea.tileCount, seaFeat: Object.keys(sea.groups).length };
}"""
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(ignore_https_errors=True); pg = ctx.new_page()
    pg.route(f"{BASE}/__blank", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><html><body></body></html>"))
    pg.goto(f"{BASE}/__blank")
    print(pg.evaluate(JS)); b.close()
