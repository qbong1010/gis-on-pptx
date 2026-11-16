# -*- coding: utf-8 -*-
"""Slide Map Bridge 통합 테스트 (헤드리스 QGIS + 실제 PowerPoint COM).
실행: tests/qgis/run_tests.cmd
테스트는 자기가 만든 프레젠테이션(tests/qgis/out/*.pptx)만 열고 닫는다. 이미 열려 있던 다른 프레젠테이션은 건드리지 않는다.
"""
import os
import shutil
import sys
import traceback

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "qgis-plugin"))
OUT = os.path.join(ROOT, "tests", "qgis", "out")
os.makedirs(OUT, exist_ok=True)
DECK = os.path.join(OUT, "test-deck.pptx")
SHP = os.path.join(ROOT, "samples", "shp-test", "계획구역_5186.shp")

from qgis.core import QgsApplication, QgsProject, QgsVectorLayer, QgsLayoutExporter, QgsLayoutItem
from qgis.PyQt.QtGui import QImage

app = QgsApplication([], False)
app.initQgis()

from slide_map_bridge import ppt_com, layout_builder as lb, workflow, layer_export, pptx_reader

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (("  | " + str(detail)) if detail != "" else ""))


def approx(a, b, tol=0.02):
    return abs(a - b) <= tol


def px(img, x, y, s=3):
    return QImage.pixelColor(img, int(x * s), int(y * s))


def deck_path(name):
    return os.path.join(OUT, name)


def probe(path):
    return ppt_com.run_op("probe", path=path)


def new_deck(name, **kw):
    path = deck_path(name)
    try:
        ppt_com.run_op("closetest", path=path)
    except Exception:
        pass
    if os.path.exists(path):
        os.remove(path)
    ppt_com.run_op("newtest", path=path, title="scratch " + name, **kw)
    return path


def qgis_parts(path):
    return [s for s in ppt_com.slide_info(path, 1)["shapes"] if s["part"] == "qgis"]


def img_equal(a, b, tol=2):
    A, B = QImage(a), QImage(b)
    if A.size() != B.size():
        return False
    for x in range(0, A.width(), 5):
        for y in range(0, A.height(), 5):
            ca, cb = QImage.pixelColor(A, x, y), QImage.pixelColor(B, x, y)
            if max(abs(ca.red() - cb.red()), abs(ca.green() - cb.green()), abs(ca.blue() - cb.blue()),
                   abs(ca.alpha() - cb.alpha())) > tol:
                return False
    return True


def test_h1_m3():
    """H1: 내보내기가 사용자 프레젠테이션을 바꾸지 않음 (그라데이션/그림 배경, 수정됨 상태). M3: 슬라이드 ID 폴백 금지."""
    pic = deck_path("bg-picture.png")
    im = QImage(400, 300, QImage.Format_RGB32)
    im.fill(0x3366CC)
    im.save(pic)
    for kind in ("gradient", "picture"):
        d = new_deck("scratch-%s.pptx" % kind, bg=kind, picture=pic)
        try:
            for dirty in (False, True):
                if dirty:
                    ppt_com.run_op("touch", path=d)
                before = probe(d)
                base = [s for s in ppt_com.slide_info(d, 1)["shapes"] if s["part"] == "basemap"][0]
                imgs = ppt_com.export_slide_images(d, 1, 960, 540, scale=1, out_dir=os.path.join(OUT, "h1-" + kind),
                                                   above_z=base["z"])
                after = probe(d)
                keys = ("bgType", "follow", "master", "visible", "saved", "shapeCount")
                diff = {k: (before[k], after[k]) for k in keys if before[k] != after[k]}
                tag = "%s%s" % (kind, " (수정됨)" if dirty else "")
                check("H1 %s: 내보낸 뒤 원본 배경/가시성/Saved 무변경" % tag, not diff, diff or (before["bgType"], before["saved"]))
                check("H1 %s: 배경 종류 그대로 (gradient=3, picture=6)" % tag,
                      after["bgType"] == (3 if kind == "gradient" else 6), after["bgType"])
                check("H1 %s: 임시 사본이 남지 않음 (열린 프레젠테이션 목록 동일)" % tag,
                      sorted(before["names"]) == sorted(after["names"]), (before["names"], after["names"]))
                check("H1 %s: Saved 상태 유지 (수정됨이면 False)" % tag, after["saved"] == (not dirty), after["saved"])
                if not dirty:
                    ov = QImage(imgs["overlay"])
                    check("H1 %s: 오버레이 배경이 투명" % kind,
                          QImage.pixelColor(ov, 20, 20).alpha() == 0 and QImage.pixelColor(ov, 940, 40).alpha() == 0,
                          QImage.pixelColor(ov, 20, 20).getRgb())
                    nm = QImage(imgs["nomap"])
                    c = QImage.pixelColor(nm, 20, 500)
                    check("H1 %s: nomap 은 원래 배경을 유지 (흰색 아님)" % kind, c.rgb() != 0xffffffff, c.getRgb())
            if kind == "gradient":
                n0 = len(probe(d)["names"])
                ppt_com.run_op("leakcopy", path=d)
                n1 = len(probe(d)["names"])
                ppt_com.export_slide_images(d, 1, 960, 540, scale=1, out_dir=os.path.join(OUT, "h1-" + kind))
                n2 = len(probe(d)["names"])
                check("H1 비정상 종료로 남은 사본은 다음 export 때 정리됨", n1 == n0 + 1 and n2 == n0, (n0, n1, n2))
            for what in ("info", "export"):
                outp = os.path.join(OUT, "m3.png")
                if os.path.exists(outp):
                    os.remove(outp)
                try:
                    if what == "info":
                        ppt_com.slide_info(d, 1, slide_id=999999)
                    else:
                        ppt_com.run_op("export", path=d, slide=1, slideId=999999, pxWidth=100, pxHeight=50, full=outp)
                    ok, msg = False, "오류 없음"
                except ppt_com.PptError as e:
                    ok, msg = ("찾을 수 없" in str(e)) and not os.path.exists(outp), str(e)
                check("M3 %s: 없는 슬라이드 ID -> 오류(인덱스 폴백 없음) [%s]" % (what, kind), ok, msg)
        finally:
            ppt_com.run_op("closetest", path=d)


def test_insert(layout):
    """H3 / L3 / L4 / L5: 삽입."""
    d = new_deck("scratch-insert.pptx")
    png = os.path.join(OUT, "map_only.png")
    try:
        ppt_com.insert_picture(d, 1, png, 10, 10, 50, 50, "L", map_id="m-test", qgis_id="id-1")
        before = qgis_parts(d)
        try:
            ppt_com.insert_picture(d, 1, os.path.join(OUT, "nonexistent.png"), 10, 10, 50, 50, "L",
                                   map_id="m-test", qgis_id="id-1")
            ok = False
        except ppt_com.PptError:
            ok = True
        after = qgis_parts(d)
        check("H3 실패한 삽입은 이전 qgis 파트를 보존", ok and len(before) == 1 and after == before, (before, after))
        r = ppt_com.insert_picture(d, 1, png, 10, 10, 60, 60, "renamed-layout", map_id="m-test", qgis_id="id-1")
        now = qgis_parts(d)
        check("L4 이름이 바뀌어도 같은 qgis_id 면 교체", r["removed"] == 1 and len(now) == 1 and now[0]["qgisId"] == "id-1", now)
        ppt_com.insert_picture(d, 1, png, 70, 10, 60, 60, "other", map_id="m-test", qgis_id="id-2")
        check("L4 다른 qgis_id 는 공존", len(qgis_parts(d)) == 2, len(qgis_parts(d)))
        ppt_com.insert_picture(d, 1, png, 10, 10, 60, 60, "legacy", map_id="m-test")
        r = ppt_com.insert_picture(d, 1, png, 10, 10, 60, 60, "legacy", map_id="m-test")
        check("L4 id 없는 호출은 layout 이름으로 교체(구버전 호환)", r["removed"] == 1, r["removed"])
        res = ppt_com.insert_picture(d, 1, png, 10, 10, 60, 60, "s", map_id="m-test", qgis_id="id-1", save=True)
        check("L3 저장된 파일은 저장됨", res["saved"] is True, res)
    finally:
        ppt_com.run_op("closetest", path=d)

    # 조판 경유 (qgis_id 가 조판 속성으로 유지되고 임시 PNG 가 지워짐)
    d = new_deck("scratch-send.pptx")
    try:
        link = lb.get_link(layout)
        saved_link = {k: layout.customProperty("slidemap/" + k) for k in ("pptx", "slide_index", "slide_id", "map_id")}
        layout.setCustomProperty("slidemap/pptx", d)
        layout.setCustomProperty("slidemap/slide_id", "")
        qid = lb.ensure_qgis_id(layout)
        r1 = workflow.send_to_slide(layout, dpi=100, out_dir=os.path.join(OUT, "send2"))
        layout.setName(layout.name() + "-renamed")
        r2 = workflow.send_to_slide(layout, dpi=100, out_dir=os.path.join(OUT, "send2"))
        parts = qgis_parts(d)
        check("L4 조판 이름을 바꿔도 이전 결과 교체", r2["removed"] == 1 and len(parts) == 1 and parts[0]["qgisId"] == qid, parts)
        check("L5 슬라이드로 보낸 뒤 임시 PNG 삭제", not os.path.exists(r1["image"]) and not os.path.exists(r2["image"]), r2["image"])
        for k, v in saved_link.items():
            layout.setCustomProperty("slidemap/" + k, v)
    finally:
        ppt_com.run_op("closetest", path=d)

    u = ppt_com.run_op("newtest", path="", title="unsaved")["fullName"]
    try:
        res = ppt_com.insert_picture(u, 1, png, 10, 10, 60, 60, "s", save=True)
        check("L3 미저장 문서: 저장 건너뛰고 오류 아님", res["saved"] is False and res.get("saveSkipped"), res)
        prep = {"link": {"pptx": u, "slide_index": 1, "slide_id": 0, "map_id": ""}, "rect_pt": (0, 0, 10, 10),
                "image": png, "layout_name": "x", "qgis_id": "", "px": (0, 0)}
        rr = workflow.insert_prepared(prep, save=True, keep_image=True)
        check("L3 저장 건너뜀은 경고(warnings)로 보고", rr["warnings"], rr["warnings"])
    finally:
        ppt_com.run_op("closetest", path=u)


def test_misc(prj, lyr, layout, pre_existing):
    """M4 / M2 / L1 / L2 / L5 / L6 / M9."""
    # ---- M4: URL 문서 ----
    try:
        ppt_com.slide_info("https://contoso.sharepoint.com/sites/x/deck.pptx", 1)
        ok, msg = False, "오류 없음"
    except ppt_com.PptError as e:
        ok, msg = ("열려 있지 않" in str(e)), str(e)
    check("M4 열려 있지 않은 URL 문서는 명확한 오류", ok, msg)
    check("M4 is_url", ppt_com.is_url("https://a/b.pptx") and not ppt_com.is_url("C:\\a\\b.pptx"))

    # ---- M2: 기준점이 Middle/LowerRight 여도 같은 결과 ----
    m = lb.map_item(layout)
    outs = {}
    for name, ref in (("UL", QgsLayoutItem.UpperLeft), ("Middle", QgsLayoutItem.Middle), ("LR", QgsLayoutItem.LowerRight)):
        m.setReferencePoint(ref)
        outs[name] = os.path.join(OUT, "ref_%s.png" % name)
        lb.export_map(layout, outs[name], "png", 60)
    m.setReferencePoint(QgsLayoutItem.UpperLeft)
    check("M2 지도 기준점 Middle 내보내기 = 기본", img_equal(outs["UL"], outs["Middle"]))
    check("M2 지도 기준점 LowerRight 내보내기 = 기본", img_equal(outs["UL"], outs["LR"]))
    ov_item = layout.itemById(lb.ID_OVERLAY)
    p0 = os.path.join(OUT, "ref_others_ul.png")
    lb.export_map(layout, p0, "png", 60, include_others=True)
    ov_item.setReferencePoint(QgsLayoutItem.Middle)
    p1 = os.path.join(OUT, "ref_others_mid.png")
    lb.export_map(layout, p1, "png", 60, include_others=True)
    ov_item.setReferencePoint(QgsLayoutItem.UpperLeft)
    check("M2 다른 항목(기준점 Middle)도 어긋나지 않음", img_equal(p0, p1))
    # 지도가 슬라이드 어딘가에 치우쳐 있어도(프레임 != 0,0) 내보낸 지도에 흰 여백이 생기지 않아야 함: 위 비교가 이를 보장

    # ---- L2: 회전/다중 페이지 ----
    m.setItemRotation(15)
    try:
        workflow.prepare_send(layout, out_dir=os.path.join(OUT, "send"))
        ok = False
    except ValueError as e:
        ok = "회전" in str(e)
    m.setItemRotation(0)
    check("L2 회전된 지도 항목은 보내기 거부", ok)
    layout.pageCollection().extendByNewPage()
    try:
        pg1 = os.path.join(OUT, "pg1.png")
        lb.export_map(layout, pg1, "png", 60)
        im = QImage(pg1)
        mx, my, mw, mh = lb.map_rect_mm(layout)
        check("L2 페이지가 여러 개여도 지도 크기만큼만(첫 페이지) 내보냄",
              abs(im.width() - round(mw / 25.4 * 60)) <= 1 and abs(im.height() - round(mh / 25.4 * 60)) <= 1,
              (im.width(), im.height()))
    finally:
        layout.pageCollection().deletePage(1)

    # ---- L1 / L6 ----
    sn = ppt_com.safe_name
    a, b = sn("a\\..\\b"), sn("../../x")
    check("L1 safe_name: 역슬래시/..", "\\" not in a and ".." not in a and "/" not in b and ".." not in b, (a, b))
    check("L1 safe_name: 예약어/빈 값", sn("CON") != "CON" and sn("..") == "item", (sn("CON"), sn("..")))
    check("L6 scale 상한 4", ppt_com.clamp_scale(10) == 4.0 and ppt_com.clamp_scale(0.1) == 1.0 and ppt_com.clamp_scale("x") == 3.0)
    dd = new_deck("scratch-scale.pptx")
    try:
        assets = workflow.fetch_slide_assets(dd, 1, scale=9)
        w = QImage(assets["images"]["full"]).width()
        check("L6 코드에서도 배율 4배로 제한", w == 960 * 4, w)
        ppt_com.remove_cache_subdir(assets["out_dir"])
    finally:
        ppt_com.run_op("closetest", path=dd)

    # ---- L5: 새로고침 시 이전 캐시 삭제 ----
    old_dir = os.path.dirname(layout.itemById(lb.ID_BG).picturePath())
    check("L5 (전제) 이전 캐시 폴더가 캐시 안에 있음", os.path.normcase(old_dir).startswith(os.path.normcase(ppt_com.cache_dir())), old_dir)
    ppt_com.run_op("newtest", path=DECK, title="L5")
    saved_pptx = layout.customProperty("slidemap/pptx")
    saved_sid = layout.customProperty("slidemap/slide_id")
    try:
        layout.setCustomProperty("slidemap/pptx", DECK)
        layout.setCustomProperty("slidemap/slide_id", "")
        workflow.refresh_slide_images(layout)
        check("L5 새로고침 후 이전 캐시 폴더 삭제", not os.path.exists(old_dir), old_dir)
        new_bg = layout.itemById(lb.ID_BG).picturePath()
        check("L5 새 배경 이미지는 존재", os.path.exists(new_bg), new_bg)
        ppt_com.remove_cache_subdir(os.path.dirname(new_bg))
    finally:
        layout.setCustomProperty("slidemap/pptx", saved_pptx)
        layout.setCustomProperty("slidemap/slide_id", saved_sid)
        ppt_com.run_op("closetest", path=DECK)

    # ---- M9 / L1: 레이어 내보내기 ----
    fold = os.path.join(OUT, "layers-nooverwrite")
    shutil.rmtree(fold, ignore_errors=True)
    r1 = layer_export.export_layers([lyr], fold, "geojson", prj)
    r2 = layer_export.export_layers([lyr], fold, "geojson", prj)
    check("M9 두 번째 내보내기는 번호를 붙여 새 파일(덮어쓰기 없음)",
          r1[0][1] and r2[0][1] and r1[0][1] != r2[0][1] and os.path.exists(r1[0][1]) and os.path.exists(r2[0][1]),
          (r1[0][1], r2[0][1]))
    lyr2 = QgsVectorLayer(SHP, "..\\..\\evil", "ogr")
    r3 = layer_export.export_layers([lyr2], fold, "geojson", prj)
    check("L1 레이어 이름의 경로 탈출 차단",
          r3[0][1] and os.path.dirname(os.path.abspath(r3[0][1])) == os.path.abspath(fold), r3)
    check("테스트 후에도 남의 프레젠테이션 유지", pre_existing <= {p["name"] for p in ppt_com.list_presentations()})


def main():
    prj = QgsProject.instance()
    lyr = QgsVectorLayer(SHP, "계획구역", "ogr")
    check("샘플 레이어 로드", lyr.isValid(), lyr.crs().authid())
    prj.addMapLayer(lyr)
    prj.setCrs(lyr.crs())

    # --- 테스트용 덱 생성 (자체 프레젠테이션만 사용) ---
    try:
        ppt_com.run_op("closetest", path=DECK)
    except Exception:
        pass
    if os.path.exists(DECK):
        os.remove(DECK)
    ppt_com.run_op("newtest", path=DECK, title="테스트 슬라이드 제목")

    pres = ppt_com.list_presentations()
    names = [p["name"] for p in pres]
    pre_existing = set(names) - {"test-deck.pptx"}   # 테스트 전부터 열려 있던 남의 프레젠테이션
    check("열린 프레젠테이션 목록에 test-deck 포함", "test-deck.pptx" in names, names)
    mine = [p for p in pres if p["name"] == "test-deck.pptx"][0]
    check("슬라이드 제목 읽기(한글)", mine["slides"][0]["title"] == "테스트 슬라이드 제목", mine["slides"])
    pres_s = ppt_com.list_presentations(with_shapes=True)
    mine_s = [p for p in pres_s if p["name"] == "test-deck.pptx"][0]
    check("list(with_shapes): 슬라이드마다 도형 정보 포함 (슬라이드 선택 시 COM 호출 불필요)",
          len(mine_s["slides"][0]["shapes"]) >= 3 and any(s["part"] == "basemap" for s in mine_s["slides"][0]["shapes"]))

    info = ppt_com.slide_info(DECK, 1)
    check("슬라이드 크기 960x540", approx(info["slideWidth"], 960) and approx(info["slideHeight"], 540),
          (info["slideWidth"], info["slideHeight"]))
    fs, basis = ppt_com.find_frame(info["shapes"])
    check("프레임 = basemap 태그 도형", basis == "basemap" and approx(fs["left"], 180, .5) and approx(fs["top"], 100, .5)
          and approx(fs["width"], 600, .5) and approx(fs["height"], 338, .5), (basis, fs))
    fs2, _ = ppt_com.find_frame(info["shapes"], "card")
    check("이름 지정 프레임", fs2["name"] == "card")
    shapes_before = {s["name"]: (s["left"], s["top"], s["width"], s["height"], s["z"]) for s in info["shapes"]}
    probe_before = probe(DECK)

    # --- 슬라이드 -> 조판 ---
    ext = lyr.extent()
    layout, rep = workflow.slide_to_layout(prj, DECK, 1, extent=ext, crs=prj.crs())
    check("조판 이름", layout.name() == "슬라이드 1 - test-deck", layout.name())
    pw, ph = 960 * 25.4 / 72, 540 * 25.4 / 72
    pg = layout.pageCollection().page(0).pageSize()
    check("페이지 크기 = 슬라이드(mm)", approx(pg.width(), pw) and approx(pg.height(), ph), (pg.width(), pg.height()))
    mx, my, mw, mh = lb.map_rect_mm(layout)
    check("지도 항목 위치/크기 = 프레임(mm)",
          approx(mx, 180 * 25.4 / 72) and approx(my, 100 * 25.4 / 72) and approx(mw, 600 * 25.4 / 72) and approx(mh, 338 * 25.4 / 72),
          (round(mx, 2), round(my, 2), round(mw, 2), round(mh, 2)))
    ids = [i.id() for i in lb.layout_items(layout) if i.id()]
    check("항목 이름 3종", all(n in ids for n in (lb.ID_BG, lb.ID_MAP, lb.ID_OVERLAY)), ids)
    z = {i.id(): i.zValue() for i in lb.layout_items(layout) if i.id()}
    check("쌓임: 배경 < 지도 < 오버레이", z[lb.ID_BG] < z[lb.ID_MAP] < z[lb.ID_OVERLAY], z)
    check("배경/오버레이 잠금", layout.itemById(lb.ID_BG).isLocked() and layout.itemById(lb.ID_OVERLAY).isLocked())
    m = lb.map_item(layout)
    check("지도 범위가 레이어 범위를 포함", m.extent().contains(ext), m.extent().toString(1))
    check("지도 CRS = 프로젝트 CRS", m.crs() == prj.crs(), m.crs().authid())
    link = lb.get_link(layout)
    check("연결 메타데이터", link and link["pptx"].lower() == DECK.lower() and link["slide_index"] == 1
          and link["map_id"] == "m-test" and link["frame"] and approx(link["frame"][0], 180, .5), link)
    check("L4 조판에 qgis_id(UUID) 부여", len(link["qgis_id"]) == 32, link["qgis_id"])

    # --- 이미지 검증: 크기, 투명도 ---
    imgs = rep["images"]
    full, nomap, ov = QImage(imgs["full"]), QImage(imgs["nomap"]), QImage(imgs["overlay"])
    check("이미지 크기 2880x1620", (full.width(), full.height()) == (2880, 1620) and (ov.width(), ov.height()) == (2880, 1620),
          (full.width(), full.height()))
    check("full: 프레임 영역이 회색(지도 객체 보임)", abs(px(full, 300, 200).red() - 0xCC) < 8, px(full, 300, 200).getRgb())
    check("nomap: 프레임 영역이 흰 배경(지도 객체 숨김)", px(nomap, 300, 200).red() > 245, px(nomap, 300, 200).getRgb())
    o_card, o_empty, o_map = px(ov, 650, 310), px(ov, 300, 200), px(ov, 100, 480)
    check("overlay: 카드 영역 불투명", o_card.alpha() > 250, o_card.getRgb())
    check("overlay: 빈 영역/지도 영역 완전 투명", o_empty.alpha() == 0 and o_map.alpha() == 0, (o_empty.alpha(), o_map.alpha()))
    # PowerPoint RGB 정수는 0xBBGGRR -> 0x2060E0 = R:E0 G:60 B:20
    check("overlay: 카드 색 복원", abs(o_card.red() - 0xE0) < 12 and abs(o_card.blue() - 0x20) < 12, o_card.getRgb())
    s_ = QgsLayoutExporter.ImageExportSettings()
    s_.dpi = 100
    lp = os.path.join(OUT, "layout-preview.png")
    QgsLayoutExporter(layout).exportToImage(lp, s_)
    check("조판 미리보기 PNG 생성", os.path.exists(lp), lp)

    # 사용자 슬라이드 무변경
    info2 = ppt_com.slide_info(DECK, 1)
    after = {s["name"]: (s["left"], s["top"], s["width"], s["height"], s["z"]) for s in info2["shapes"]}
    check("내보내기 후 슬라이드 도형/z-order 무변경", after == shapes_before)
    probe_after = probe(DECK)
    check("내보내기 후 원본 Saved/배경/가시성 무변경 (H1)",
          all(probe_before[k] == probe_after[k] for k in ("saved", "bgType", "follow", "master", "visible")),
          (probe_before, probe_after))
    full2 = os.path.join(OUT, "check_after_export.png")
    ppt_com.run_op("export", path=DECK, slide=1, pxWidth=960, pxHeight=540, full=full2)
    im = QImage(full2)
    check("내보내기 후 지도 객체 다시 보임 + 배경 흰색 유지",
          abs(QImage.pixelColor(im, 300, 200).red() - 0xCC) < 8 and QImage.pixelColor(im, 5, 5).red() > 245)

    # --- 조판 -> 슬라이드 ---
    xs = lb.export_map(layout, os.path.join(OUT, "map_only.png"), "png", 300)
    ex_w, ex_h = round(mw / 25.4 * 300), round(mh / 25.4 * 300)
    check("지도 PNG 픽셀 = 프레임 mm@300dpi", abs(xs[0] - ex_w) <= 1 and abs(xs[1] - ex_h) <= 1, (xs, (ex_w, ex_h)))
    check("원본 조판 항목 보존", all(layout.itemById(n) is not None for n in (lb.ID_BG, lb.ID_OVERLAY, lb.ID_MAP)))
    im = QImage(os.path.join(OUT, "map_only.png"))
    has_color = any(QImage.pixelColor(im, x, y).rgb() != 0xffffffff
                    for x in range(0, im.width(), 97) for y in range(0, im.height(), 97))
    check("지도 PNG에 지도 내용 존재(전부 흰색 아님)", has_color)
    lb.export_map(layout, os.path.join(OUT, "map_transparent.png"), "png", 100, transparent=True)
    imt = QImage(os.path.join(OUT, "map_transparent.png"))
    check("투명 배경 옵션: 알파 0 픽셀 존재",
          any(QImage.pixelColor(imt, x, y).alpha() == 0 for x in range(0, imt.width(), 7) for y in range(0, imt.height(), 7)))
    lb.export_map(layout, os.path.join(OUT, "map_only.svg"), "svg", 300)
    check("지도 SVG 생성", os.path.getsize(os.path.join(OUT, "map_only.svg")) > 1000)

    r1 = workflow.send_to_slide(layout, dpi=200, out_dir=os.path.join(OUT, "send"))
    r2 = workflow.send_to_slide(layout, dpi=200, out_dir=os.path.join(OUT, "send"))
    check("재전송 시 이전 qgis 파트 교체", r1["removed"] == 0 and r2["removed"] == 1, (r1["removed"], r2["removed"]))
    info3 = ppt_com.slide_info(DECK, 1)
    qs = [s for s in info3["shapes"] if s["part"] == "qgis"]
    base = [s for s in info3["shapes"] if s["part"] == "basemap"][0]
    check("슬라이드에 qgis 파트 1개, 프레임 위치와 일치",
          len(qs) == 1 and all(approx(qs[0][k], base[k], 0.6) for k in ("left", "top", "width", "height")), qs)
    check("태그 SLIDEMAP_MAP 유지 / 이름", qs[0]["mapId"] == "m-test" and qs[0]["name"] == "SlideMap · QGIS · 슬라이드 1 - test-deck", qs[0]["name"])
    card = [s for s in info3["shapes"] if s["name"] == "card"][0]
    check("z-order: basemap 바로 위, 카드보다 아래", qs[0]["z"] == base["z"] + 1 and qs[0]["z"] < card["z"], (base["z"], qs[0]["z"], card["z"]))
    fin = os.path.join(OUT, "slide-after-send.png")
    ppt_com.run_op("export", path=DECK, slide=1, pxWidth=1920, pxHeight=1080, full=fin)
    check("최종 슬라이드 PNG 생성", os.path.exists(fin), fin)

    # 새로고침
    before_path = layout.itemById(lb.ID_BG).picturePath()
    workflow.refresh_slide_images(layout)
    check("슬라이드 새로고침: 배경 이미지 경로 교체", layout.itemById(lb.ID_BG).picturePath() != before_path)

    # 저장 후 닫고 pptx 직접 읽기
    ppt_com.run_op("insert", path=DECK, slide=1, image=os.path.join(OUT, "map_only.png"),
                   left=0, top=0, width=10, height=10, layoutName="tmp-save", save=True)
    ppt_com.run_op("closetest", path=DECK)
    d = pptx_reader.read_pptx(DECK)
    sl = d["slides"][0]
    fr = [s for s in sl["shapes"] if s["part"] == "basemap"]
    check("pptx_reader: 크기/제목/프레임",
          approx(d["slideWidth"], 960, .5) and sl["title"].startswith("테스트") and fr and approx(fr[0]["left"], 180, .5),
          (sl["title"], fr))
    check("저장된 pptx에서 qgis 태그 읽힘", any(s["part"] == "qgis" for s in sl["shapes"]))

    # 닫힌 파일 읽기전용 열기 경로 (창 없이) + 자동 닫힘
    ls = ppt_com.list_slides(DECK)
    check("닫힌 파일: 읽기 전용(창 없음)으로 열어 목록", len(ls["slides"]) == 1)
    names = [p["name"] for p in ppt_com.list_presentations()]
    check("읽기 전용으로 연 파일은 스스로 닫음", "test-deck.pptx" not in names, names)
    check("테스트 전부터 열려 있던 프레젠테이션은 그대로 열려 있음", pre_existing <= set(names), (pre_existing, names))

    # --- 추가 검증 (원본 무변경, 삽입 안전성, 기준점, 회전 등) ---
    test_h1_m3()
    test_insert(layout)
    test_misc(prj, lyr, layout, pre_existing)

    # --- 레이어 내보내기 ---
    shutil.rmtree(os.path.join(OUT, "layers"), ignore_errors=True)
    for fmt in ("gpkg", "geojson"):
        res = layer_export.export_layers([lyr], os.path.join(OUT, "layers"), fmt, prj)
        ok = bool(res[0][1]) and os.path.exists(res[0][1])
        chk = QgsVectorLayer(res[0][1], "x", "ogr") if ok else None
        check("레이어 내보내기 %s -> EPSG:4326" % fmt,
              ok and chk.isValid() and chk.crs().authid() == "EPSG:4326" and chk.featureCount() == lyr.featureCount(), res)
        if chk:
            e = chk.extent()
            check("  %s 좌표가 경위도 범위" % fmt, 120 < e.xMinimum() < 135 and 30 < e.yMinimum() < 40, e.toString(3))


try:
    main()
except Exception:
    traceback.print_exc()
    results.append(("예외", False))
    try:
        ppt_com.run_op("closetest", path=DECK)
    except Exception:
        pass
fails = [n for n, ok in results if not ok]
print("\n=== %d/%d 통과 ===" % (len(results) - len(fails), len(results)))
for n in fails:
    print("FAILED:", n)
app.exitQgis()
sys.exit(1 if fails else 0)
