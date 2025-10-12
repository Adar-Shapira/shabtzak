# Shabtzak

Scheduling app to organize soldiers and missions in a platoon.

## Structure
- `backend/` — FastAPI + SQLAlchemy + Alembic
- `shabtzak-ui/` — Vite + React (TypeScript)

## Dev quickstart
### Backend
```bash
cd backend
python -m venv .venv && . .venv/Scripts/activate  # Windows PowerShell
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
