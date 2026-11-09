"""THETA172 notebook kernel.

A small kernel that runs notebook cells in one persistent namespace, on
whichever Python the user picked. It needs nothing installed.

Protocol (one JSON object per line):
  app -> kernel (stdin):   {"type": "execute", "id": ..., "code": ...}
                           {"type": "input_reply", "value": ...}
                           {"type": "interrupt"}   {"type": "shutdown"}
  kernel -> app (stdout):  lines starting with MARK, then JSON:
                           ready, stream, display, result, error, input_request, done
Anything else a program writes straight to the process's stdout (a
subprocess, say) arrives as plain lines and is shown as output.
"""

import ast
import base64
import builtins
import io
import json
import linecache
import os
import queue
import sys
import threading
import traceback
import _thread

MARK = "\x1e@theta@"
_out = sys.__stdout__
_out_lock = threading.Lock()
_inputs = queue.Queue()
_running = threading.Event()
_current = {"id": None}
_count = [0]
_KERNEL_FILE = os.path.abspath(__file__)


def send(msg):
    """Send one protocol message to the app (printed text first, so the order is kept)."""
    if msg.get("type") != "stream":
        flush_streams()
    line = MARK + json.dumps(msg, ensure_ascii=False, default=str) + "\n"
    with _out_lock:
        _out.write(line)
        _out.flush()


class Stream(io.TextIOBase):
    """sys.stdout / sys.stderr while a cell runs: text goes to the app as stream messages."""

    def __init__(self, name):
        super().__init__()
        self.name = name
        self._buf = []
        self._size = 0
        self._lock = threading.Lock()

    def writable(self):
        return True

    def write(self, text):
        if not isinstance(text, str):
            text = str(text)
        if text:
            with self._lock:
                self._buf.append(text)
                self._size += len(text)
            # Whole lines go out at once; partial lines within 0.2 s (see flusher)
            if "\n" in text or "\r" in text or self._size > 8192:
                self.flush()
        return len(text)

    def flush(self):
        with self._lock:
            if not self._buf:
                return
            text = "".join(self._buf)
            self._buf.clear()
            self._size = 0
        send({"type": "stream", "id": _current["id"], "name": self.name, "text": text})

    @property
    def encoding(self):
        return "utf-8"

    def isatty(self):
        return False


# ── Rich display ─────────────────────────────────────────────────────

def mime_bundle(obj):
    """The richest representations an object offers (like IPython)."""
    data = {}
    for method, mime in (("_repr_html_", "text/html"), ("_repr_markdown_", "text/markdown"),
                         ("_repr_svg_", "image/svg+xml"), ("_repr_latex_", "text/latex")):
        fn = getattr(obj, method, None)
        if callable(fn):
            try:
                value = fn()
                if isinstance(value, tuple):
                    value = value[0]
                if value:
                    data[mime] = value
            except Exception:
                pass
    for method, mime in (("_repr_png_", "image/png"), ("_repr_jpeg_", "image/jpeg")):
        fn = getattr(obj, method, None)
        if callable(fn):
            try:
                value = fn()
                if isinstance(value, tuple):
                    value = value[0]
                if value:
                    data[mime] = base64.b64encode(value).decode("ascii") if isinstance(value, bytes) else value
            except Exception:
                pass
    # A matplotlib Figure shows as a picture
    if type(obj).__name__ == "Figure" and hasattr(obj, "savefig"):
        png = figure_png(obj)
        if png:
            data["image/png"] = png
    try:
        data["text/plain"] = repr(obj)
    except Exception as err:
        data["text/plain"] = f"<unprintable {type(obj).__name__}: {err}>"
    return data


def figure_png(fig):
    buf = io.BytesIO()
    try:
        fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
    except Exception:
        return None
    return base64.b64encode(buf.getvalue()).decode("ascii")


def display(*objs, **_kwargs):
    """Show objects below the cell (like IPython's display)."""
    for obj in objs:
        send({"type": "display", "id": _current["id"], "data": mime_bundle(obj)})


def flush_figures():
    """Send open matplotlib figures as pictures, then close them."""
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    try:
        for num in plt.get_fignums():
            png = figure_png(plt.figure(num))
            if png:
                send({"type": "display", "id": _current["id"], "data": {"image/png": png, "text/plain": f"<Figure {num}>"}})
        plt.close("all")
    except Exception:
        pass


def patch_matplotlib():
    """plt.show() sends the figures at that point (keeps output in order)."""
    plt = sys.modules.get("matplotlib.pyplot")
    current = getattr(plt, "show", None)  # None while pyplot is still being imported
    if current is not None and not getattr(current, "_theta", False):
        def show(*_args, **_kwargs):
            flush_figures()
        show._theta = True
        plt.show = show


_streams = []


def flush_streams():
    for s in _streams:
        try:
            s.flush()
        except Exception:
            pass


def flusher():
    """Text printed without a newline (print(..., end="")) still shows up quickly."""
    while True:
        threading.Event().wait(0.2)
        flush_streams()


# ── input() ──────────────────────────────────────────────────────────

def kernel_input(prompt=""):
    prompt = str(prompt)
    flush_streams()
    send({"type": "input_request", "id": _current["id"], "prompt": prompt})
    value = _inputs.get()
    if value is None:
        raise KeyboardInterrupt
    send({"type": "stream", "id": _current["id"], "name": "stdout", "text": prompt + value + "\n"})
    return value


# ── Running a cell ───────────────────────────────────────────────────

def clean_traceback(exc):
    """The error as students need it: frames from the kernel itself are hidden."""
    tb = traceback.TracebackException.from_exception(exc)
    tb.stack = traceback.StackSummary.from_list([f for f in tb.stack if os.path.abspath(f.filename) != _KERNEL_FILE])
    return "".join(tb.format())


def execute(msg_id, code, ns):
    _count[0] += 1
    n = _count[0]
    filename = f"<cell {n}>"
    # Tracebacks show the cell's lines
    linecache.cache[filename] = (len(code), None, code.splitlines(True), filename)
    _current["id"] = msg_id
    status = "ok"
    try:
        tree = ast.parse(code, filename, "exec")
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        exec(compile(tree, filename, "exec"), ns)
        if last is not None:
            value = eval(compile(last, filename, "eval"), ns)
            if value is not None:
                ns["_"] = value
                # A figure as the result is shown once, as the result
                plt = sys.modules.get("matplotlib.pyplot")
                if plt is not None and type(value).__name__ == "Figure":
                    try:
                        plt.close(value)
                    except Exception:
                        pass
                flush_figures()
                send({"type": "result", "id": msg_id, "count": n, "data": mime_bundle(value)})
        flush_figures()
    except KeyboardInterrupt:
        status = "error"
        send({"type": "error", "id": msg_id, "ename": "KeyboardInterrupt", "evalue": "Stopped", "traceback": "KeyboardInterrupt: stopped by you\n"})
    except BaseException as exc:  # noqa: BLE001 - report everything, including SystemExit
        status = "error"
        send({"type": "error", "id": msg_id, "ename": type(exc).__name__, "evalue": str(exc), "traceback": clean_traceback(exc)})
    finally:
        flush_streams()
        send({"type": "done", "id": msg_id, "count": n, "status": status})
        _current["id"] = None


def reader(commands, control):
    """Read the app's messages: interrupts and input replies act at once, the rest queue up."""
    for line in control:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        kind = msg.get("type")
        if kind == "interrupt":
            _inputs.put(None)  # also unblocks a waiting input()
            if _running.is_set():
                _thread.interrupt_main()
        elif kind == "input_reply":
            _inputs.put(str(msg.get("value", "")))
        else:
            commands.put(msg)
    commands.put({"type": "shutdown"})


def watch_imports():
    """Patch plt.show() as soon as matplotlib.pyplot is imported, so the first show() is in order too."""
    original = builtins.__import__

    def importer(name, *args, **kwargs):
        module = original(name, *args, **kwargs)
        if "matplotlib" in name and "matplotlib.pyplot" in sys.modules:
            patch_matplotlib()
        return module

    builtins.__import__ = importer


def main():
    ns = {"__name__": "__main__", "__builtins__": builtins, "display": display}
    os.environ.setdefault("MPLBACKEND", "Agg")  # plots become pictures, never windows
    cwd = os.getcwd()
    if cwd not in sys.path:
        sys.path.insert(0, cwd)
    builtins.input = kernel_input
    watch_imports()
    # The app's messages arrive on stdin. Keep a private copy (programs started
    # from a cell don't inherit it) and give those programs an empty stdin:
    # on Windows, starting a process that inherits a pipe another thread is
    # reading from blocks forever.
    control = os.fdopen(os.dup(0), "r", encoding="utf-8", newline="\n")
    empty = os.open(os.devnull, os.O_RDONLY)
    os.dup2(empty, 0)
    os.close(empty)
    sys.stdin = open(os.devnull, encoding="utf-8")
    sys.stdout = Stream("stdout")
    sys.stderr = Stream("stderr")
    _streams.extend([sys.stdout, sys.stderr])
    threading.Thread(target=flusher, daemon=True).start()
    commands = queue.Queue()
    threading.Thread(target=reader, args=(commands, control), daemon=True).start()
    send({"type": "ready", "python": sys.version.split()[0], "executable": sys.executable})
    while True:
        try:
            msg = commands.get()
        except KeyboardInterrupt:
            continue
        if msg.get("type") == "shutdown":
            break
        if msg.get("type") == "execute":
            while not _inputs.empty():  # stale input from an earlier cell
                _inputs.get_nowait()
            _running.set()
            try:
                execute(msg.get("id"), str(msg.get("code", "")), ns)
            except KeyboardInterrupt:
                # an interrupt that landed between cells
                send({"type": "done", "id": msg.get("id"), "count": _count[0], "status": "error"})
            finally:
                _running.clear()


if __name__ == "__main__":
    main()
