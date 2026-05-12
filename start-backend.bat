@echo off
title Solarys Backend (FastAPI)
cd /d "%~dp0backend"

if not exist "venv\Scripts\activate.bat" (
    echo Creating Python virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Could not create venv. Make sure Python 3.10+ is installed.
        pause
        exit /b 1
    )
)

call venv\Scripts\activate.bat

echo.
echo Installing/updating dependencies (this may take a few minutes the first time)...
pip install -q -r requirements.txt
if errorlevel 1 (
    echo ERROR: pip install failed.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   SOLARYS BACKEND - http://localhost:8000
echo ========================================
echo   Docs : http://localhost:8000/docs
echo   Press Ctrl+C to stop.
echo.
uvicorn app.main:app --reload --port 8000
