import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator

import paramiko

from app.services.crypto import decrypt_secret


@asynccontextmanager
async def ssh_connection(host: str, username: str, secret: bytes, port: int = 22) -> AsyncIterator[paramiko.Channel]:
    loop = asyncio.get_event_loop()
    secret_value = decrypt_secret(secret)

    def _open_client() -> tuple[paramiko.SSHClient, paramiko.Channel]:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(hostname=host, username=username, password=secret_value, port=port, look_for_keys=False)
        transport = client.get_transport()
        if transport is None:
            raise RuntimeError("Failed to open SSH transport")
        channel = transport.open_session()
        channel.get_pty()
        channel.invoke_shell()
        return client, channel

    client, channel = await loop.run_in_executor(None, _open_client)
    try:
        yield channel
    finally:
        await loop.run_in_executor(None, channel.close)
        await loop.run_in_executor(None, client.close)
