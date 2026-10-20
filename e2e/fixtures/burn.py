import sys,time,subprocess
n=int(sys.argv[1]); iters=int(sys.argv[2])
code="x=0\nfor i in range(%d): x+=i*i"%iters
t=time.time()
ps=[subprocess.Popen([sys.executable,"-c",code]) for _ in range(n)]
[p.wait() for p in ps]
print(round(time.time()-t,2))
