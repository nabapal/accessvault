import json
from functools import lru_cache
from typing import List, Optional, Union

from pydantic import AnyUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "AccessVault"
    api_v1_prefix: str = "/api/v1"
    secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_minutes: int = 60 * 24
    database_url: str = "sqlite+aiosqlite:///./accessvault.db"
    password_salt: str
    fernet_key: str
    cors_origins: List[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    websocket_origin: Optional[AnyUrl] = None
    inventory_poller_enabled: bool = True
    inventory_poll_tick_seconds: int = Field(default=15, ge=5, le=300)
    telco_poller_enabled: bool = True
    telco_poll_tick_seconds: int = Field(default=30, ge=5, le=600)
    apic_host: Optional[str] = None
    apic_username: Optional[str] = None
    apic_password: Optional[str] = None
    apic_verify_ssl: bool = False
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Optional[Union[str, List[str]]]) -> List[str]:
        if value is None:
            return ["http://localhost:5173"]
        if isinstance(value, list):
            return value
        value = value.strip()
        if not value:
            return []
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(origin) for origin in parsed]
        except json.JSONDecodeError:
            pass
        return [origin.strip() for origin in value.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
