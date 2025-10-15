# AccessVault

AccessVault is a secure credential management and remote access portal. It combines a FastAPI backend with a React/Tailwind frontend to organize infrastructure systems, encrypt credentials, and streamline GUI/CLI access from the browser.

## Features
- JWT authentication with role-based access control (admin, user)
- Group and system management with search and filtering
- AES/Fernet encryption for stored credentials
- Browser-based SSH terminal (xterm.js + Paramiko over WebSocket)
- GUI quick-launch helpers for basic-auth protected interfaces
- React dashboard with modals, filters, and responsive layout
- Automated API tests with pytest + httpx

## Project Structure
```
backend/    # FastAPI application
frontend/   # React + Vite + Tailwind SPA
```

## Backend Setup
1. Create and activate a Python 3.11+ virtual environment.
2. Install dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```
3. Configure environment variables based on `backend/.env.example`:
   ```bash
   cp backend/.env.example backend/.env
   # Generate secrets
   python -c "import secrets; print(secrets.token_urlsafe(32))"  # SECRET_KEY
   python -c "import secrets; print(secrets.token_hex(16))"      # PASSWORD_SALT
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # FERNET_KEY
   ```
4. Run database migrations (SQLite default auto-creates tables on startup). For PostgreSQL, configure `DATABASE_URL` accordingly.
5. Create an initial admin user:
   ```bash
   cd backend
   python -m app.scripts.create_admin
   ```
6. Start the API server:
   ```bash
   cd backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8002
   ```

## Frontend Setup
1. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
   The app will proxy API and WebSocket requests to `http://localhost:8002`.

## Production Deployment (Docker)
1. Copy the Docker environment template and fill in secure values:
   ```bash
   cp backend/.env.docker.example backend/.env.docker
   ```
   Ensure `DATABASE_URL` remains `sqlite+aiosqlite:///./data/accessvault.db` so the SQLite file lives in the host-mounted volume.
2. Create a persistent data directory on the host:
   ```bash
   mkdir -p data
   ```
3. Build and start the containers:
   ```bash
   ./deployments/deploy.sh
   ```
   The helper script will prompt for admin credentials, build the images, start the stack, and seed the initial admin user.
      - Backend (FastAPI + Uvicorn) listens on `http://localhost:8005` and stores `data/accessvault.db` on the host.
   - Frontend is served via Nginx on `http://localhost/` with API/WebSocket traffic proxied to the backend.
4. Tail logs or stop the stack as needed:
   ```bash
   docker compose logs -f
   docker compose down
   ```

> **Note:** If you deploy behind a custom domain, update `CORS_ORIGINS` in `backend/.env.docker` accordingly.

## Testing
```bash
cd backend
pytest
```

## Operational Notes
- GUI quick-launch injects credentials only for services that support HTTP Basic Auth URLs. Custom automation may be required for other login methods.
- Web-based SSH relies on Paramiko. Ensure target systems accept the provided credentials and that the API host can reach them.
- Rotate the Fernet key only after re-encrypting stored secrets.

## Next Steps
- Harden GUI automation pathways (e.g., per-application scripts via Playwright).
- Extend audit logging and session tracking.
- Add end-to-end tests for the React frontend.
