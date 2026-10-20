"""Memory fixtures for the resource e2e. Usage: python3 -I hog.py <mode> <mb> [pidfile]

hog      touch <mb> MB and sleep
escapee  start a setsid child holding <mb> MB (its pid goes to pidfile), then sleep 25 s in the parent
daemon   the child holds 100 MB, the parent exits after 3 s, then the child grows by <mb> MB at 4 s
shared   map <mb> MB shared and touched, fork 3 readers that touch all of it, sleep 6 s (RSS counts it 4 times)
"""
import mmap
import os
import sys
import time

mode, mb = sys.argv[1], int(sys.argv[2])
pidfile = sys.argv[3] if len(sys.argv) > 3 else None
size = mb * 1024 * 1024


def touch(buffer):
    for offset in range(0, len(buffer), 4096):
        buffer[offset] = 1


if mode == "hog":
    data = bytearray(size)
    touch(data)
    print("allocated", flush=True)
    time.sleep(60)
elif mode in ("escapee", "daemon"):
    child = os.fork()
    if child == 0:
        os.setsid()
        data = bytearray(size if mode == "escapee" else 100 * 1024 * 1024)
        touch(data)
        if mode == "daemon":
            time.sleep(4)
            more = bytearray(size)
            touch(more)
        time.sleep(300)
        sys.exit(0)
    open(pidfile, "w").write(str(child))
    print("escapee", child, flush=True)
    time.sleep(25 if mode == "escapee" else 3)
elif mode == "shared":
    region = mmap.mmap(-1, size, flags=mmap.MAP_SHARED | mmap.MAP_ANON)
    touch(region)
    kids = []
    for _ in range(3):
        pid = os.fork()
        if pid == 0:
            total = 0
            for offset in range(0, size, 4096):
                total += region[offset]
            time.sleep(6)
            sys.exit(0)
        kids.append(pid)
    time.sleep(6)
    for pid in kids:
        os.waitpid(pid, 0)
    print("shared done", flush=True)
