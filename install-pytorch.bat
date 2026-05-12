@echo off
title Solarys - Install PyTorch deps for Panel Inspection
cd /d "%~dp0backend"

if not exist "venv\Scripts\activate.bat" (
    echo ERROR: venv not found. Run start-backend.bat first.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat

echo.
echo Installing torch + torchvision + timm (CPU wheels)...
echo This may take 5-10 minutes the first time (~700 MB download).
echo.

pip install torch==2.2.2 torchvision==0.17.2 --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 (
    echo ERROR: torch install failed.
    pause
    exit /b 1
)

pip install timm==1.0.11
if errorlevel 1 (
    echo ERROR: timm install failed.
    pause
    exit /b 1
)

echo.
echo Installing scikit-learn + joblib (battery SoH model needs them)...
pip install scikit-learn==1.5.2 joblib==1.4.2
if errorlevel 1 (
    echo ERROR: sklearn install failed.
    pause
    exit /b 1
)

echo.
echo ====================================================
echo   All Python deps installed.
echo   Now restart the backend with: start-backend.bat
echo ====================================================
pause
