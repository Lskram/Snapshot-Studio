@echo off
echo Installing dependencies from requirements.txt...
pip install -r requirements.txt
echo.
echo Starting CapCut Snapshot Studio on port 5001...
python app.py
pause
