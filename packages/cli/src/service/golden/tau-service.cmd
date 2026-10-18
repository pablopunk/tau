@echo off
set "PATH=C:\bin;C:\tools"
"C:\node\node.exe" "C:\tau\bin.js" "serve" "--service" "--no-open"
exit /b %ERRORLEVEL%
