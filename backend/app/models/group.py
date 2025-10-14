import uuid

from sqlalchemy import Column, String
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.types import GUID


class Group(Base):
    __tablename__ = "groups"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, nullable=True)

    systems = relationship("System", back_populates="group", cascade="all, delete-orphan")
