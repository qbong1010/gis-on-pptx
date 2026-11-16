# -*- coding: utf-8 -*-
"""실제 QGIS GUI 안에서 실행하는 스모크 테스트 (qgis-bin --code).
플러그인 로드 -> 메뉴/툴바 확인 -> 슬라이드→조판 -> 디자이너 창에 Slide Map 메뉴/툴바 확인 -> 스크린샷 -> 종료.
결과는 out/gui_smoke.json 에 기록.
"""
import json
import os
import sys
import traceback

try:  # qgis --code 는 exec 로 실행하므로 __file__ 이 없다 -> 환경변수(run_gui_smoke.ps1 이 설정) 사용
    ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
except NameError:
    ROOT = os.environ["SMB_ROOT"]
sys.path.insert(0, os.path.join(ROOT, "qgis-plugin"))
OUT = os.path.join(ROOT, "tests", "qgis", "out")
res = {"steps": []}


def step(name, ok, detail=""):
    res["steps"].append({"name": name, "ok": bool(ok), "detail": str(detail)})


def finish():
    with open(os.path.join(OUT, "gui_smoke.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    from qgis.PyQt.QtWidgets import QApplication
    QApplication.quit()
    os._exit(0)


try:
    from qgis.utils import iface
    from qgis.core import QgsProject, QgsVectorLayer
    from qgis.PyQt.QtCore import QTimer
    from qgis.PyQt.QtWidgets import QMenu, QApplication
    import slide_map_bridge.plugin as P
    from slide_map_bridge import ppt_com, layout_builder as lb, workflow

    DECK = os.path.join(OUT, "test-deck.pptx")
    ppt_com.run_op("closetest", path=DECK)
    if os.path.exists(DECK):
        os.remove(DECK)
    ppt_com.run_op("newtest", path=DECK, title="GUI 스모크")

    lyr = QgsVectorLayer(os.path.join(ROOT, "samples", "shp-test", "계획구역_5186.shp"), "계획구역", "ogr")
    QgsProject.instance().addMapLayer(lyr)
    iface.mapCanvas().setDestinationCrs(lyr.crs())
    iface.mapCanvas().setExtent(lyr.extent())

    plug = P.SlideMapBridgePlugin(iface)
    plug.initGui()
    titles = [a.text() for a in iface.pluginMenu().actions()]
    step("플러그인 메뉴 등록", "Slide Map" in titles, titles)

    # 대화상자 생성만 확인 (exec 하지 않음)
    from slide_map_bridge import dialogs
    d = dialogs.SlideToLayoutDialog(iface.mainWindow(), True)
    import time
    t0 = time.time()

    def stage2():
        # 대화상자는 PowerPoint 정보를 백그라운드(QgsTask)로 읽는다 -> 끝날 때까지 기다린다
        if d.loading and time.time() - t0 < 90:
            QTimer.singleShot(500, stage2)
            return
        try:
            stage2_body()
        except Exception:
            step("stage2 예외", False, traceback.format_exc())
            try:
                ppt_com.run_op("closetest", path=DECK)
            except Exception:
                pass
            finish()

    def stage2_body():
        names = [d.cmb_pres.itemText(i) for i in range(d.cmb_pres.count())]
        step("슬라이드→조판 대화상자: 프레젠테이션 목록", "test-deck.pptx" in names, names)
        for i in range(d.cmb_pres.count()):
            if d.cmb_pres.itemText(i) == "test-deck.pptx":
                d.cmb_pres.setCurrentIndex(i)
        step("슬라이드 목록 표시", d.lst.count() == 1 and "GUI 스모크" in d.lst.item(0).text(), d.lst.item(0).text() if d.lst.count() else "")
        step("프레임 콤보에 도형 포함 (COM 호출 없이 캐시된 도형)", d.cmb_frame.count() >= 4, d.cmb_frame.count())
        p = d.result_params()
        d.grab().save(os.path.join(OUT, "gui_dialog_slide_to_layout.png"))

        ext = iface.mapCanvas().extent()
        layout, rep = workflow.slide_to_layout(QgsProject.instance(), p["pptx"], p["slide_index"], extent=ext,
                                               crs=iface.mapCanvas().mapSettings().destinationCrs(), slide_id=p["slide_id"])
        iface.openLayoutDesigner(layout)

        def after():
            try:
                ds = iface.openLayoutDesigners()
                step("조판 디자이너 열림", len(ds) >= 1, len(ds))
                if ds:
                    des = ds[0]
                    menus = [a.text() for a in des.window().menuBar().actions()]
                    step("디자이너 메뉴바에 Slide Map", "Slide Map" in menus, menus)
                    tb = [a.text() for a in des.actionsToolbar().actions()]
                    step("디자이너 툴바에 보내기 액션", any("슬라이드로 보내기" in t for t in tb), tb)
                    des.window().resize(1400, 900)
                    QApplication.processEvents()
                    des.window().grab().save(os.path.join(OUT, "gui_designer.png"))
                    dl = dialogs.SendToSlideDialog(iface.mainWindow(), [layout], layout.name())
                    dl.grab().save(os.path.join(OUT, "gui_dialog_send.png"))
                    step("조판→슬라이드 대화상자 생성", dl.result_params()["dpi"] == 300)
                    lx = dialogs.LayerExportDialog(iface.mainWindow(), [lyr], {lyr.id()}, OUT)
                    lx.grab().save(os.path.join(OUT, "gui_dialog_layers.png"))
                    step("레이어 내보내기 대화상자 생성", len(lx.result_params()["layers"]) == 1)
                    plug.unload()
                    step("unload 오류 없음", True)
                    QApplication.processEvents()
                    menus2 = [a.text() for a in des.window().menuBar().actions()]
                    step("unload 후 디자이너 메뉴 제거", "Slide Map" not in menus2, menus2)
                    tb2 = [a.text() for a in des.actionsToolbar().actions()]
                    step("unload 후 디자이너 툴바 액션 제거", not any("슬라이드로 보내기" in t for t in tb2), tb2)
                    step("unload 후 플러그인 메뉴 제거", "Slide Map" not in [a.text() for a in iface.pluginMenu().actions()])
            except Exception:
                step("디자이너 단계 예외", False, traceback.format_exc())
            ppt_com.run_op("closetest", path=DECK)
            finish()

        QTimer.singleShot(3000, after)

    QTimer.singleShot(500, stage2)
except Exception:
    step("예외", False, traceback.format_exc())
    try:
        ppt_com.run_op("closetest", path=DECK)
    except Exception:
        pass
    finish()
