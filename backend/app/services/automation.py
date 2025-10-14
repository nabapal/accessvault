from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.config import get_settings

settings = get_settings()
serializer = URLSafeTimedSerializer(settings.secret_key + settings.password_salt)


def issue_gui_token(system_id: str, username: str, password: str, url: str) -> str:
    payload = {
        "system_id": system_id,
        "username": username,
        "password": password,
        "url": url,
    }
    return serializer.dumps(payload)


def read_gui_token(token: str, max_age: int = 60) -> dict:
    try:
        return serializer.loads(token, max_age=max_age)
    except (BadSignature, SignatureExpired) as exc:  # noqa: F841
        raise ValueError("Invalid or expired token") from exc
