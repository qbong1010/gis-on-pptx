# -*- coding: utf-8 -*-
"""Slide Map Bridge - QGIS 플러그인 진입점 (메뉴/툴바/조판 디자이너 연결)."""
import os

from qgis.core import Qgis, QgsProject
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QAction, QMenu, QMessageBox

from . import dialogs, layer_export, layout_builder as lb, ppt_com, tasks, workflow

HERE = os.path.dirname(os.path.abspath(__file__))
MENU_TITLE = "Slide Map"
TITLE = "Slide Map Bridge"
# 사용자에게 오류로 보여줄 예외들 (COM/파일/값 문제)
EXPECTED_ERRORS = (ppt_com.PptError, ValueError, RuntimeError, OSError)


def _icon(name):
    return QIcon(os.path.join(HERE, "icons", name))


class SlideMapBridgePlugin:
    def __init__(self, iface):
        self.iface = iface
        self.menu = None
        self.main_actions = []
        self._designers = {}   # designer -> {"actions": [...], "menu": QMenu|None, "bar": toolbar|None}
        self._busy = False     # 백그라운드 작업 중복 실행 방지

    # ---------- 생명주기 ----------
    def initGui(self):
        self.menu = QMenu(MENU_TITLE, self.iface.mainWindow())
        self.menu.setIcon(_icon("slidemap.svg"))
        self.act_to_layout = self._make("슬라이드 → 조판…", "to_layout.svg", self.run_slide_to_layout)
        self.act_to_slide = self._make("조판 → 슬라이드…", "to_slide.svg", self.run_send_to_slide)
        self.act_layers = self._make("레이어 내보내기 (Slide Map용)…", "layers.svg", self.run_export_layers)
        self.main_actions = [self.act_to_layout, self.act_to_slide, self.act_layers]
        for a in self.main_actions:
            self.menu.addAction(a)
            self.iface.addToolBarIcon(a)
        self.iface.pluginMenu().addMenu(self.menu)
        # 조판 디자이너 (이미 열려 있는 것 + 앞으로 열릴 것)
        self.iface.layoutDesignerOpened.connect(self._designer_opened)
        self.iface.layoutDesignerWillBeClosed.connect(self._designer_closed)
        try:
            for d in self.iface.openLayoutDesigners():
                self._designer_opened(d)
        except Exception:
            pass

    def unload(self):
        try:
            self.iface.layoutDesignerOpened.disconnect(self._designer_opened)
            self.iface.layoutDesignerWillBeClosed.disconnect(self._designer_closed)
        except (TypeError, RuntimeError):
            pass
        for d in list(self._designers):
            self._remove_designer_ui(d)
        for a in self.main_actions:
            try:
                self.iface.removeToolBarIcon(a)
            except RuntimeError:
                pass
            if self.menu:
                self.menu.removeAction(a)
            a.deleteLater()
        self.main_actions = []
        if self.menu:
            self.iface.pluginMenu().removeAction(self.menu.menuAction())
            self.menu.deleteLater()
            self.menu = None

    def _make(self, text, icon, slot, parent=None):
        a = QAction(_icon(icon), text, parent or self.iface.mainWindow())
        a.triggered.connect(lambda _=False: slot())
        return a

    # ---------- 조판 디자이너 연동 ----------
    # [확인 필요] 실제 QGIS GUI에서 디자이너 창에 메뉴/툴바가 나타나는지는 헤드리스 테스트 불가
    #   (GUI 스모크: tests/qgis/run_gui_smoke.ps1 에서 확인).
    def _designer_opened(self, designer):
        if designer in self._designers:
            return
        win = designer.window()
        acts = [
            self._make("조판 → 슬라이드로 보내기…", "to_slide.svg", lambda d=designer: self.run_send_to_slide(d.layout()), win),
            self._make("슬라이드 이미지 새로고침", "to_layout.svg", lambda d=designer: self.run_refresh(d.layout()), win),
        ]
        entry = {"actions": acts, "menu": None, "bar": None}
        try:
            bar = designer.actionsToolbar()
            for a in acts:
                bar.addAction(a)
            entry["bar"] = bar
        except Exception:
            pass
        try:
            m = win.menuBar().addMenu(MENU_TITLE)
            for a in acts:
                m.addAction(a)
            entry["menu"] = m
        except Exception:
            pass
        self._designers[designer] = entry

    def _remove_designer_ui(self, designer):
        """디자이너에 추가한 메뉴/툴바 액션을 제거하고 삭제 예약."""
        entry = self._designers.pop(designer, None)
        if not entry:
            return
        try:
            m = entry["menu"]
            if m is not None:
                try:
                    designer.window().menuBar().removeAction(m.menuAction())
                except RuntimeError:
                    pass
                m.deleteLater()
            for a in entry["actions"]:
                if entry["bar"] is not None:
                    try:
                        entry["bar"].removeAction(a)
                    except RuntimeError:
                        pass
                a.deleteLater()
        except RuntimeError:
            pass   # 창이 이미 파괴됨

    def _designer_closed(self, designer):
        self._remove_designer_ui(designer)

    # ---------- 도우미 ----------
    def _msg(self, level, text, title="Slide Map"):
        self.iface.messageBar().pushMessage(title, text, level, 8)

    def _warn(self, text):
        QMessageBox.warning(self.iface.mainWindow(), TITLE, text)

    def _linked_layouts(self):
        mgr = QgsProject.instance().layoutManager()
        return [l for l in mgr.layouts() if lb.get_link(l)]

    def _exec_dialog(self, dlg):
        """대화상자를 실행하고 (수락 여부, 파라미터) 반환. 대화상자는 항상 삭제 예약한다."""
        try:
            if dlg.exec_() != dlg.Accepted:
                return False, None
            return True, dlg.result_params()
        finally:
            dlg.deleteLater()

    def _run_bg(self, description, fn, done, cancelable=True):
        """백그라운드 실행. 동시에 한 작업만. done(value) 은 성공 시 메인 스레드에서 호출,
        오류/취소는 여기서 처리한다."""
        if self._busy:
            self._msg(Qgis.Info, "이전 Slide Map 작업이 아직 진행 중입니다. QGIS 작업 관리자(오른쪽 아래)에서 진행/취소할 수 있습니다.")
            return
        self._busy = True

        def finished(exc, value):
            self._busy = False
            if isinstance(exc, ppt_com.PptCancelled) or (exc is None and value is None):
                self._msg(Qgis.Info, "작업이 취소되었습니다.")
                return
            if exc is not None:
                self._warn("%s\n\n%s" % (description, exc))
                return
            try:
                done(value)
            except EXPECTED_ERRORS as e:
                self._warn("%s\n\n%s" % (description, e))

        tasks.run_async(description, fn, finished, cancelable=cancelable)
        self._msg(Qgis.Info, "%s … (PowerPoint 작업 중, QGIS는 계속 사용할 수 있습니다)" % description)

    # ---------- 1. 슬라이드 → 조판 ----------
    def run_slide_to_layout(self):
        canvas = self.iface.mapCanvas()
        ok, p = self._exec_dialog(dialogs.SlideToLayoutDialog(self.iface.mainWindow(), has_canvas=canvas is not None))
        if not ok:
            return
        extent = canvas.extent() if (p["use_canvas"] and canvas) else None
        crs = canvas.mapSettings().destinationCrs() if canvas else None

        def work(cancel):
            return workflow.fetch_slide_assets(p["pptx"], p["slide_index"], p["frame_name"], p["scale"],
                                               p["slide_id"], cancel=cancel)

        def done(assets):
            layout, rep = workflow.build_from_assets(QgsProject.instance(), assets, extent=extent, crs=crs)
            designer = self.iface.openLayoutDesigner(layout)
            try:
                designer.view().zoomFull()  # 페이지 전체가 보이도록
            except Exception:
                pass
            self._msg(Qgis.Success, "조판 '%s' 생성 (프레임 기준: %s)" % (layout.name(), rep["frame_basis"]))

        self._run_bg("슬라이드를 가져오지 못했습니다.", work, done)

    # ---------- 2. 조판 → 슬라이드 ----------
    def run_send_to_slide(self, layout=None):
        links = self._linked_layouts()
        if layout is not None and not lb.get_link(layout):
            QMessageBox.information(self.iface.mainWindow(), TITLE,
                                    "이 조판은 슬라이드와 연결되어 있지 않습니다.\n'슬라이드 → 조판'으로 만든 조판에서 실행하세요.")
            return
        if not links:
            QMessageBox.information(self.iface.mainWindow(), TITLE,
                                    "슬라이드와 연결된 조판이 없습니다. 먼저 '슬라이드 → 조판'을 실행하세요.")
            return
        ok, p = self._exec_dialog(dialogs.SendToSlideDialog(self.iface.mainWindow(), links,
                                                             layout.name() if layout else None))
        if not ok:
            return
        target = QgsProject.instance().layoutManager().layoutByName(p.pop("layout_name"))
        save = p.pop("save")
        if self._busy:
            self._msg(Qgis.Info, "이전 Slide Map 작업이 아직 진행 중입니다.")
            return
        # 조판 렌더링(로컬, 메인 스레드) -> PowerPoint 삽입(백그라운드, 취소 불가: 중간 취소하면 일부만 반영될 수 있음)
        try:
            with dialogs.busy():
                prep = workflow.prepare_send(target, **p)
        except EXPECTED_ERRORS as e:
            self._warn("슬라이드로 보내지 못했습니다.\n\n%s" % e)
            return

        def done(res):
            text = "슬라이드에 '%s' 삽입%s" % (res.get("shapeName", ""), " (이전 결과 교체)" if res.get("removed") else "")
            if res.get("warnings"):
                self._msg(Qgis.Warning, text + " - " + " / ".join(res["warnings"]))
            else:
                self._msg(Qgis.Success, text)

        def work(cancel):
            return workflow.insert_prepared(prep, save=save)

        self._run_bg("슬라이드로 보내지 못했습니다.", work, done, cancelable=False)

    def run_refresh(self, layout):
        link = lb.get_link(layout)
        if not link:
            QMessageBox.information(self.iface.mainWindow(), TITLE, "슬라이드와 연결된 조판이 아닙니다.")
            return
        name = layout.name()
        scale = float(layout.customProperty("slidemap/scale", "3") or 3)

        def work(cancel):
            return workflow.fetch_refresh_assets(link, name, scale, cancel=cancel)

        def done(imgs):
            workflow.apply_refresh(layout, imgs)
            self._msg(Qgis.Success, "슬라이드 배경/오버레이 이미지를 새로 가져왔습니다.")

        self._run_bg("슬라이드 이미지를 새로 가져오지 못했습니다.", work, done)

    # ---------- 3. 레이어 내보내기 ----------
    def _default_export_folder(self, links, prj):
        base = None
        for l in links:
            pp = lb.get_link(l)["pptx"]
            d = os.path.dirname(pp) if pp and not ppt_com.is_url(pp) else ""
            if d and os.path.isdir(d):
                base = d
                break
        if not base and prj.fileName():
            base = os.path.dirname(prj.fileName())
        return os.path.join(base or os.path.expanduser("~"), "slidemap-layers")

    def run_export_layers(self):
        prj = QgsProject.instance()
        layers = layer_export.vector_layers(prj)
        if not layers:
            QMessageBox.information(self.iface.mainWindow(), TITLE, "내보낼 벡터 레이어가 없습니다.")
            return
        visible = {l.id() for l in layer_export.vector_layers(prj, visible_only=True)}
        folder = self._default_export_folder(self._linked_layouts(), prj)
        ok, p = self._exec_dialog(dialogs.LayerExportDialog(self.iface.mainWindow(), layers, visible, folder))
        if not ok or not p["layers"] or not p["folder"]:
            return
        try:
            with dialogs.busy():
                res = layer_export.export_layers(p["layers"], p["folder"], p["fmt"], prj)
        except EXPECTED_ERRORS as e:
            self._warn("레이어를 내보내지 못했습니다.\n\n%s" % e)
            return
        ok_ = [r for r in res if r[1]]
        bad = [r for r in res if not r[1]]
        text = "%d개 레이어를 '%s'에 내보냈습니다. Slide Map 패널로 끌어다 놓으세요." % (len(ok_), p["folder"])
        if bad:
            text += " 실패: " + ", ".join("%s(%s)" % (b[0], b[2]) for b in bad)
        self._msg(Qgis.Warning if bad else Qgis.Success, text)
