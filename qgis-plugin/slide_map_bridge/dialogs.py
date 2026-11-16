# -*- coding: utf-8 -*-
"""대화상자 (Qt Designer 없이 코드로 구성)."""
import os

from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QDialog, QDialogButtonBox, QDoubleSpinBox,
    QFileDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QListWidget,
    QListWidgetItem, QMessageBox, QPushButton, QSpinBox, QVBoxLayout,
)

from . import ppt_com, layout_builder as lb, layer_export, tasks


class _Busy:
    """(짧은, 로컬) 작업 중 대기 커서. 이벤트 루프를 돌리지 않는다 (재진입 방지)."""
    def __enter__(self):
        QApplication.setOverrideCursor(Qt.WaitCursor)

    def __exit__(self, *a):
        QApplication.restoreOverrideCursor()


def busy():
    return _Busy()


def error_text(exc):
    return str(exc) if exc is not None else "취소되었거나 응답이 없습니다."


class SlideToLayoutDialog(QDialog):
    """슬라이드 선택 -> 조판 생성 옵션.

    PowerPoint 조회는 백그라운드(QgsTask)에서 하고, 요청 토큰(_req)으로 오래된 응답은 버린다.
    슬라이드의 도형 정보는 목록 조회 때 한 번에 가져오므로 슬라이드를 고를 때 PowerShell 호출이 없다.
    """

    AUTO = "(자동) Slide Map 프레임 / 가장 큰 그림"

    def __init__(self, parent=None, has_canvas=True):
        super().__init__(parent)
        self.setWindowTitle("슬라이드 → 조판")
        self.setMinimumWidth(520)
        self._pres = []          # list_presentations() 결과
        self._shapes = []
        self._req = 0            # 최신 요청 토큰
        self.loading = False     # 최신 요청이 진행 중인가
        self._closed = False

        lay = QVBoxLayout(self)
        row = QHBoxLayout()
        self.cmb_pres = QComboBox()
        self.btn_refresh = QPushButton("새로고침")
        self.btn_file = QPushButton("파일 선택…")
        row.addWidget(QLabel("프레젠테이션"))
        row.addWidget(self.cmb_pres, 1)
        row.addWidget(self.btn_refresh)
        row.addWidget(self.btn_file)
        lay.addLayout(row)

        self.lst = QListWidget()
        self.lst.setMinimumHeight(180)
        lay.addWidget(QLabel("슬라이드"))
        lay.addWidget(self.lst)

        form = QFormLayout()
        self.cmb_frame = QComboBox()
        self.cmb_frame.addItem(self.AUTO, None)
        form.addRow("지도 프레임 도형", self.cmb_frame)
        self.spn_scale = QDoubleSpinBox()
        self.spn_scale.setRange(1.0, ppt_com.MAX_SCALE)
        self.spn_scale.setSingleStep(0.5)
        self.spn_scale.setValue(3.0)
        self.spn_scale.setSuffix(" 배 (슬라이드 pt 대비, 최대 %g)" % ppt_com.MAX_SCALE)
        form.addRow("이미지 해상도", self.spn_scale)
        self.chk_canvas = QCheckBox("현재 지도 캔버스 범위를 조판 지도에 사용")
        self.chk_canvas.setChecked(has_canvas)
        self.chk_canvas.setEnabled(has_canvas)
        form.addRow("", self.chk_canvas)
        lay.addLayout(form)

        self.lbl_status = QLabel("")
        self.lbl_status.setWordWrap(True)
        lay.addWidget(self.lbl_status)
        self.btns = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        self.btns.button(QDialogButtonBox.Ok).setText("조판 만들기")
        self.btns.button(QDialogButtonBox.Cancel).setText("취소")
        self.btns.accepted.connect(self.accept)
        self.btns.rejected.connect(self.reject)
        lay.addWidget(self.btns)

        self.btn_refresh.clicked.connect(self.reload)
        self.btn_file.clicked.connect(self._pick_file)
        self.cmb_pres.currentIndexChanged.connect(self._fill_slides)
        self.lst.currentRowChanged.connect(self._slide_changed)
        self.reload()

    def done(self, r):
        self._closed = True   # 이후 도착하는 비동기 응답은 무시
        super().done(r)

    # --- 비동기 로드 ---
    def _begin(self, text):
        self._req += 1
        self.loading = True
        self.lbl_status.setText(text)
        for w in (self.btn_refresh, self.btn_file, self.cmb_pres, self.lst):
            w.setEnabled(False)
        self.btns.button(QDialogButtonBox.Ok).setEnabled(False)
        return self._req

    def _end(self):
        self.loading = False
        for w in (self.btn_refresh, self.btn_file, self.cmb_pres, self.lst):
            w.setEnabled(True)
        self.btns.button(QDialogButtonBox.Ok).setEnabled(True)

    def _stale(self, tok):
        return self._closed or tok != self._req

    def reload(self):
        tok = self._begin("PowerPoint에서 프레젠테이션/슬라이드 정보를 읽는 중… (큰 파일은 시간이 걸립니다)")
        tasks.run_async("Slide Map: PowerPoint 목록 읽기",
                        lambda cancel: ppt_com.list_presentations(with_shapes=True, cancel=cancel),
                        lambda exc, res: self._on_list(tok, exc, res))

    def _on_list(self, tok, exc, res):
        if self._stale(tok):
            return
        self._end()
        self.cmb_pres.blockSignals(True)
        self.cmb_pres.clear()
        self.lst.clear()
        self._pres = []
        if exc is not None or res is None:
            self.lbl_status.setText("PowerPoint 연결 실패: %s\n(PowerPoint를 실행하거나 '파일 선택…'을 쓰세요)"
                                    % error_text(exc))
        else:
            self._pres = res
            for p in self._pres:
                self.cmb_pres.addItem(p["name"], p["fullName"])
            self.lbl_status.setText("PowerPoint에서 %d개 프레젠테이션을 찾았습니다." % len(self._pres))
        self.cmb_pres.blockSignals(False)
        self._fill_slides()

    def _pick_file(self):
        path, _ = QFileDialog.getOpenFileName(self, "프레젠테이션 선택", "", "PowerPoint (*.pptx *.pptm *.ppt)")
        if not path:
            return
        tok = self._begin("파일을 읽는 중…")
        tasks.run_async("Slide Map: 파일 슬라이드 읽기",
                        lambda cancel: ppt_com.list_slides(path, with_shapes=True, cancel=cancel),
                        lambda exc, res: self._on_file(tok, exc, res))

    def _on_file(self, tok, exc, res):
        if self._stale(tok):
            return
        self._end()
        if exc is not None or res is None:
            self.lbl_status.setText("파일을 읽지 못했습니다: %s" % error_text(exc))
            return
        entry = {"name": res["name"], "fullName": res["fullName"], "slides": res["slides"]}
        self._pres = [p for p in self._pres if p["fullName"].lower() != entry["fullName"].lower()] + [entry]
        self.cmb_pres.blockSignals(True)
        i = self.cmb_pres.findData(entry["fullName"])
        if i < 0:
            self.cmb_pres.addItem(entry["name"], entry["fullName"])
            i = self.cmb_pres.count() - 1
        self.cmb_pres.setCurrentIndex(i)
        self.cmb_pres.blockSignals(False)
        self._fill_slides()

    def _current_pres(self):
        i = self.cmb_pres.currentIndex()
        if i < 0:
            return None
        full = self.cmb_pres.itemData(i)
        return next((p for p in self._pres if p["fullName"] == full), None)

    def _fill_slides(self):
        self.lst.clear()
        p = self._current_pres()
        if not p:
            return
        for s in p["slides"]:
            it = QListWidgetItem("%d  %s" % (s["index"], s["title"] or "(제목 없음)"))
            it.setData(Qt.UserRole, s)
            self.lst.addItem(it)
        if self.lst.count():
            self.lst.setCurrentRow(0)

    def _slide_changed(self, row):
        """슬라이드를 고르면 (이미 읽어 둔) 도형 목록으로 프레임 후보를 채운다. COM 호출 없음."""
        self.cmb_frame.clear()
        self.cmb_frame.addItem(self.AUTO, None)
        self._shapes = []
        it = self.lst.currentItem()
        if not it:
            return
        self._shapes = it.data(Qt.UserRole).get("shapes") or []
        fs, basis = ppt_com.find_frame(self._shapes)
        for sh in self._shapes:
            tag = "  [%s]" % sh["part"] if sh.get("part") else ""
            self.cmb_frame.addItem("%s%s  (%.0f,%.0f %.0f×%.0f pt)" % (
                sh["name"], tag, sh["left"], sh["top"], sh["width"], sh["height"]), sh["name"])
        if fs:
            self.lbl_status.setText("자동 프레임: '%s' (%s)" % (fs["name"], basis))
        else:
            self.lbl_status.setText("프레임으로 쓸 도형이 없어 페이지 여백 영역에 지도를 둡니다. 도형을 직접 고를 수 있습니다.")

    def accept(self):
        if self.loading:
            return
        if not self._current_pres() or not self.lst.currentItem():
            QMessageBox.information(self, "Slide Map Bridge", "슬라이드를 선택하세요.")
            return
        super().accept()

    def result_params(self):
        p, it = self._current_pres(), self.lst.currentItem()
        s = it.data(Qt.UserRole)
        return {
            "pptx": p["fullName"], "slide_index": s["index"], "slide_id": s.get("id"),
            "frame_name": self.cmb_frame.currentData(), "scale": self.spn_scale.value(),
            "use_canvas": self.chk_canvas.isChecked(),
        }


class SendToSlideDialog(QDialog):
    """조판 지도 -> 슬라이드 옵션."""

    def __init__(self, parent, layouts, current_name=None):
        super().__init__(parent)
        self.setWindowTitle("조판 → 슬라이드")
        self.setMinimumWidth(460)
        lay = QVBoxLayout(self)
        form = QFormLayout()
        self.cmb_layout = QComboBox()
        for l in layouts:
            link = lb.get_link(l)
            self.cmb_layout.addItem("%s   → %s #%d" % (l.name(), os.path.basename(link["pptx"].rstrip("/")), link["slide_index"]), l.name())
        if current_name:
            i = self.cmb_layout.findData(current_name)
            if i >= 0:
                self.cmb_layout.setCurrentIndex(i)
        form.addRow("조판", self.cmb_layout)
        self.spn_dpi = QSpinBox()
        self.spn_dpi.setRange(72, 1200)
        self.spn_dpi.setValue(300)
        self.spn_dpi.setSuffix(" dpi")
        form.addRow("해상도", self.spn_dpi)
        self.cmb_fmt = QComboBox()
        self.cmb_fmt.addItem("PNG (래스터, 권장)", "png")
        self.cmb_fmt.addItem("SVG (벡터, 슬라이드에서 편집 가능)", "svg")
        form.addRow("형식", self.cmb_fmt)
        self.chk_transp = QCheckBox("투명 배경 (지도 배경 흰색 제거)")
        self.chk_others = QCheckBox("지도 영역과 겹치는 다른 조판 항목(축척, 범례 등)도 포함")
        self.chk_orig = QCheckBox("슬라이드의 원래 프레임 위치에 맞춤 (끄면 조판에서 지도 항목의 현재 위치)")
        self.chk_save = QCheckBox("삽입 후 프레젠테이션 저장")
        for c in (self.chk_transp, self.chk_others, self.chk_orig, self.chk_save):
            form.addRow("", c)
        lay.addLayout(form)
        note = QLabel("같은 조판에서 보낸 이전 결과(SLIDEMAP_PART=qgis)는 새 그림이 들어간 뒤 교체됩니다. 프레젠테이션이 닫혀 있으면 PowerPoint에서 엽니다.")
        note.setWordWrap(True)
        lay.addWidget(note)
        b = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        b.button(QDialogButtonBox.Ok).setText("슬라이드로 보내기")
        b.button(QDialogButtonBox.Cancel).setText("취소")
        b.accepted.connect(self.accept)
        b.rejected.connect(self.reject)
        lay.addWidget(b)

    def result_params(self):
        return {
            "layout_name": self.cmb_layout.currentData(), "dpi": self.spn_dpi.value(),
            "fmt": self.cmb_fmt.currentData(), "transparent": self.chk_transp.isChecked(),
            "include_others": self.chk_others.isChecked(), "use_original_frame": self.chk_orig.isChecked(),
            "save": self.chk_save.isChecked(),
        }


class LayerExportDialog(QDialog):
    """레이어 -> EPSG:4326 GeoPackage/GeoJSON."""

    def __init__(self, parent, layers, visible_ids, default_folder):
        super().__init__(parent)
        self.setWindowTitle("Slide Map용 레이어 내보내기")
        self.setMinimumWidth(480)
        self._layers = layers
        lay = QVBoxLayout(self)
        lay.addWidget(QLabel("내보낼 벡터 레이어 (EPSG:4326으로 변환):"))
        self.lst = QListWidget()
        for l in layers:
            it = QListWidgetItem(l.name())
            it.setFlags(it.flags() | Qt.ItemIsUserCheckable)
            it.setCheckState(Qt.Checked if l.id() in visible_ids else Qt.Unchecked)
            self.lst.addItem(it)
        lay.addWidget(self.lst)
        row = QHBoxLayout()
        for text, fn in (("모두", lambda: self._set_all(Qt.Checked)), ("없음", lambda: self._set_all(Qt.Unchecked)),
                         ("보이는 레이어", lambda: self._set_visible(visible_ids))):
            b = QPushButton(text)
            b.clicked.connect(fn)
            row.addWidget(b)
        row.addStretch(1)
        lay.addLayout(row)
        form = QFormLayout()
        self.cmb_fmt = QComboBox()
        self.cmb_fmt.addItem("GeoPackage (.gpkg)", "gpkg")
        self.cmb_fmt.addItem("GeoJSON (.geojson)", "geojson")
        form.addRow("형식", self.cmb_fmt)
        fr = QHBoxLayout()
        self.txt_folder = QLineEdit(default_folder)
        bb = QPushButton("찾아보기…")
        bb.clicked.connect(self._browse)
        fr.addWidget(self.txt_folder, 1)
        fr.addWidget(bb)
        form.addRow("저장 폴더", fr)
        lay.addLayout(form)
        b = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        b.button(QDialogButtonBox.Ok).setText("내보내기")
        b.button(QDialogButtonBox.Cancel).setText("취소")
        b.accepted.connect(self.accept)
        b.rejected.connect(self.reject)
        lay.addWidget(b)

    def _set_all(self, st):
        for i in range(self.lst.count()):
            self.lst.item(i).setCheckState(st)

    def _set_visible(self, ids):
        for i, l in enumerate(self._layers):
            self.lst.item(i).setCheckState(Qt.Checked if l.id() in ids else Qt.Unchecked)

    def _browse(self):
        d = QFileDialog.getExistingDirectory(self, "저장 폴더", self.txt_folder.text())
        if d:
            self.txt_folder.setText(d)

    def result_params(self):
        sel = [self._layers[i] for i in range(self.lst.count()) if self.lst.item(i).checkState() == Qt.Checked]
        return {"layers": sel, "fmt": self.cmb_fmt.currentData(), "folder": self.txt_folder.text().strip()}
