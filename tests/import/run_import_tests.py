"""
가져오기 파이프라인 검증 (헤드리스 Chromium + Python Playwright, dev 서버 https://localhost:3000)
  python tests/import/make_fixtures.py     # 픽스처 먼저 (1회)
  python tests/import/run_import_tests.py
GDAL(QGIS 3.34.10) 이 같은 파일을 읽어 EPSG:4326 으로 변환한 결과와 좌표를 비교해 최대 오차(m)를 낸다.
"""
import base64
import json
import math
import os
import subprocess
import sys
import time
import urllib.request
import ssl

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
Q = r"C:\Program Files\QGIS 3.34.10"
ENV = dict(os.environ)
ENV["PATH"] = Q + r"\bin;" + ENV["PATH"]
ENV["GDAL_DATA"] = Q + r"\apps\gdal\share\gdal"
ENV["PROJ_LIB"] = Q + r"\share\proj"
OGR = Q + r"\bin\ogr2ogr.exe"
GPKG = os.path.join(ROOT, "samples", "gpkg-test")
DXF = os.path.join(ROOT, "samples", "dxf-test")
SHP = os.path.join(ROOT, "samples", "shp-test")
TMP = os.path.join(ROOT, "tests", "import", "_tmp")
os.makedirs(TMP, exist_ok=True)
URL = "https://localhost:3000"
R = 6378137.0


def server_up():
    try:
        ctx = ssl._create_unverified_context()
        urllib.request.urlopen(URL + "/", context=ctx, timeout=3)
        return True
    except Exception:
        return False


def gdal_geojson(src, layer=None, s_srs=None):
    out = os.path.join(TMP, "exp_%s.json" % abs(hash((src, layer))))
    if os.path.exists(out):
        os.remove(out)
    args = [OGR, "-f", "GeoJSON", out, src]
    if layer:
        args.append(layer)
    if s_srs:
        args += ["-s_srs", s_srs]
    args += ["-t_srs", "EPSG:4326", "-lco", "COORDINATE_PRECISION=10"]
    r = subprocess.run(args, env=ENV, capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr.decode("utf8", "replace"))
    return json.load(open(out, encoding="utf8"))


def flat(g):
    if g is None:
        return []
    t = g["type"]
    if t == "GeometryCollection":
        return [p for x in g["geometries"] for p in flat(x)]
    c = g["coordinates"]
    if t == "Point":
        return [c]
    if t in ("MultiPoint", "LineString"):
        return c
    if t in ("MultiLineString", "Polygon"):
        return [p for r in c for p in r]
    return [p for poly in c for r in poly for p in r]


def dist_m(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    dx = math.radians(a[0] - b[0]) * R * math.cos(lat)
    dy = math.radians(a[1] - b[1]) * R
    return math.hypot(dx, dy)


def compare_ordered(mine, exp):
    """피처 순서·꼭짓점 순서가 같다고 보고 최대 거리(m)"""
    if len(mine["features"]) != len(exp["features"]):
        return None, "피처 수 %d != %d" % (len(mine["features"]), len(exp["features"]))
    worst = 0.0
    for fm, fe in zip(mine["features"], exp["features"]):
        a, b = flat(fm["geometry"]), flat(fe["geometry"])
        if len(a) != len(b):
            return None, "꼭짓점 수 %d != %d" % (len(a), len(b))
        for p, q in zip(a, b):
            worst = max(worst, dist_m(p, q))
    return worst, ""


def compare_sets(mine, exp):
    """DXF: 순서/시작점이 달라질 수 있어 '내 꼭짓점 → GDAL 같은 피처 꼭짓점' 최근접 거리의 최대값"""
    worst = 0.0
    unmatched = 0
    pool = [flat(f["geometry"]) for f in exp["features"]]
    for fm in mine["features"]:
        a = flat(fm["geometry"])
        best = None
        for b in pool:
            if not b:
                continue
            d = max(min(dist_m(p, q) for q in b) for p in a)
            if best is None or d < best:
                best = d
        if best is None:
            unmatched += 1
        else:
            worst = max(worst, best)
    return worst, unmatched


def g(code, val):
    return "%3d\n%s\n" % (code, val)


def pt(x, y, base=10):
    return g(base, repr(x)) + g(base + 10, repr(y)) + g(base + 20, "0.0")


def build_handmade(path):
    """엔티티별 해석을 수식으로 검증하기 위한 수제 DXF (경위도 좌표라 좌표계 추정 경로도 같이 검증)"""
    X0, Y0 = 127.0, 37.0
    e = ""
    # 1) 닫힌 LWPOLYLINE(사각형) -> Polygon
    e += g(0, "LWPOLYLINE") + g(8, "경계") + g(90, 4) + g(70, 1)
    for x, y in ((0, 0), (0.002, 0), (0.002, 0.002), (0, 0.002)):
        e += g(10, repr(X0 + x)) + g(20, repr(Y0 + y))
    # 2) bulge=1 인 열린 LWPOLYLINE (반원, 지름 0.002)
    e += g(0, "LWPOLYLINE") + g(8, "호") + g(90, 2) + g(70, 0)
    e += g(10, repr(X0)) + g(20, repr(Y0 + 0.01)) + g(42, 1.0) + g(10, repr(X0 + 0.002)) + g(20, repr(Y0 + 0.01))
    # 3) CIRCLE r=0.001
    e += g(0, "CIRCLE") + g(8, "원") + pt(X0 + 0.01, Y0 + 0.01) + g(40, 0.001)
    # 4) ARC 0~90도 r=0.001
    e += g(0, "ARC") + g(8, "호") + pt(X0, Y0 + 0.02) + g(40, 0.001) + g(50, 0.0) + g(51, 90.0)
    # 5) ELLIPSE 장축 0.002, 단축비 0.5 (전체)
    e += g(0, "ELLIPSE") + g(8, "타원") + pt(X0 + 0.02, Y0 + 0.02) + pt(0.002, 0.0, 11) + g(40, 0.5) + g(41, 0.0) + g(42, 6.283185307179586)
    # 6) POINT
    e += g(0, "POINT") + g(8, "점") + pt(X0 + 0.03, Y0 + 0.03)
    # 7) TEXT(회전 30)
    e += g(0, "TEXT") + g(8, "글") + pt(X0 + 0.04, Y0 + 0.04) + g(40, 2.5) + g(1, "%%c12 TEXT") + g(50, 30.0)
    # 8) MTEXT (서식 코드)
    e += g(0, "MTEXT") + g(8, "글") + pt(X0 + 0.05, Y0 + 0.05) + g(40, 3.0) + g(1, "{\\fArial|b0;\\C1;Hello}\\Pworld \\U+D55C\\U+AE00") + g(50, 0.0)
    # 9) INSERT: 블록 B(LINE 0,0 -> 0.001,0) 를 scale 2, rot 90 으로 -> (X0+0.06,Y0+0.06) 에서 위쪽으로 0.002
    e += g(0, "INSERT") + g(8, "삽입") + g(2, "B") + pt(X0 + 0.06, Y0 + 0.06) + g(41, 2.0) + g(42, 2.0) + g(43, 1.0) + g(50, 90.0)
    # 10) 중첩 INSERT: 블록 C 안에 B 를 (0.001,0) 에 삽입, C 를 (X0+0.07, Y0+0.07) 에 삽입
    e += g(0, "INSERT") + g(8, "삽입") + g(2, "C") + pt(X0 + 0.07, Y0 + 0.07) + g(41, 1.0) + g(42, 1.0) + g(43, 1.0) + g(50, 0.0)
    # 11) SPLINE (fit points)
    e += g(0, "SPLINE") + g(8, "스플") + g(70, 8) + g(71, 3) + g(72, 0) + g(73, 0) + g(74, 3)
    for x, y in ((0, 0), (0.001, 0.002), (0.002, 0)):
        e += pt(X0 + 0.08 + x, Y0 + 0.08 + y, 11)

    blocks = ""
    blocks += g(0, "BLOCK") + g(8, "0") + g(2, "B") + g(70, 0) + pt(0.0, 0.0) + g(3, "B")
    blocks += g(0, "LINE") + g(8, "0") + pt(0.0, 0.0) + pt(0.001, 0.0, 11) + g(0, "ENDBLK") + g(8, "0")
    blocks += g(0, "BLOCK") + g(8, "0") + g(2, "C") + g(70, 0) + pt(0.0, 0.0) + g(3, "C")
    blocks += g(0, "INSERT") + g(8, "0") + g(2, "B") + pt(0.001, 0.0) + g(41, 1.0) + g(42, 1.0) + g(43, 1.0) + g(50, 0.0)
    blocks += g(0, "ENDBLK") + g(8, "0")

    out = g(0, "SECTION") + g(2, "HEADER") + g(9, "$ACADVER") + g(1, "AC1015") + g(0, "ENDSEC")
    out += g(0, "SECTION") + g(2, "BLOCKS") + blocks + g(0, "ENDSEC")
    out += g(0, "SECTION") + g(2, "ENTITIES") + e + g(0, "ENDSEC") + g(0, "EOF")
    open(path, "w", encoding="utf8", newline="").write(out)


def check_handmade(layer):
    feats = layer["data"]["features"]
    by = {}
    for f in feats:
        by.setdefault(f["properties"]["type"], []).append(f)
    X0, Y0 = 127.0, 37.0
    ok = True

    def rep(name, cond, detail=""):
        nonlocal ok
        ok = ok and cond
        print("  [%s] %s %s" % ("OK" if cond else "FAIL", name, detail))

    print("  types:", {k: len(v) for k, v in by.items()})
    sq = next(f for f in by["LWPOLYLINE"] if f["geometry"]["type"] == "Polygon")
    rep("닫힌 LWPOLYLINE -> Polygon(5점)", len(sq["geometry"]["coordinates"][0]) == 5)
    semi = next(f for f in by["LWPOLYLINE"] if f["geometry"]["type"] == "LineString")
    cs = semi["geometry"]["coordinates"]
    dev = max(abs(math.hypot(p[0] - (X0 + 0.001), p[1] - (Y0 + 0.01)) - 0.001) for p in cs)
    rep("bulge 반원", len(cs) >= 30 and dev < 2e-7, "점 %d, 반지름 편차 %.2e" % (len(cs), dev))
    circ = by["CIRCLE"][0]
    cc = circ["geometry"]["coordinates"][0]
    dev = max(abs(math.hypot(p[0] - (X0 + 0.01), p[1] - (Y0 + 0.01)) - 0.001) for p in cc)
    rep("CIRCLE -> Polygon 64분할", circ["geometry"]["type"] == "Polygon" and len(cc) == 65 and dev < 2e-7, "점 %d 편차 %.2e" % (len(cc), dev))
    arc = by["ARC"][0]["geometry"]["coordinates"]
    rep("ARC 0~90도 양 끝점", abs(arc[0][0] - (X0 + 0.001)) < 2e-7 and abs(arc[0][1] - (Y0 + 0.02)) < 2e-7 and abs(arc[-1][0] - X0) < 2e-7 and abs(arc[-1][1] - (Y0 + 0.021)) < 2e-7, "n=%d" % len(arc))
    el = by["ELLIPSE"][0]["geometry"]["coordinates"][0]
    ymax = max(p[1] for p in el) - (Y0 + 0.02)
    xmax = max(p[0] for p in el) - (X0 + 0.02)
    rep("ELLIPSE 장축/단축", abs(xmax - 0.002) < 2e-7 and abs(ymax - 0.001) < 2e-6, "x %.6f y %.6f" % (xmax, ymax))
    rep("POINT", by["POINT"][0]["geometry"]["coordinates"] == [X0 + 0.03, Y0 + 0.03])
    t = by["TEXT"][0]
    rep("TEXT 속성(%%c -> Ø)", t["properties"]["text"] == "Ø12 TEXT" and t["properties"]["height"] == 2.5 and t["properties"]["rotation"] == 30, str(t["properties"]))
    mt = by["MTEXT"][0]["properties"]
    rep("MTEXT 서식 코드 제거 + \\U+ 유니코드", mt["text"] == "Hello\nworld 한글", repr(mt["text"]))

    def near(a, b):
        return abs(a[0] - b[0]) < 2e-7 and abs(a[1] - b[1]) < 2e-7

    lines = by["LINE"]
    l1 = [f for f in lines if near(f["geometry"]["coordinates"][0], [X0 + 0.06, Y0 + 0.06])]
    rep("INSERT scale2 rot90", bool(l1) and near(l1[0]["geometry"]["coordinates"][1], [X0 + 0.06, Y0 + 0.062]), str(l1[0]["geometry"]["coordinates"] if l1 else ""))
    l2 = [f for f in lines if near(f["geometry"]["coordinates"][0], [X0 + 0.071, Y0 + 0.07])]
    rep("중첩 INSERT", bool(l2) and near(l2[0]["geometry"]["coordinates"][1], [X0 + 0.072, Y0 + 0.07]) and l2[0]["properties"].get("block") == "B")
    sp = by["SPLINE"][0]["geometry"]
    rep("SPLINE fit points -> LineString(3)", sp["type"] == "LineString" and len(sp["coordinates"]) == 3)
    layers = {f["properties"]["layer"] for f in feats}
    rep("layer 속성(한글)", layers >= {"경계", "원", "삽입"}, str(sorted(layers)))
    return ok


UNIT_GPKG = """
async () => {
  const mod = await import('/src/lib/gpkg.ts');
  const wkb = (bytes) => { const h = [0x47,0x50,0,1, 0xe6,0x10,0,0]; return new Uint8Array([...h, ...bytes]); };
  const f64 = (v) => Array.from(new Uint8Array(new Float64Array([v]).buffer));
  const u32 = (v) => Array.from(new Uint8Array(new Uint32Array([v]).buffer));
  const out = {};
  out.pointZ_iso = JSON.stringify(mod.parseGpkgGeometry(wkb([1, ...u32(1001), ...f64(10), ...f64(20), ...f64(99)])));
  out.pointM_iso = JSON.stringify(mod.parseGpkgGeometry(wkb([1, ...u32(2001), ...f64(10), ...f64(20), ...f64(7)])));
  out.pointZM_iso = JSON.stringify(mod.parseGpkgGeometry(wkb([1, ...u32(3001), ...f64(10), ...f64(20), ...f64(1), ...f64(2)])));
  out.pointZ_ewkb = JSON.stringify(mod.parseGpkgGeometry(wkb([1, ...u32(0x80000001), ...f64(1), ...f64(2), ...f64(3)])));
  out.lineZ_ewkb_srid = JSON.stringify(mod.parseGpkgGeometry(wkb([1, ...u32(0xa0000002), ...u32(4326), ...u32(2), ...f64(1), ...f64(2), ...f64(3), ...f64(4), ...f64(5), ...f64(6)])));
  const be32 = (v) => [(v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255];
  const bef64 = (v) => Array.from(new Uint8Array(new Float64Array([v]).buffer)).reverse();
  out.line_be = JSON.stringify(mod.parseGpkgGeometry(new Uint8Array([0x47,0x50,0,0, 0,0,0,0, 0, ...be32(2), ...be32(2), ...bef64(1), ...bef64(2), ...bef64(3), ...bef64(4)])));
  const env = new Array(32).fill(0);
  out.envelope = JSON.stringify(mod.parseGpkgGeometry(new Uint8Array([0x47,0x50,0,0b00000011, 0xe6,0x10,0,0, ...env, 1, ...u32(1), ...f64(5), ...f64(6)])));
  out.empty = JSON.stringify(mod.parseGpkgGeometry(new Uint8Array([0x47,0x50,0,0b00010001, 0xe6,0x10,0,0])));
  const ring = [...u32(4), ...f64(0),...f64(0), ...f64(1),...f64(0), ...f64(1),...f64(1), ...f64(0),...f64(0)];
  const poly = [1, ...u32(3), ...u32(1), ...ring];
  out.multipoly = JSON.stringify(mod.parseGpkgGeometry(wkb([1, ...u32(6), ...u32(2), ...poly, ...poly])));
  const pt = [1, ...u32(1), ...f64(1), ...f64(2)];
  out.gc = JSON.stringify(mod.parseGpkgGeometry(wkb([1, ...u32(7), ...u32(2), ...pt, 1, ...u32(4), ...u32(1), ...pt])));
  return out;
}
"""

BIG_TEST = """
async () => {
  const m = window.__imp;
  const out = {};
  const parts = ['{"type":"FeatureCollection","features":['];
  const N = 40000, V = 40;
  let n = 0;
  for (let c = 0; c < N / 1000; c++) {
    let s = '';
    for (let i = 0; i < 1000; i++, n++) {
      const x0 = 126.8 + (n % 300) * 0.001, y0 = 37.4 + Math.floor(n / 300) * 0.0007;
      const co = [];
      for (let k = 0; k < V; k++) co.push('[' + (x0 + k * 0.00001).toFixed(7) + ',' + (y0 + Math.sin(k) * 0.00002).toFixed(7) + ']');
      s += (n ? ',' : '') + '{"type":"Feature","properties":{"id":' + n + ',"name":"road-' + n + '","kind":"synthetic-long-attribute-padding-padding"},"geometry":{"type":"LineString","coordinates":[' + co.join(',') + ']}}';
    }
    parts.push(s);
  }
  parts.push(']}');
  const big = new File(parts, 'big.geojson');
  out.sizeMB = +(big.size / 1048576).toFixed(1);

  const runWith = async (label, f) => {
    let last = performance.now(), maxGap = 0, ticks = 0;
    const id = setInterval(() => { const t = performance.now(); maxGap = Math.max(maxGap, t - last); last = t; ticks++; }, 20);
    let longTasks = 0, longMax = 0;
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { longTasks++; longMax = Math.max(longMax, e.duration); } });
    try { po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
    const t0 = performance.now();
    const r = await f();
    const ms = performance.now() - t0;
    clearInterval(id);
    await new Promise(r => setTimeout(r, 100));
    po.disconnect();
    return { label, ms: Math.round(ms), maxHeartbeatGapMs: Math.round(maxGap), ticks, longTasks, longTaskMaxMs: Math.round(longMax), r };
  };
  const progress = [];
  const w = await runWith('worker', () => m.importFiles([big], null, { onProgress: (p) => progress.push(p.stage) }));
  out.worker = { label: w.label, ms: w.ms, maxHeartbeatGapMs: w.maxHeartbeatGapMs, ticks: w.ticks, longTasks: w.longTasks, longTaskMaxMs: w.longTaskMaxMs, layers: w.r.layers.map(l => ({ name: l.name, feat: l.featureCount, vtx: l.vertexCount, MB: +(l.bytes/1048576).toFixed(1), warning: l.warning })), errors: w.r.errors, warnings: w.r.warnings, progressStages: [...new Set(progress)] };

  const core = await import('/src/lib/importCore.ts');
  const mt = await runWith('main-thread', () => core.importFilesCore([big], null, {}));
  out.mainThread = { label: mt.label, ms: mt.ms, maxHeartbeatGapMs: mt.maxHeartbeatGapMs, ticks: mt.ticks, longTasks: mt.longTasks, longTaskMaxMs: mt.longTaskMaxMs };

  const layer = w.r.layers[0];
  const t1 = performance.now();
  const sp = m.simplifyForBudget(layer.data, 300000);
  out.simplify = { ms: Math.round(performance.now() - t1), from: layer.vertexCount, to: sp.vertexCount, simplified: sp.simplified, tolerance: sp.tolerance, features: sp.data.features.length, sameFeatureCount: sp.data.features.length === layer.data.features.length, minPts: Math.min(...sp.data.features.map(f => f.geometry.coordinates.length)) };
  const sp2 = m.simplifyForBudget(layer.data, 10000000);
  out.simplifyNoop = { simplified: sp2.simplified, same: sp2.data === layer.data };
  const tri = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [Array.from({length: 2001}, (_, i) => { const a = i / 2000 * 2 * Math.PI; return [127 + 0.01 * Math.cos(a), 37 + 0.01 * Math.sin(a)]; })] } }] };
  const sp3 = m.simplifyForBudget(tri, 20);
  const ring3 = sp3.data.features[0].geometry.coordinates[0];
  out.simplifyPolygon = { from: 2001, to: sp3.vertexCount, ringLen: ring3.length, closed: JSON.stringify(ring3[0]) === JSON.stringify(ring3[ring3.length - 1]), tol: sp3.tolerance };

  const hard = new File([new Uint8Array(201 * 1048576)], 'huge.geojson');
  const hr = await m.importFiles([hard], null);
  out.hardCap = { errors: hr.errors, layers: hr.layers.length };
  const pad = new File(['{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[127,37]}}]}', ' '.repeat(31 * 1048576)], 'soft.geojson');
  const sr = await m.importFiles([pad], null);
  out.softWarn = { warnings: sr.warnings, layers: sr.layers.length, errors: sr.errors };
  const ac = new AbortController();
  const p = m.importFiles([big], null, { signal: ac.signal });
  setTimeout(() => ac.abort(), 50);
  try { await p; out.abort = 'resolved(?)'; } catch (e) { out.abort = e.name; }
  const bad = await m.importFiles([new File(['x'], 'a.dwg'), new File(['x'], 'b.txt')], null);
  out.unsupported = bad.errors;
  return out;
}
"""

HARNESS = """
async () => {
  const m = await import('/src/lib/importers.ts');
  window.__imp = m;
  window.__run = async (items, crs, opts) => {
    const files = items.map(it => {
      const bin = atob(it.b64); const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return new File([u], it.name);
    });
    const t0 = performance.now();
    const r = await m.importFiles(files, crs ?? null, opts ?? {});
    return { ms: performance.now() - t0, ...r };
  };
  return Object.keys(m);
}
"""


def b64(path):
    return {"name": os.path.basename(path), "b64": base64.b64encode(open(path, "rb").read()).decode()}


def main():
    if not server_up():
        print("dev 서버 기동: npx vite")
        subprocess.Popen("npx vite", cwd=ROOT, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            time.sleep(1)
            if server_up():
                break
        else:
            sys.exit("서버가 뜨지 않음")

    report = []
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=True)
        ctx = br.new_context(ignore_https_errors=True)
        page = ctx.new_page()
        page.on("console", lambda m: print("  [console]", m.type, m.text[:300]) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: print("  [pageerror]", str(e)[:300]))
        page.route(URL + "/__blank.html", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><html><body></body></html>"))
        page.goto(URL + "/__blank.html")
        print("exports:", page.evaluate(HARNESS))

        def run(paths, crs=None, opts=None):
            return page.evaluate("([items, crs, opts]) => window.__run(items, crs, opts)", [[b64(p) for p in paths], crs, opts])

        def as_fc(layer):
            return layer["data"]

        # ---------------- GPKG ----------------
        for fname in ("multi_5186.gpkg", "wgs84.gpkg"):
            path = os.path.join(GPKG, fname)
            res = run([path])
            print("\n== %s  (%.0f ms) errors=%s warnings=%s" % (fname, res["ms"], res["errors"], res["warnings"]))
            for layer in res["layers"]:
                exp = gdal_geojson(path, layer["name"])
                worst, why = compare_ordered(layer["data"], exp)
                print("  %-12s %-28s feat=%d vtx=%d bytes=%d  maxErr=%s %s" % (layer["name"], layer["crsLabel"], layer["featureCount"], layer["vertexCount"], layer["bytes"], "%.4f m" % worst if worst is not None else "N/A", why))
                report.append((fname, layer["name"], worst))
            # 속성 확인
        res = run([os.path.join(GPKG, "multi_5186.gpkg")])
        pts = next(l for l in res["layers"] if l["name"] == "지점")
        print("  지점 properties[0]:", pts["data"]["features"][0]["properties"])

        # crsOverride 존중: 도로 테이블을 5174 로 강제 → 결과가 달라야 함
        r1 = run([os.path.join(GPKG, "multi_5186.gpkg")], "EPSG:5174")
        print("  override 5174 라벨:", [l["crsLabel"] for l in r1["layers"]][:2])

        # ---------------- DXF ----------------
        for fname in ("drawing_5186.dxf", "drawing_5186_cp949.dxf"):
            path = os.path.join(DXF, fname)
            r0 = run([path])
            print("\n== %s 좌표계 미지정 → errors=%s" % (fname, [e[:90] for e in r0["errors"]]))
            res = run([path], "EPSG:5186")
            print("== %s override 5186 (%.0f ms) errors=%s warnings=%s" % (fname, res["ms"], res["errors"], res["warnings"]))
            for layer in res["layers"]:
                exp = gdal_geojson(path, None, "EPSG:5186")
                worst, unmatched = compare_sets(layer["data"], exp)
                types = {}
                for f in layer["data"]["features"]:
                    types[f["geometry"]["type"]] = types.get(f["geometry"]["type"], 0) + 1
                gtypes = {}
                for f in exp["features"]:
                    gtypes[f["geometry"]["type"]] = gtypes.get(f["geometry"]["type"], 0) + 1
                print("  mine:", types, " gdal:", gtypes, " enc=%s" % layer.get("encoding"))
                print("  Polygon 링 수:", [len(f["geometry"]["coordinates"]) for f in layer["data"]["features"] if f["geometry"]["type"] == "Polygon"], "(구멍 포함 면은 2)")
                print("  maxErr(nearest vertex)=%.4f m unmatched=%d" % (worst, unmatched))
                texts = [f["properties"] for f in layer["data"]["features"] if "text" in f["properties"]]
                print("  text props:", texts)
                print("  sample props:", layer["data"]["features"][0]["properties"])
                report.append((fname, "dxf", worst))

        # ---------------- 수제 DXF (수식 검증) ----------------
        hm = os.path.join(DXF, "handmade_lonlat.dxf")
        build_handmade(hm)
        res = run([hm])
        print("\n== handmade_lonlat.dxf errors=%s warnings=%s label=%s" % (res["errors"], res["warnings"], [l["crsLabel"] for l in res["layers"]]))
        if res["layers"]:
            print("  전체 통과" if check_handmade(res["layers"][0]) else "  일부 실패")
        res = run([hm], None, {"dxf": {"closedAsPolygon": False}})
        gt = sorted({f["geometry"]["type"] for f in res["layers"][0]["data"]["features"]})
        print("  closedAsPolygon=false -> 지오메트리 타입:", gt)

        print("\n== GPKG 지오메트리 파서 단위 테스트")
        for k, v in page.evaluate(UNIT_GPKG).items():
            print("  %-16s %s" % (k, v))

        print("\n== 대용량 / 용량 정책")
        print(json.dumps(page.evaluate(BIG_TEST), ensure_ascii=False, indent=1))

        br.close()
    return report


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf8")
    main()
