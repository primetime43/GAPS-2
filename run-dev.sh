#!/usr/bin/env bash
# GAPS 2 - Local Development Runner
# Starts both the Flask backend and Angular frontend dev servers

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

# --- Backend setup ---
echo -e "${GREEN}=== Setting up Backend ===${NC}"

if ! command -v python &>/dev/null && ! command -v python3 &>/dev/null; then
    echo -e "${RED}Python not found. Please install Python 3.9+${NC}"
    exit 1
fi

PYTHON=$(command -v python3 || command -v python)

# Create virtual environment if it doesn't exist
if [ ! -d "$BACKEND_DIR/venv" ]; then
    echo "Creating Python virtual environment..."
    "$PYTHON" -m venv "$BACKEND_DIR/venv"
fi

# Activate venv and install deps
if [ -f "$BACKEND_DIR/venv/Scripts/activate" ]; then
    # Windows (Git Bash / MSYS)
    source "$BACKEND_DIR/venv/Scripts/activate"
else
    source "$BACKEND_DIR/venv/bin/activate"
fi


# --- Frontend setup ---
echo -e "${GREEN}=== Setting up Frontend ===${NC}"

if ! command -v node &>/dev/null; then
    echo -e "${RED}Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "Installing Node dependencies..."
    (cd "$FRONTEND_DIR" && npm install)
fi

# --- Start servers ---
echo ""
echo -e "${GREEN}=== Starting Servers ===${NC}"

# Start backend
echo -e "Starting Flask backend on ${YELLOW}http://localhost:4277${NC}"
(cd "$BACKEND_DIR" && "$PYTHON" run.py) &
BACKEND_PID=$!

# Give backend a moment to start
sleep 2

# Start frontend
echo -e "Starting Angular frontend on ${YELLOW}http://localhost:4200${NC}"
(cd "$FRONTEND_DIR" && npx ng serve --proxy-config proxy.conf.json --open) &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}Both servers are running!${NC}"
echo -e "  Frontend: ${YELLOW}http://localhost:4200${NC}"
echo -e "  Backend:  ${YELLOW}http://localhost:4277${NC}"
echo ""
echo "Press Ctrl+C to stop both servers."

wait
