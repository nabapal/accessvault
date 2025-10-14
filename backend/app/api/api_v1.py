from fastapi import APIRouter

from app.routers import auth, groups, gui, systems, terminal, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(groups.router)
api_router.include_router(gui.router)
api_router.include_router(systems.router)
api_router.include_router(terminal.router)
api_router.include_router(users.router)
