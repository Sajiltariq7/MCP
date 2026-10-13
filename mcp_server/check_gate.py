"""End-to-end check of the MCP server: API key gate, both transports, task order rules, agent names, rotation.
Needs `task backend` and `task mcp` running.

Run: task check-mcp
     uv run python mcp_server/check_gate.py --rotate   (also tests key rotation; connected agents then need the new key)
"""
import asyncio
import logging
import sys

import requests
from loguru import logger
from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamablehttp_client
from mcp.types import Implementation

logger.remove()
logger.add(sys.stderr, format="{level: <8} | {message}")
# The MCP client library logs errors when this check cuts it off on purpose (disconnect, rotation)
logging.getLogger("mcp").setLevel(logging.CRITICAL)

API = "http://127.0.0.1:8190/api"
MCP = "http://127.0.0.1:8001"


def status():
    return requests.get(f"{MCP}/status", timeout=3).json()["agents"]


def listed(name):
    return any(a["name"] == name for a in status())


async def call(session, tool, **args):
    result = await session.call_tool(tool, args)
    return result.content[0].text


def http(url, key):
    """Streamable HTTP client streams (read, write), dropping the session-id getter."""
    async def streams():
        async with streamablehttp_client(url, headers={"Authorization": f"Bearer {key}"}) as (read, write, _):
            yield read, write
    from contextlib import asynccontextmanager
    return asynccontextmanager(streams)()


async def connect_and_list(transport, url, key, name):
    async with transport(url, key) as (read, write):
        async with ClientSession(read, write, client_info=Implementation(name=name, version="1.0")) as session:
            await session.initialize()
            tools = [t.name for t in (await session.list_tools()).tools]
            assert "get_tasks" in tools, tools
            await asyncio.sleep(0.5)
            assert listed(name), status()
    return len(tools)


def sse(url, key):
    return sse_client(url, headers={"Authorization": f"Bearer {key}"})


async def main():
    for label, headers in [("no key", {}), ("wrong key", {"Authorization": "Bearer nope"})]:
        for method, path in [("GET", "/sse"), ("POST", "/mcp")]:
            r = requests.request(method, f"{MCP}{path}", headers=headers, timeout=3)
            assert r.status_code == 401, f"{label} {method} {path}: expected 401, got {r.status_code}"
    assert requests.get(f"{MCP}/.well-known/oauth-authorization-server", timeout=3).status_code == 404
    logger.success("no or wrong key -> 401 on both transports; OAuth discovery -> 404")

    key = requests.get(f"{API}/mcp/key", timeout=3).json()["key"]
    n = await connect_and_list(http, f"{MCP}/mcp", key, "check-http")
    logger.success(f"Streamable HTTP at /mcp -> connected, {n} tools, listed by name")
    await connect_and_list(http, f"{MCP}/sse", key, "check-http-at-sse")
    logger.success("Streamable HTTP pointed at /sse (older configs) -> works")
    await connect_and_list(sse, f"{MCP}/sse", key, "check-sse")
    logger.success("legacy SSE at /sse -> works")

    # One agent with several sessions is one entry; a keyless DELETE (what opencode sends) ends a session
    auth = {"Authorization": f"Bearer {key}"}
    async with streamablehttp_client(f"{MCP}/mcp", headers=auth) as (r1, w1, sid1),             streamablehttp_client(f"{MCP}/mcp", headers=auth) as (r2, w2, _):
        async with ClientSession(r1, w1, client_info=Implementation(name="twin", version="1.0")) as one,                 ClientSession(r2, w2, client_info=Implementation(name="twin", version="1.0")) as two:
            await one.initialize()
            await two.initialize()
            await asyncio.sleep(0.5)
            twins = [a for a in status() if a["name"] == "twin"]
            assert len(twins) == 1 and twins[0]["sessions"] == 2, twins
            assert requests.delete(f"{MCP}/mcp", headers={"mcp-session-id": sid1()}, timeout=3).status_code < 300
            await asyncio.sleep(0.5)
            assert [a["sessions"] for a in status() if a["name"] == "twin"] == [1], status()
    logger.success("two sessions of one agent -> one entry; keyless DELETE ends a session")

    task_id = None
    try:
        async with http(f"{MCP}/mcp", key) as (read, write):
            async with ClientSession(read, write, client_info=Implementation(name="gate-check", version="1.0")) as session:
                await session.initialize()

                # Agent name lands in the activity log and on the task
                text = await call(session, "add_task", title="gate-check task")
                task_id = text.split("(id ")[1].split(",")[0]
                task = requests.get(f"{API}/tasks/{task_id}", timeout=3).json()
                assert task["creator"] == "AI:gate-check", task
                assert requests.get(f"{API}/audit", timeout=3).json()[0]["actor"] == "AI:gate-check"
                logger.success("activity log and task creator use the agent's name (AI:gate-check)")

                # Task order: no skipping, notes required for review, Completed only via approve_task
                assert "Can't move" in await call(session, "update_task_status", task_id=task_id, status="Needs Review")
                assert "approve_task" in await call(session, "update_task_status", task_id=task_id, status="Completed")
                assert "moved from Pending to In Progress" in await call(session, "update_task_status", task_id=task_id, status="in_progress")
                assert "needs your results" in await call(session, "update_task_status", task_id=task_id, status="Needs Review")
                assert "moved from In Progress to Needs Review" in await call(
                    session, "update_task_status", task_id=task_id, status="Needs Review", description="All checks passed.")
                assert "approved" in await call(session, "approve_task", task_id=task_id)
                assert requests.get(f"{API}/tasks/{task_id}", timeout=3).json()["status"] == "Completed"
                logger.success("task order enforced: Pending -> In Progress -> Needs Review -> approve_task")
    finally:
        if task_id:
            requests.delete(f"{API}/tasks/{task_id}", params={"actor": "gate-check"}, timeout=3)

    # Disconnect button: needs the key, ends the session on both transports
    assert requests.post(f"{MCP}/agents/x/disconnect", timeout=3).status_code == 401
    preflight = requests.options(f"{MCP}/agents/x/disconnect", headers={"Origin": "http://127.0.0.1:5500"}, timeout=3)
    assert preflight.headers.get("access-control-allow-origin") == "http://127.0.0.1:5500", preflight.headers
    for transport, url, name in [(http, f"{MCP}/mcp", "kick-http"), (sse, f"{MCP}/sse", "kick-sse")]:
        async with transport(url, key) as (read, write):
            async with ClientSession(read, write, client_info=Implementation(name=name, version="1.0")) as session:
                await session.initialize()
                await asyncio.sleep(0.5)
                agent = next(a for a in status() if a["name"] == name)
                r = requests.post(f"{MCP}/agents/{agent['ids'][0]}/disconnect", headers={"Authorization": f"Bearer {key}"}, timeout=3)
                assert r.json() == {"disconnected": name}, r.text
                await asyncio.sleep(1)
                assert not listed(name), status()
                try:
                    await asyncio.wait_for(session.list_tools(), timeout=5)
                    still_works = True
                except Exception:
                    still_works = False
                assert not still_works, f"{name}: session still works after disconnect"
    logger.success("Disconnect button -> needs the key, ends the session on both transports")

    if "--rotate" not in sys.argv:
        logger.info("skipped key rotation (it would cut off your agents); run with --rotate to test it")
        return

    # Rotation closes an open connection
    async with sse(f"{MCP}/sse", key) as (read, write):
        async with ClientSession(read, write, client_info=Implementation(name="rotate-check", version="1.0")) as session:
            await session.initialize()
            requests.post(f"{API}/mcp/key/rotate", timeout=3).raise_for_status()
            for _ in range(10):  # the server should close this connection within 5 s
                await asyncio.sleep(1)
                if not listed("rotate-check"):
                    break
            assert not listed("rotate-check"), status()
    logger.success("after rotation -> the server closed the connection")

    for method, path in [("GET", "/sse"), ("POST", "/mcp")]:
        r = requests.request(method, f"{MCP}{path}", headers={"Authorization": f"Bearer {key}"}, timeout=3)
        assert r.status_code == 401, (method, path, r.status_code)
    logger.success("old key -> 401 after rotation")


if __name__ == "__main__":
    asyncio.run(main())
