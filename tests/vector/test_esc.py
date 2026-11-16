from playwright.sync_api import sync_playwright
BASE = "https://localhost:3000"
JS = r"""async () => {
  const m = await import('/src/lib/vectorBasemap.ts');
  const data = { groups: {}, labels: [{ text: 'A\u0001B\uD800C\uDC00D\u{1F600}&<', lon: 127.0276, lat: 37.4979, kind: 'place', rank: 1, cls: 'city' }], tileZoom: 14, attribution: '', bounds: { west: 127.02, east: 127.035, south: 37.49, north: 37.505 }, tileCount: 0, failedTiles: 0 };
  const proj = (lng, lat) => ({ x: (lng - 127.02) / 0.015 * 800, y: (37.505 - lat) / 0.015 * 450 });
  const svg = m.vectorBasemapToSvg(data, proj, { width: 800, height: 450 }, 'plan-gray', {});
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return { err: !!doc.querySelector('parsererror'), text: [...doc.querySelectorAll('text')].map(t => t.textContent)[0] };
}"""
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(ignore_https_errors=True); pg = ctx.new_page()
    pg.route(f"{BASE}/__blank", lambda r: r.fulfill(status=200, content_type="text/html", body="<html><body></body></html>"))
    pg.goto(f"{BASE}/__blank"); print(ascii(pg.evaluate(JS))); b.close()
