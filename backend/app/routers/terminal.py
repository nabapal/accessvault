import asyncio
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.models import System
from app.models.system import AccessType as ModelAccessType
from app.services.ssh import ssh_connection

router = APIRouter(prefix="/terminal", tags=["terminal"])
settings = get_settings()


async def _authenticate_websocket(token: str) -> UUID:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        subject = payload.get("sub")
        if subject is None:
            raise ValueError("Missing subject")
        return UUID(subject)
    except (JWTError, ValueError) as exc:  # noqa: F841
        raise HTTPException(status_code=403, detail="Invalid token") from exc


@router.websocket("/{system_id}")
async def terminal_websocket(websocket: WebSocket, system_id: UUID, token: Optional[str] = Query(default=None)):
    if token is None:
        await websocket.close(code=4001)
        return
    try:
        await _authenticate_websocket(token)
    except HTTPException:
        await websocket.close(code=4003)
        return
    await websocket.accept()
    async with AsyncSessionLocal() as session:
        system = await session.get(System, system_id, options=[selectinload(System.credentials)])
        if system is None:
            await websocket.send_text("System not found")
            await websocket.close(code=4404)
            return
        credential = next(
            (
                cred
                for cred in system.credentials
                if cred.access_scope in {ModelAccessType.CLI, ModelAccessType.BOTH}
            ),
            None,
        )
        if credential is None:
            await websocket.send_text("CLI credential not configured")
            await websocket.close(code=4403)
            return
        host = credential.login_endpoint or system.ip_address
        async with ssh_connection(
            host=host,
            username=credential.user_id,
            secret=credential.credential_secret,
        ) as channel:
            try:
                async def read_from_channel():
                    while True:
                        if channel.recv_ready():
                            data = await asyncio.get_event_loop().run_in_executor(None, channel.recv, 1024)
                            if not data:
                                break
                            await websocket.send_text(data.decode("utf-8", errors="ignore"))
                        await asyncio.sleep(0.05)

                async def write_to_channel():
                    while True:
                        message = await websocket.receive_text()
                        await asyncio.get_event_loop().run_in_executor(None, channel.send, message)

                await asyncio.gather(read_from_channel(), write_to_channel())
            except WebSocketDisconnect:
                pass
            finally:
                await websocket.close()
