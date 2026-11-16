# -*- coding: utf-8 -*-
"""Slide Map 패널에 끌어다 쓸 레이어 내보내기 (EPSG:4326 GeoPackage / GeoJSON)."""
import os

from qgis.core import (
    QgsCoordinateReferenceSystem, QgsCoordinateTransformContext, QgsMapLayer,
    QgsProject, QgsVectorFileWriter, QgsVectorLayer,
)

from .ppt_com import safe_name

FORMATS = {"gpkg": ("GPKG", ".gpkg"), "geojson": ("GeoJSON", ".geojson")}


def _safe(name):
    return safe_name(name, "layer")


def vector_layers(project=None, visible_only=False):
    project = project or QgsProject.instance()
    root = project.layerTreeRoot()
    out = []
    for lyr in project.mapLayers().values():
        if lyr.type() != QgsMapLayer.VectorLayer:
            continue
        node = root.findLayer(lyr.id())
        if visible_only and (node is None or not node.isVisible()):
            continue
        out.append(lyr)
    return out


def export_layers(layers, folder, fmt="gpkg", project=None):
    """각 레이어를 EPSG:4326 으로 내보낸다. 기존 파일은 덮어쓰지 않고 _2, _3 … 번호를 붙인다.
    반환: [(layer명, 경로 또는 None, 오류)]"""
    project = project or QgsProject.instance()
    drv, ext = FORMATS[fmt]
    os.makedirs(folder, exist_ok=True)
    dst = QgsCoordinateReferenceSystem("EPSG:4326")
    results, used = [], set()
    for lyr in layers:
        base = _safe(lyr.name())
        path, i = os.path.join(folder, base + ext), 2
        while path.lower() in used or os.path.exists(path):
            path = os.path.join(folder, "%s_%d%s" % (base, i, ext))
            i += 1
        used.add(path.lower())
        opts = QgsVectorFileWriter.SaveVectorOptions()
        opts.driverName = drv
        opts.fileEncoding = "UTF-8"
        opts.layerName = base
        if lyr.crs().isValid() and lyr.crs() != dst:
            from qgis.core import QgsCoordinateTransform
            opts.ct = QgsCoordinateTransform(lyr.crs(), dst, project)
        if drv == "GeoJSON":
            opts.layerOptions = ["RFC7946=NO", "COORDINATE_PRECISION=8"]
        res = QgsVectorFileWriter.writeAsVectorFormatV3(lyr, path, project.transformContext(), opts)
        if res[0] == QgsVectorFileWriter.NoError:
            results.append((lyr.name(), path, ""))
        else:
            results.append((lyr.name(), None, res[1]))
    return results
