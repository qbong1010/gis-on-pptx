# -*- coding: utf-8 -*-
"""느린 작업(PowerPoint COM)을 QgsTask 로 백그라운드 실행. QGIS 작업 관리자에 진행/취소 UI가 표시된다.

on_done(exc, value) 는 항상 메인 스레드에서 호출된다. 취소/무응답이면 value 가 None 이다.
"""
from qgis.core import QgsApplication, QgsTask

_alive = set()   # 파이썬 쪽에서 작업 객체를 붙잡아 GC 로 사라지지 않게 한다


def run_async(description, fn, on_done, cancelable=True):
    """fn(cancel) 을 백그라운드에서 실행. cancel 은 호출하면 취소 여부(bool)를 돌려주는 함수 (취소 불가면 None)."""
    holder = {}

    def work(task):
        return fn(task.isCanceled if cancelable else None)

    def finished(exception, value=None):
        _alive.discard(holder.get("task"))
        on_done(exception, value)

    flags = QgsTask.CanCancel if cancelable else QgsTask.Flags()
    task = QgsTask.fromFunction(description, work, on_finished=finished, flags=flags)
    holder["task"] = task
    _alive.add(task)
    QgsApplication.taskManager().addTask(task)
    return task
