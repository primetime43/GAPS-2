# Stage 1: Build Angular frontend
FROM node:18-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend + serve Angular dist
FROM python:3.11-slim
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Copy Angular build output
COPY --from=frontend-build /app/frontend/dist/gaps-2 /app/frontend/dist/gaps-2

EXPOSE 5000

CMD ["python", "run.py"]
