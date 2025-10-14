from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.api_v1 import api_router
from app.core.config import get_settings
from sqlalchemy import text

from app.core.database import Base, engine

settings = get_settings()

app = FastAPI(title=settings.app_name)
app.include_router(api_router, prefix=settings.api_v1_prefix)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def on_startup() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        result = await conn.execute(text("PRAGMA table_info('system_credentials')"))
        columns = {row[1] for row in result}
        if "login_endpoint" not in columns:
            await conn.execute(text("ALTER TABLE system_credentials ADD COLUMN login_endpoint VARCHAR NOT NULL DEFAULT ''"))
            await conn.execute(
                text(
                    """
                    UPDATE system_credentials
                    SET login_endpoint = (
                        SELECT ip_address FROM systems WHERE systems.id = system_credentials.system_id
                    )
                    WHERE login_endpoint = ''
                    """
                )
            )
