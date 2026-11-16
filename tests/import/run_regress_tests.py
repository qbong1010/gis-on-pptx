"""
가져오기 회귀 테스트 (독립 리뷰에서 재현된 버그들) — 헤드리스 Chromium + dev 서버 https://localhost:3000
  python tests/import/run_regress_tests.py
DXF 픽스처는 ezdxf 로 생성한다 (pip install ezdxf). 없으면 DXF 항목은 건너뛴다.
"""
import asyncio
import base64
import json
import math
import os
import struct
import sys

from playwright.async_api import async_playwright

try:
    import ezdxf
except ImportError:
    ezdxf = None

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = os.path.join(HERE, "_tmp")
os.makedirs(TMP, exist_ok=True)
b64 = lambda b: base64.b64encode(b).decode()


# ---------------------------------------------------------------- DXF 픽스처
def make_dxf():
    out = {}
    if not ezdxf:
        return out

    def save(d, name):
        p = os.path.join(TMP, name)
        d.saveas(p)
        out[name] = b64(open(p, "rb").read())

    # a: UTF-8(R2010) + $DWGCODEPAGE=ANSI_949
    d = ezdxf.new("R2010")
    d.header["$DWGCODEPAGE"] = "ANSI_949"
    d.layers.add("도로경계")
    d.modelspace().add_text("한글주기", dxfattribs={"layer": "도로경계", "insert": (200000, 550000), "height": 2})
    save(d, "a_utf8_cp949hdr.dxf")

    # b: -Z 압출 CIRCLE / ARC / ELLIPSE / TEXT
    d = ezdxf.new("R2010")
    m = d.modelspace()
    m.add_circle((-100, 50), 10, dxfattribs={"extrusion": (0, 0, -1)})
    m.add_arc((-100, 50), 10, 0, 90, dxfattribs={"extrusion": (0, 0, -1)})
    m.add_ellipse((0, 0), major_axis=(10, 0), ratio=0.5, start_param=0, end_param=math.pi / 2, dxfattribs={"extrusion": (0, 0, -1)})
    m.add_text("T", dxfattribs={"insert": (-30, 7), "height": 1, "extrusion": (0, 0, -1)})
    save(d, "b_extrusion.dxf")

    # c: HATCH — 시계 방향 호(시작각≠0), 스플라인(97), 여러 외곽 + 구멍
    d = ezdxf.new("R2010")
    m = d.modelspace()
    r = 10
    pt = lambda a: (r * math.cos(math.radians(a)), r * math.sin(math.radians(a)))
    h = m.add_hatch()
    ep = h.paths.add_edge_path()
    ep.add_arc((0, 0), r, 30, 120, ccw=False)
    ep.add_line(pt(120), pt(30))
    h = m.add_hatch()
    ep = h.paths.add_edge_path()
    ep.add_spline(control_points=[(0, 0), (5, 10), (10, 0)], fit_points=[(0, 0), (5, 5), (10, 0)], degree=2, knot_values=[0, 0, 0, 1, 1, 1])
    ep.add_line((10, 0), (10, -10))
    ep.add_line((10, -10), (0, -10))
    ep.add_line((0, -10), (0, 0))
    h = m.add_hatch()
    h.paths.add_polyline_path([(0, 0), (10, 0), (10, 10), (0, 10)], is_closed=True, flags=1)
    h.paths.add_polyline_path([(100, 0), (110, 0), (110, 10), (100, 10)], is_closed=True, flags=1)
    h.paths.add_polyline_path([(2, 2), (4, 2), (4, 4), (2, 4)], is_closed=True, flags=16)  # 첫 번째 외곽의 구멍 (마지막 외곽이 아님)
    save(d, "c_hatch.dxf")

    # d: 꺼진/동결 레이어, 레이어명 U+ 이스케이프, MTEXT 방향 벡터
    d = ezdxf.new("R2010")
    off = d.layers.add("OFF")
    off.off()
    fz = d.layers.add("FROZEN")
    fz.freeze()
    d.layers.add("ON")
    m = d.modelspace()
    for ly in ("OFF", "FROZEN", "ON"):
        m.add_line((0, 0), (1, 1), dxfattribs={"layer": ly})
    mt = m.add_mtext("방향", dxfattribs={"insert": (5, 5), "layer": "ON"})
    mt.dxf.text_direction = (0, 1, 0)
    save(d, "d_layers.dxf")

    # e: 로컬 좌표(원점 근처) — 4326 으로 추정되면 안 됨
    d = ezdxf.new("R2010")
    m = d.modelspace()
    m.add_line((0, 0), (50, 50))
    m.add_line((10, 10), (90, 20))
    save(d, "e_local.dxf")
    # f: 한국 경위도 범위 DXF — 4326 추정 허용
    d = ezdxf.new("R2010")
    d.modelspace().add_line((127.0, 37.5), (127.01, 37.51))
    save(d, "f_lonlat.dxf")
    return out


# ---------------------------------------------------------------- DBF / SHP 픽스처
def dbf(width, value, nrec=1, name=b"NAME"):
    fd = name.ljust(11, b"\0") + b"C" + b"\0" * 4 + bytes([width, 0]) + b"\0" * 14
    hlen = 32 + 32 + 1
    hdr = struct.pack("<BBBBIHH20x", 3, 126, 1, 1, nrec, hlen, 1 + width)
    rec = b" " + value[:width].ljust(width, b" ")
    return hdr + fd + b"\r" + rec * nrec + b"\x1a"


def shp_point(n=1):
    recs = b""
    for i in range(n):
        recs += struct.pack(">ii", i + 1, 10) + struct.pack("<idd", 1, 127.0, 37.5)
    flen = (100 + len(recs)) // 2
    hdr = struct.pack(">i5ii", 9994, 0, 0, 0, 0, 0, flen) + struct.pack("<ii8d", 1000, 1, 127, 37.5, 127, 37.5, 0, 0, 0, 0)
    return hdr + recs


ko = "서울특별시 강남구".encode("utf-8")
ko949 = "서울특별시 강남구".encode("euc-kr")
dbfs = {
    "wide254_utf8": (dbf(254, ko), shp_point()),
    "narrow_utf8": (dbf(40, ko), shp_point()),
    "trunc_utf8": (dbf(10, "가나다라".encode("utf-8")), shp_point()),  # 12바이트가 10으로 잘림
    "cp949": (dbf(40, ko949), shp_point()),
    "trunc_cp949": (dbf(7, ko949), shp_point()),  # 16바이트가 7로 잘림(홀수)
    "hangul_fieldname": (dbf(40, ko, name="이름".encode("utf-8")), shp_point()),
    "ascii": (dbf(20, b"seoul"), shp_point()),
}
# 512KB 경계가 한글 중간에 걸리는 큰 DBF (UTF-8, 1글자=3바이트)
big_val = ("가" * 10).encode("utf-8")
dbfs["big_utf8"] = (dbf(30, big_val, nrec=30000), shp_point(30000))
dbfs = {k: [b64(x) for x in v] for k, v in dbfs.items()}
# 깨진 .shp 그룹 하나 + 정상 그룹 하나
good = (dbf(40, ko), shp_point())
broken_shp = b"this is not a shapefile at all"  # 해석 불가 .shp

# ---------------------------------------------------------------- 좌표계 WKT
GEO = 'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]'
gcs = lambda n, d, sph, a, rf: f'GEOGCS["{n}",DATUM["{d}",SPHEROID["{sph}",{a},{rf}]],{GEO}]'
WGS = gcs("GCS_WGS_1984", "D_WGS_1984", "WGS_1984", 6378137.0, 298.257223563)
K2000 = gcs("GCS_Korea_2000", "D_Korea_2000", "GRS_1980", 6378137.0, 298.257222101)
proj = lambda n, pj, g, ps: f'PROJCS["{n}",{g},PROJECTION["{pj}"],' + ",".join(f'PARAMETER["{k}",{v}]' for k, v in ps) + ',UNIT["Meter",1.0]]'
TM = [("False_Easting", 200000.0), ("False_Northing", 600000.0), ("Central_Meridian", 127.0), ("Scale_Factor", 1.0), ("Latitude_Of_Origin", 38.0)]
PRJ = {
    "tm_k2000": (proj("c", "Transverse_Mercator", K2000, TM), "EPSG:5186"),
    "lcc_same_params": (proj("c", "Lambert_Conformal_Conic", K2000, [("False_Easting", 200000.0), ("False_Northing", 600000.0), ("Central_Meridian", 127.0), ("Standard_Parallel_1", 30), ("Standard_Parallel_2", 60), ("Latitude_Of_Origin", 38.0)]), "raw"),
    "world_mercator": (proj("WM", "Mercator", WGS, [("False_Easting", 0.0), ("False_Northing", 0.0), ("Central_Meridian", 0.0), ("Standard_Parallel_1", 0.0)]), "raw"),
    "mollweide": (proj("M", "Mollweide", WGS, [("False_Easting", 0.0), ("False_Northing", 0.0), ("Central_Meridian", 0.0)]), "raw"),
    "web_mercator_aux": ('PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",' + WGS + ',PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]', "EPSG:3857"),
    "gcs_wgs84": (WGS, "EPSG:4326"),
    "gcs_tokyo": (gcs("GCS_Tokyo", "D_Tokyo", "Bessel_1841", 6377397.155, 299.1528128), "raw"),
    "gcs_korean1985": (gcs("GCS_Korean_Datum_1985", "D_Korean_Datum_1985", "Bessel_1841", 6377397.155, 299.1528128), "EPSG:4162"),
    "gcs_k2000": (K2000, "EPSG:4737"),
    "utm52": (proj("u", "Transverse_Mercator", WGS, [("False_Easting", 500000.0), ("False_Northing", 0.0), ("Central_Meridian", 129.0), ("Scale_Factor", 0.9996), ("Latitude_Of_Origin", 0.0)]), "EPSG:32652"),
}

JS = r"""
async (A) => {
  const b = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const R = {};
  const dxf = await import('/src/lib/dxf.ts');
  const rd = (n) => dxf.readDxf(b(A.dxf[n]), n);
  const rnd = (v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
  const coords = (f) => JSON.parse(JSON.stringify(f.geometry.coordinates, (k, v) => rnd(v)));
  R.dxf = {};
  if (A.dxf['a_utf8_cp949hdr.dxf']) {
    const a = rd('a_utf8_cp949hdr.dxf');
    R.dxf.utf8_cp949hdr = { enc: a.encoding, layer: a.fc.features[0].properties.layer, text: a.fc.features[0].properties.text };
    const e = rd('b_extrusion.dxf').fc.features;
    const bb = (f) => { const c = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates; const xs = c.map(p => p[0]), ys = c.map(p => p[1]); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(rnd); };
    R.dxf.extrusion = { circle: bb(e[0]), arc: bb(e[1]), arcStart: coords({geometry:{coordinates:e[1].geometry.coordinates[0]}}), ellipseBB: bb(e[2]), ellipseMid: coords({geometry:{coordinates: e[2].geometry.coordinates[Math.floor(e[2].geometry.coordinates.length/2)]}}), text: e[3].geometry.coordinates.map(rnd), textRot: e[3].properties.rotation };
    const h = rd('c_hatch.dxf').fc.features;
    const bbp = (f) => bb({ geometry: { type: 'Polygon', coordinates: f.geometry.coordinates } });
    R.dxf.hatch = { cw: bbp(h[0]), splineN: h.length > 1 ? h[1].geometry.coordinates[0].length : 0, splineBB: bbp(h[1]), multi: h[2].geometry.type, rings: h[2].geometry.coordinates.map(p => p.length) };
    const l = rd('d_layers.dxf');
    R.dxf.layers = { n: l.fc.features.length, layers: l.fc.features.map(f => f.properties.layer), warn: l.warnings, mtextRot: l.fc.features.find(f => f.properties.type === 'MTEXT')?.properties.rotation };
    const txt = new TextDecoder().decode(b(A.dxf['d_layers.dxf'])).replace(/\r?\n(ON)\r?\n/g, '\n\\U+D55C\\U+AE00\n');
    const lu = dxf.readDxf(new TextEncoder().encode(txt), 'u');
    R.dxf.layerEscape = { layers: [...new Set(lu.fc.features.map(f => f.properties.layer))], n: lu.fc.features.length };
    const core = await import('/src/lib/importCore.ts');
    const imp = async (n) => { const r = await core.importFilesCore([new File([b(A.dxf[n])], n)], null, {}); return { layers: r.layers.length, errors: r.errors.length, label: r.layers[0]?.crsLabel }; };
    R.dxf.localCoords = await imp('e_local.dxf');
    R.dxf.lonlat = await imp('f_lonlat.dxf');
  }
  // 문자열 디코드 단위 (헤더 변수 판독)
  const enc = (s, ver, cp) => dxf.decodeDxf(new TextEncoder().encode(`0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\n${ver}\n9\n$DWGCODEPAGE\n3\n${cp}\n0\nENDSEC\n0\nSECTION\n2\nX\n1\n${s}\n0\nENDSEC\n0\nEOF\n`)).encoding;
  R.dxf.decode = { utf8_new: enc('한글', 'AC1027', 'ANSI_949'), cp949_old_ascii: enc('abc', 'AC1015', 'ANSI_949') };

  // SHP/DBF 인코딩
  const shp = await import('/src/lib/shapefile.ts');
  R.shp = {};
  for (const [k, [d, s]] of Object.entries(A.dbfs)) {
    const r = await shp.readShapefileParts([new File([b(d)], 'a.dbf'), new File([b(s)], 'a.shp')]);
    R.shp[k] = { enc: r.layers[0]?.encoding, name: JSON.stringify(Object.values(r.layers[0]?.fc.features[0]?.properties ?? {})[0]), errors: r.errors };
  }
  const r2 = await shp.readShapefileParts([
    new File([b(A.good[0])], 'good.dbf'), new File([b(A.good[1])], 'good.shp'),
    new File([b(A.good[0])], 'bad.dbf'), new File([b(A.broken)], 'bad.shp'),
    new File([b(A.good[0])], 'stray.dbf')]);
  R.shp.partial = { layers: r2.layers.map(l => l.name), errors: r2.errors };

  // CRS
  const crs = await import('/src/lib/crs.ts');
  R.prj = {};
  for (const [k, [w]] of Object.entries(A.prj)) { const m = crs.matchPrj(w); R.prj[k] = m.kind === 'registry' ? m.crs.code : m.kind; }

  // simplify 병리 케이스
  const sm = await import('/src/lib/simplify.ts');
  const sq = (N) => { const fs = []; for (let i = 0; i < N; i++) { const x = 127 + (i % 300) * 2e-4, y = 37 + Math.floor(i / 300) * 2e-4, d = 1e-4;
    fs.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] } }); } return { type: 'FeatureCollection', features: fs }; };
  R.simplify = {};
  for (const N of [2000, 200000]) { const fcN = sq(N); const t0 = performance.now(); const r = sm.simplifyForBudget(fcN, N * 3); R.simplify[N] = { ms: Math.round(performance.now() - t0), before: r.originalVertexCount, after: r.vertexCount }; }

  // 워커 오류 경로: 처리할 수 없는 응답 → reject (대기 안 함)
  const imp = await import('/src/lib/importers.ts');
  const t0 = performance.now();
  const rr = await Promise.race([
    imp.importFiles([new File(['not json'], 'bad.geojson')], null).then(r => ({ errors: r.errors.length }), e => ({ rejected: String(e.message) })),
    new Promise(res => setTimeout(() => res('HANG'), 15000))]);
  R.worker = { result: rr, ms: Math.round(performance.now() - t0) };
  return R;
}
"""


def check(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (("  " + str(detail)) if detail != "" else ""))
    return ok


async def main():
    A = {"dxf": make_dxf(), "dbfs": dbfs, "good": [b64(good[0]), b64(good[1])], "broken": b64(broken_shp), "prj": {k: [v[0]] for k, v in PRJ.items()}}
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx = await b.new_context(ignore_https_errors=True)
        page = await ctx.new_page()
        await page.goto("https://localhost:3000/src/lib/importTypes.ts")
        R = await page.evaluate(JS, A)
        await b.close()
    print(json.dumps(R, ensure_ascii=False, indent=1))
    ok = True
    d = R["dxf"]
    if "utf8_cp949hdr" in d:
        ok &= check("#1 UTF-8 DXF + ANSI_949 헤더", d["utf8_cp949hdr"] == {"enc": "utf-8", "layer": "도로경계", "text": "한글주기"}, d["utf8_cp949hdr"])
        e = d["extrusion"]
        ok &= check("#3 CIRCLE -Z 중심 (100,50)", e["circle"] == [90, 110, 40, 60], e["circle"])
        ok &= check("#3 ARC -Z 시작점 (90,50)", e["arcStart"] == [90, 50], e["arcStart"])
        ok &= check("#3 ELLIPSE -Z 4사분면(y<=0)", e["ellipseBB"][3] <= 0.001 and e["ellipseBB"][2] < -4.9, e["ellipseBB"])
        ok &= check("#3 TEXT -Z x 반전", e["text"] == [30, 7], e["text"])
        h = d["hatch"]
        ok &= check("#6 HATCH 시계 방향 호 (30~120도)", abs(h["cw"][0] + 5) < 0.01 and abs(h["cw"][1] - 8.66) < 0.01 and abs(h["cw"][2] - 5) < 0.01, h["cw"])
        ok &= check("#7 HATCH 스플라인 뒤 엣지 유지", h["splineBB"] == [0, 10, -10, 5], h["splineBB"])
        ok &= check("#8 HATCH 구멍은 포함하는 외곽에 (폴리곤별 링 수 [2,1])", h["multi"] == "MultiPolygon" and h["rings"] == [2, 1], h["rings"])
        ok &= check("#22 꺼진/동결 레이어 제외", d["layers"]["layers"].count("OFF") == 0 and d["layers"]["layers"].count("FROZEN") == 0 and d["layers"]["n"] == 2, d["layers"])
        ok &= check("#22 레이어명 U+XXXX 이스케이프 해제", d["layerEscape"]["layers"] == ["한글"] and d["layerEscape"]["n"] == 2, d["layerEscape"])
        ok &= check("#22 MTEXT 방향 벡터 → 90도", d["layers"]["mtextRot"] == 90, d["layers"]["mtextRot"])
        ok &= check("#16 로컬 좌표 DXF 는 4326 추정 안 함", d["localCoords"]["layers"] == 0 and d["localCoords"]["errors"] == 1, d["localCoords"])
        ok &= check("#16 한국 경위도 DXF 는 4326 추정", d["lonlat"]["layers"] == 1 and "4326" in (d["lonlat"]["label"] or ""), d["lonlat"])
    ok &= check("#1 $ACADVER≥AC1021 → utf-8", d["decode"]["utf8_new"] == "utf-8", d["decode"])
    s = R["shp"]
    for k in ["wide254_utf8", "narrow_utf8", "trunc_utf8", "hangul_fieldname", "big_utf8"]:
        ok &= check(f"#2 DBF {k} → utf-8", s[k]["enc"] == "utf-8", s[k])
    for k in ["cp949", "trunc_cp949"]:
        ok &= check(f"#2 DBF {k} → euc-kr", s[k]["enc"] == "euc-kr", s[k])
    ok &= check("#14 깨진 그룹이 있어도 정상 레이어 유지", s["partial"]["layers"] == ["good"] and len(s["partial"]["errors"]) >= 1, s["partial"])
    for k, (_, want) in PRJ.items():
        ok &= check(f"#9 matchPrj {k} → {want}", R["prj"][k] == want, R["prj"][k])
    for n, v in R["simplify"].items():
        ok &= check(f"#11 simplify 최소 구조 {n}개 ({v['ms']}ms)", v["ms"] < 3000 and v["after"] == v["before"], v)
    ok &= check("워커 오류 경로 hang 없음", R["worker"]["result"] != "HANG", R["worker"])
    print("\n전체 통과" if ok else "\n실패 있음")
    sys.exit(0 if ok else 1)


asyncio.run(main())
