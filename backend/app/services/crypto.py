from cryptography.fernet import Fernet

from app.core.config import get_settings

_settings = get_settings()
_fernet = Fernet(_settings.fernet_key)


def encrypt_secret(secret: str) -> bytes:
    return _fernet.encrypt(secret.encode("utf-8"))


def decrypt_secret(token: bytes) -> str:
    return _fernet.decrypt(token).decode("utf-8")
