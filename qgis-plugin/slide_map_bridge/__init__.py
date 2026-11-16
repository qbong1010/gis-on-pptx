# -*- coding: utf-8 -*-
def classFactory(iface):
    from .plugin import SlideMapBridgePlugin
    return SlideMapBridgePlugin(iface)
