@echo off
REM GAPS 2 - Local Development Runner (Windows)
REM Starts both the Flask backend and Angular frontend dev servers

setlocal

set ROOT_DIR=%~dp0
set BACKEND_DIR=%ROOT_DIR%backend
set FRONTEND_DIR=%ROOT_DIR%frontend

echo === Setting up Backend ===

REM Check Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found. Please install Python 3.9+
    exit /b 1
)

REM Create virtual environment if needed
if not exist "%BACKEND_DIR%\venv" (
    echo Creating Python virtual environment...
    python -m venv "%BACKEND_DIR%\venv"
)

REM Install Python deps
echo Installing Python dependencies...
call "%BACKEND_DIR%\venv\Scripts\activate.bat"
pip install -q -r "%BACKEND_DIR%\requirements.txt"

echo.
echo === Setting up Frontend ===

REM Check Node
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Please install Node.js 18+
    exit /b 1
)

REM Install Node deps if needed
if not exist "%FRONTEND_DIR%\node_modules" (
    echo Installing Node dependencies...
    cd /d "%FRONTEND_DIR%"
    call npm install
)

echo.
echo === Starting Servers ===
echo.

REM Start backend in a new window
echo Starting Flask backend on http://localhost:5000
start "GAPS2 Backend" cmd /k "cd /d "%BACKEND_DIR%" && call venv\Scripts\activate.bat && python run.py"

REM Wait for backend to start
timeout /t 3 /nobreak >nul

REM Start frontend in a new window
echo Starting Angular frontend on http://localhost:4200
start "GAPS2 Frontend" cmd /k "cd /d "%FRONTEND_DIR%" && npx ng serve --proxy-config proxy.conf.json --open"

echo.
echo Both servers are running!
echo   Frontend: http://localhost:4200
echo   Backend:  http://localhost:5000
echo.
echo Close the server windows to stop them.
pause
