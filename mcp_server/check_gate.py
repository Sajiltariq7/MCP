"""End-to-end check of the MCP API key gate. Needs `task backend` and `task mcp` running.

Run: task check-mcp
Note: the last step rotates the API key, so agents must be given the new key afterwards.
"""
import asyncio
import sys

import requests
from loguru import logger
from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.types import Implementation

logger.remove()
logger.add(sys.stderr, format="{level: <8} | {message}")

API = "http://127.0.0.1:8190/api"
MCP = "http://127.0.0.1:8001"


def status():
    return requests.get(f"{MCP}/status", timeout=3).json()["agents"]


async def main():
    for label, headers in [("no key", {}), ("wrong key", {"Authorization": "Bearer nope"})]:
        r = requests.get(f"{MCP}/sse", headers=headers, timeout=3)
        assert r.status_code == 401, f"{label}: expected 401, got {r.status_code}"
        logger.success(f"{label} -> 401")

    key = requests.get(f"{API}/mcp/key", timeout=3).json()["key"]
    async with sse_client(f"{MCP}/sse", headers={"Authorization": f"Bearer {key}"}) as streams:
        async with ClientSession(*streams, client_info=Implementation(name="gate-check", version="1.0")) as session:
            await session.initialize()
            tools = [t.name for t in (await session.list_tools()).tools]
            assert "get_tasks" in tools, tools
            await session.call_tool("get_tasks", {})
            logger.success(f"right key -> connected, {len(tools)} tools, get_tasks works")

            agents = status()
            assert any(a["name"] == "gate-check" and a["version"] == "1.0" and a["key_valid"] for a in agents), agents
            logger.success("agent listed on /status by name")

            requests.post(f"{API}/mcp/key/rotate", timeout=3).raise_for_status()
            await asyncio.sleep(6)  # key cache TTL in the MCP server
            assert not any(a["key_valid"] for a in status() if a["name"] == "gate-check")
            logger.success("after rotation -> agent flagged as using an old key")

    await asyncio.sleep(1)
    assert not any(a["name"] == "gate-check" for a in status())
    logger.success("after disconnect -> agent gone from /status")


if __name__ == "__main__":
    asyncio.run(main())
