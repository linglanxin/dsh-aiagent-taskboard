@echo off
setlocal
set "AIAGENT_LINE="
for /f "usebackq delims=" %%i in (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "F:\aiagent\bin\resolve-session.ps1" -Agent claudecode`) do set "AIAGENT_LINE=%%i"
for /f "tokens=1,2,* delims=|" %%a in ("%AIAGENT_LINE%") do (
  set "AIDIR=%%a"
  set "AIEXE=%%b"
)
echo RESOLVED_DIR=[%AIDIR%]
echo RESOLVED_EXE=[%AIEXE%]
set "AIAGENT_TASKID=debugtask-1"
pushd "%AIDIR%"
"%AIEXE%" -p "reply with exactly OK" >nul 2>&1
set "AIAGENTEXIT=%ERRORLEVEL%"
echo AFTER_RUN_EXIT=[%AIAGENTEXIT%]
echo AFTER_RUN_TASKID=[%AIAGENT_TASKID%]
echo AFTER_RUN_AIDIR=[%AIDIR%]
popd
echo AFTER_POPD_TASKID=[%AIAGENT_TASKID%]
endlocal
