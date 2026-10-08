@echo off
setlocal
set "AIAGENT_TASKID="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -File "F:\aiagent\bin\aiagent-log.ps1" -Agent claudecode -Action start -Dir "F:\aiagent\claudecode\_debug"`) do set "AIAGENT_TASKID=%%i"
echo TASKID=[%AIAGENT_TASKID%]
if defined AIAGENT_TASKID powershell -NoProfile -ExecutionPolicy Bypass -File "F:\aiagent\bin\aiagent-log.ps1" -Agent claudecode -Action end -Dir "F:\aiagent\claudecode\_debug" -TaskId "%AIAGENT_TASKID%" -ExitCode 0
echo debug-done
