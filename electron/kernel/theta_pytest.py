"""THETA172 pytest plugin: reports tests and results to the app.

Loaded with `python -m pytest -p theta_pytest` (this folder on PYTHONPATH).
Each event is one line on stdout: MARK + JSON. Everything else pytest
prints is ordinary output and is shown as the run's log.
"""

import json
import os
import sys

MARK = "\x1e@theta-test@"


def _send(obj):
    try:
        out = sys.__stdout__
        # A fresh line: pytest's progress dots ("..F") have no newline of their own
        out.write("\n" + MARK + json.dumps(obj, ensure_ascii=False, default=str) + "\n")
        out.flush()
    except Exception:
        pass


def pytest_collection_modifyitems(session, config, items):
    for item in items:
        try:
            _path, lineno, _name = item.location
        except Exception:
            lineno = None
        cls = getattr(item, "cls", None)
        _send({
            "type": "item",
            "nodeid": item.nodeid,
            "file": os.path.abspath(str(getattr(item, "path", None) or item.fspath)),
            "line": (lineno + 1) if isinstance(lineno, int) else None,
            "name": item.name,
            "cls": cls.__name__ if cls else None,
        })


def pytest_collectreport(report):
    if report.failed:
        _send({"type": "collect-error", "nodeid": report.nodeid, "message": str(report.longrepr)[-6000:]})


def pytest_runtest_logstart(nodeid, location):
    _send({"type": "start", "nodeid": nodeid})


def _crash(report):
    crash = getattr(getattr(report, "longrepr", None), "reprcrash", None)
    if crash is None:
        return None, None, None
    return getattr(crash, "message", None), getattr(crash, "path", None), getattr(crash, "lineno", None)


def pytest_runtest_logreport(report):
    # One result per test: the call, or a setup/teardown that failed (or skipped it)
    if report.when == "call" or (report.when == "setup" and not report.passed) or (report.when == "teardown" and report.failed):
        message, path, lineno = _crash(report)
        outcome = report.outcome
        if hasattr(report, "wasxfail"):
            outcome = "xfail" if report.skipped else "xpass"
        if report.skipped and message is None and isinstance(report.longrepr, tuple) and len(report.longrepr) == 3:
            message = str(report.longrepr[2])
        _send({
            "type": "result",
            "nodeid": report.nodeid,
            "outcome": outcome,
            "when": report.when,
            "duration": round(float(getattr(report, "duration", 0) or 0), 4),
            "message": (message or "")[:2000],
            "path": os.path.abspath(path) if path else None,
            "line": lineno,
            "longrepr": str(report.longrepr)[-8000:] if report.failed else "",
            "stdout": (getattr(report, "capstdout", "") or "")[-4000:],
        })


def pytest_sessionfinish(session, exitstatus):
    _send({"type": "finished", "exitstatus": int(exitstatus)})
