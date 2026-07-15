from fastapi import APIRouter

from app.routers import aci, auth, cgnat, groups, gui, inventory, ipmpls, nxos, systems, telco, terminal, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(groups.router)
api_router.include_router(gui.router)
api_router.include_router(inventory.router)
api_router.include_router(aci.router)
api_router.include_router(telco.router)
api_router.include_router(ipmpls.router)
api_router.include_router(nxos.router)
api_router.include_router(cgnat.router)
api_router.include_router(systems.router)
api_router.include_router(terminal.router)
api_router.include_router(users.router)
