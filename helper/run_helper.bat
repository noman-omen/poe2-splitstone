@echo off
rem Double-click to start the PoE2 tracker helper. Edit LOG if your game is installed elsewhere.
rem Add --hotkeys for global F1/F2/F3 (split/undo/pause; needs: py -m pip install pynput)
set LOG=
if "%LOG%"=="" (py "%~dp0poe2_splitter.py") else (py "%~dp0poe2_splitter.py" --log "%LOG%")
pause
