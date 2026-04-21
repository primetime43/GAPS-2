@echo off
echo ===================================
echo  GAPS-2 Windows Build
echo ===================================
echo.

REM Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    exit /b 1
)

REM Check for Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in PATH.
    exit /b 1
)

echo [1/4] Installing Python dependencies...
pip install -r backend\requirements.txt pyinstaller
if %errorlevel% neq 0 (
    echo ERROR: Failed to install Python dependencies.
    exit /b 1
)

echo.
echo [2/4] Installing Angular dependencies...
cd frontend
call npm ci
if %errorlevel% neq 0 (
    echo ERROR: Failed to install Angular dependencies.
    cd ..
    exit /b 1
)

echo.
echo [3/4] Building Angular frontend...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Failed to build Angular frontend.
    cd ..
    exit /b 1
)
cd ..

echo.
echo [4/4] Building Windows executable...
pyinstaller gaps2.spec --noconfirm
if %errorlevel% neq 0 (
    echo ERROR: PyInstaller build failed.
    exit /b 1
)

echo.
echo ===================================
echo  Build complete!
echo  Output: dist\GAPS-2.exe
echo ===================================
echo.
echo Run it with: dist\GAPS-2.exe
echo Then open http://localhost:4277
