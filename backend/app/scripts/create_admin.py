import asyncio
import sys
from getpass import getpass

from sqlalchemy import select

from app.core.database import AsyncSessionLocal, Base, engine
from app.core.security import get_password_hash
from app.models import User, UserRoleEnum


async def main() -> None:
    email = input("Admin email: ")
    full_name = input("Full name: ")
    password = getpass("Password: ")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == email))
        if result.scalar_one_or_none():
            print("Admin already exists", file=sys.stderr)
            return
        admin = User(
            email=email,
            full_name=full_name,
            hashed_password=get_password_hash(password),
            role=UserRoleEnum.ADMIN,
        )
        session.add(admin)
        await session.commit()
        print("Admin user created")


if __name__ == "__main__":
    asyncio.run(main())
