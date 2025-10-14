from pydantic import BaseModel, EmailStr


class TokenPair(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
