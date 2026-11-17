# -*- coding: utf-8 -*-
# SPDX-License-Identifier: GPL-2.0-or-later
# Slide Map Bridge — QGIS 조판 ↔ PowerPoint 슬라이드 연동 (gis-on-pptx)
# Copyright (C) 2026 qbong1010
#
# This program is free software; you can redistribute it and/or modify it under the terms of the
# GNU General Public License as published by the Free Software Foundation; either version 2 of the
# License, or (at your option) any later version. See the LICENSE file in this directory.
def classFactory(iface):
    from .plugin import SlideMapBridgePlugin
    return SlideMapBridgePlugin(iface)
