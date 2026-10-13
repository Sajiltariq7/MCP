"""End-to-end check of the MCP server: API key gate, task order rules, agent names, rotation.
Needs `task backend` and `task mcp` running.

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


async def call(session, tool, **args):
    result = await session.call_tool(tool, args)
    return result.content[0].text


async def main():
    for label, headers in [("no key", {}), ("wrong key", {"Authorization": "Bearer nope"})]:
        r = requests.get(f"{MCP}/sse", headers=headers, timeout=3)
        assert r.status_code == 401, f"{label}: expected 401, got {r.status_code}"
        logger.success(f"{label} -> 401")

    key = requests.get(f"{API}/mcp/key", timeout=3).json()["key"]
    task_id = None
    try:
        async with sse_client(f"{MCP}/sse", headers={"Authorization": f"Bearer {key}"}) as streams:
            async with ClientSession(*streams, client_info=Implementation(name="gate-check", version="1.0")) as session:
                await session.initialize()
                tools = [t.name for t in (await session.list_tools()).tools]
                assert "get_tasks" in tools, tools
                logger.success(f"right key -> connected, {len(tools)} tools")

                agents = status()
                assert any(a["name"] == "gate-check" and a["version"] == "1.0" and a["key_valid"] for a in agents), agents
                logger.success("agent listed on /status by name")

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

                requests.post(f"{API}/mcp/key/rotate", timeout=3).raise_for_status()
                for _ in range(10):  # the server should close this connection within 5 s
                    await asyncio.sleep(1)
                    if not any(a["name"] == "gate-check" for a in status()):
                        break
                assert not any(a["name"] == "gate-check" for a in status()), status()
                logger.success("after rotation -> the server closed the connection")
    finally:
        if task_id:
            requests.delete(f"{API}/tasks/{task_id}", params={"actor": "gate-check"}, timeout=3)

    r = requests.get(f"{MCP}/sse", headers={"Authorization": f"Bearer {key}"}, timeout=3)
    assert r.status_code == 401, r.status_code
    logger.success("old key -> 401 after rotation")


if __name__ == "__main__":
    asyncio.run(main())
