import os
import sys
import uvicorn
import socket

# SET DATABASE_URL BEFORE importing app modules!
# This ensures db.py uses SQLite instead of defaulting to PostgreSQL
if not os.getenv("DATABASE_URL"):
    # Get the directory where the executable is running from
    if getattr(sys, 'frozen', False):
        # Running as compiled executable
        base_dir = os.path.dirname(sys.executable)
    else:
        # Running as script
        base_dir = os.path.dirname(os.path.abspath(__file__))
    
    db_path = os.path.join(base_dir, "shabtzak.db")
    # SQLite URL format: sqlite:///absolute/path/to/file.db (3 slashes for absolute)
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    print(f"[INFO] Using SQLite database at: {db_path}")

# Now import the FastAPI app (db.py will read the DATABASE_URL we just set)
from app.main import app as fastapi_app  # noqa: F401

def find_free_port(start_port=8000, max_attempts=10):
    """Find a free port starting from start_port"""
    for port in range(start_port, start_port + max_attempts):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return port
        except OSError:
            continue
    raise RuntimeError(f"Could not find a free port in range {start_port}-{start_port + max_attempts}")

if __name__ == "__main__":
    # Try to use port 8000, but find another if it's in use
    try:
        port = find_free_port(8000)
        if port != 8000:
            print(f"[WARN] Port 8000 in use, using port {port} instead")
    except RuntimeError:
        print("[ERROR] No free ports available")
        sys.exit(1)

    # Run the already-imported FastAPI app so PyInstaller bundles it
    uvicorn.run(fastapi_app, host="127.0.0.1", port=port, reload=False)


