import uuid
from enum import Enum as PyEnum

from sqlalchemy import Boolean, Column, Enum, String
from sqlalchemy.types import LargeBinary

from app.core.database import Base
from app.core.types import GUID


class UserRoleEnum(str, PyEnum):
    ADMIN = "admin"
    USER = "user"


class User(Base):
    __tablename__ = "users"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    role = Column(Enum(UserRoleEnum), default=UserRoleEnum.USER, nullable=False)
    totp_secret = Column(LargeBinary, nullable=True)
