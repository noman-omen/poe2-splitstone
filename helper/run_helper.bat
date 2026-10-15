@echo off
rem Double-click to start Splitstone helper + overlay.
rem Edit LOG if your game is elsewhere. Add --hotkeys for F1/F2/F3 (needs: py -m pip install pynput)
set LOG=
if "%LOG%"=="" (
  py "%~dp0splitstone_helper.py" --overlay
) else (
  py "%~dp0splitstone_helper.py" --overlay --log "%LOG%"
)
pause
