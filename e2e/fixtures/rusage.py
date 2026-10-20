"""Prints this process's QoS CPU time bands and footprint (macOS proc_pid_rusage, RUSAGE_INFO_V4).

Usage: python3 -I rusage.py [burn-iterations]
"""
import ctypes
import json
import os
import sys

NAMES = [
    "uuid0", "uuid1", "user_time", "system_time", "pkg_idle_wkups", "interrupt_wkups", "pageins",
    "wired_size", "resident_size", "phys_footprint", "proc_start_abstime", "proc_exit_abstime",
    "child_user_time", "child_system_time", "child_pkg_idle_wkups", "child_interrupt_wkups",
    "child_pageins", "child_elapsed_abstime", "diskio_bytesread", "diskio_byteswritten",
    "qos_default", "qos_maintenance", "qos_background", "qos_utility", "qos_legacy",
    "qos_user_initiated", "qos_user_interactive", "billed_system_time", "serviced_system_time",
    "logical_writes", "lifetime_max_phys_footprint", "instructions", "cycles", "billed_energy",
    "serviced_energy", "interval_max_phys_footprint", "runnable_time",
]


def rusage(pid):
    buffer = (ctypes.c_uint64 * len(NAMES))()
    lib = ctypes.CDLL("/usr/lib/libproc.dylib")
    if lib.proc_pid_rusage(pid, 4, ctypes.byref(buffer)) != 0:
        raise OSError(ctypes.get_errno(), "proc_pid_rusage")
    return dict(zip(NAMES, buffer))


if __name__ == "__main__":
    x = 0
    for i in range(int(sys.argv[1]) if len(sys.argv) > 1 else 3_000_000):
        x += i * i
    data = rusage(os.getpid())
    bands = {k: v for k, v in data.items() if k.startswith("qos_")}
    total = sum(bands.values()) or 1
    print(json.dumps({"bands": {k[4:]: round(v / total, 3) for k, v in bands.items() if v}, "footprint": data["phys_footprint"]}))
