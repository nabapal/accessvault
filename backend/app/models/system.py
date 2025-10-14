import uuid
from enum import Enum as PyEnum

from sqlalchemy import Column, Enum, ForeignKey, LargeBinary, String
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.types import GUID


class AccessType(str, PyEnum):
    GUI = "gui"
    CLI = "cli"
    BOTH = "both"


class System(Base):
    __tablename__ = "systems"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    group_id = Column(GUID(), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    ip_address = Column(String, nullable=False)
    url = Column(String, nullable=True)
    username = Column(String, nullable=False, default="")
    access_type = Column(Enum(AccessType), nullable=False, default=AccessType.GUI)
    credential_secret = Column(LargeBinary, nullable=True)

    group = relationship("Group", back_populates="systems")
    credentials = relationship("SystemCredential", back_populates="system", cascade="all, delete-orphan")


class SystemCredential(Base):
    __tablename__ = "system_credentials"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    system_id = Column(GUID(), ForeignKey("systems.id", ondelete="CASCADE"), nullable=False)
    user_id = Column("label", String, nullable=False)
    login_endpoint = Column(String, nullable=False)
    access_scope = Column(Enum(AccessType), nullable=False)
    credential_secret = Column(LargeBinary, nullable=False)

    system = relationship("System", back_populates="credentials")
