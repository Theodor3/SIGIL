"""WebSocket endpoint for live pipeline updates."""
import json
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

_clients: set = set()


async def broadcast(event: str, data: dict) -> None:
    if not _clients:
        return
    payload = json.dumps({"event": event, "data": data, "ts": datetime.utcnow().isoformat()})
    dead = set()
    for ws in _clients:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    _clients.difference_update(dead)


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    _clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        _clients.discard(ws)
    except Exception:
        _clients.discard(ws)
