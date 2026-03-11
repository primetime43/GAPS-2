@echo off
REM GAPS 2 - Install Dependencies (Windows)
REM Run this once after cloning, or whenever requirements change

setlocal

set ROOT_DIR=%~dp0
set BACKEND_DIR=%ROOT_DIR%backend
set FRONTEND_DIR=%ROOT_DIR%frontend

echo === Backend Dependencies ===

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found. Please install Python 3.9+
    exit /b 1
)

if not exist "%BACKEND_DIR%\venv" (
    echo Creating Python virtual environment...
    python -m venv "%BACKEND_DIR%\venv"
)

call "%BACKEND_DIR%\venv\Scripts\activate.bat"

echo Installing Python packages...
pip install -r "%BACKEND_DIR%\requirements.txt"

echo.
echo === Frontend Dependencies ===

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Please install Node.js 18+
    exit /b 1
)

echo Installing Node packages...
cd /d "%FRONTEND_DIR%"
call npm install

echo.
echo === Done ===
echo All dependencies installed. Run run-dev.bat to start the app.
pause
