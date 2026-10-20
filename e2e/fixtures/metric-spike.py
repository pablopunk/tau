"""Memory metric spike (macOS): the same process seen by ps rss, top, footprint and proc_pid_rusage.

Usage: python3 -I metric-spike.py   (prints a table; each case holds its memory in a child for ~4 s)
"""
import mmap
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rusage  # noqa: E402

MB = 1024 * 1024
CASES = {}


def case(fn):
    CASES[fn.__name__] = fn
    return fn


def touch(buffer, size):
    for offset in range(0, size, 4096):
        buffer[offset] = 1


@case
def private_300mb_touched():
    b = bytearray(300 * MB)
    touch(b, 300 * MB)
    time.sleep(6)


@case
def virtual_300mb_untouched():
    b = bytearray(300 * MB)
    time.sleep(6)


@case
def zero_pages_300mb_written_zero():
    b = bytearray(300 * MB)
    for offset in range(0, 300 * MB, 4096):
        b[offset] = 0
    time.sleep(6)


@case
def shared_mmap_100mb_x4():
    m = mmap.mmap(-1, 100 * MB, flags=mmap.MAP_SHARED | mmap.MAP_ANON)
    touch(m, 100 * MB)
    for _ in range(3):
        if os.fork() == 0:
            sum(m[o] for o in range(0, 100 * MB, 4096))
            time.sleep(6)
            os._exit(0)
    time.sleep(6)


@case
def cow_fork_100mb_x4():
    b = bytearray(100 * MB)
    touch(b, 100 * MB)
    for _ in range(3):
        if os.fork() == 0:
            time.sleep(6)
            os._exit(0)
    time.sleep(6)


def tree(pid):
    out = subprocess.check_output(["ps", "-axo", "pid=,ppid="]).decode().split("\n")
    kids = {}
    for line in out:
        parts = line.split()
        if len(parts) == 2:
            kids.setdefault(int(parts[1]), []).append(int(parts[0]))
    found, todo = [], [pid]
    while todo:
        p = todo.pop()
        found.append(p)
        todo += kids.get(p, [])
    return found


def measure(pids):
    ps_kb = sum(int(x) for x in subprocess.check_output(["ps", "-o", "rss=", "-p", ",".join(map(str, pids))]).split())
    fp = subprocess.run(
        ["/usr/bin/footprint", *[a for p in pids for a in ("-p", str(p))], "--noCategories", "-f", "bytes"],
        capture_output=True, text=True, env={**os.environ, "LC_ALL": "C"},
    ).stdout
    summary = re.search(r"Summary Footprint: (\d+) B", fp)
    per = sum(int(x) for x in re.findall(r"\]: [^\n]*Footprint: (\d+) B", fp))
    footprint = int(summary.group(1)) if summary else per
    rus = sum(rusage.rusage(p)["phys_footprint"] for p in pids)
    top = subprocess.run(["top", "-l", "2", "-s", "0", *[a for p in pids for a in ("-pid", str(p))], "-stats", "pid,mem"],
                         capture_output=True, text=True).stdout
    mems = re.findall(r"^\s*\d+\s+(\d+(?:\.\d+)?)([KMG])", top.split("PID")[-1], re.M)
    unit = {"K": 1 / 1024, "M": 1, "G": 1024}
    top_mb = sum(float(v) * unit[u] for v, u in mems)
    return ps_kb / 1024, top_mb, footprint / MB, rus / MB


if len(sys.argv) > 1:
    CASES[sys.argv[1]]()
    sys.exit(0)

print(f"{'case':34} {'procs':>5} {'ps rss':>8} {'top mem':>8} {'footprint':>10} {'rusage':>8}  (MB, whole tree)")
for name in CASES:
    child = subprocess.Popen([sys.executable, "-I", os.path.abspath(__file__), name])
    time.sleep(2.5)
    pids = tree(child.pid)
    rss, top_mb, fp, rus = measure(pids)
    print(f"{name:34} {len(pids):>5} {rss:>8.0f} {top_mb:>8.0f} {fp:>10.0f} {rus:>8.0f}")
    child.wait()
idle = [subprocess.Popen(["node", "-e", "setTimeout(()=>{},8000)"]) for _ in range(10)]
time.sleep(2)
rss, top_mb, fp, rus = measure([p.pid for p in idle])
print(f"{'ten_idle_node_processes':34} {10:>5} {rss:>8.0f} {top_mb:>8.0f} {fp:>10.0f} {rus:>8.0f}")
for p in idle:
    p.kill()
