
FROM node:22-bookworm-slim AS frontend

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY src/nexora.json src/nexora.json
COPY --from=frontend /app/dist /app/dist

EXPOSE 10000

CMD ["sh", "-c", "python -m uvicorn app:app --app-dir backend --host 0.0.0.0 --port ${PORT:-10000}"]
