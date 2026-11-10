import { useEffect, useState } from "react";

interface WSMessage {
  event: string;
  data: Record<string, unknown>;
  ts: string;
}

const RECONNECT_DELAY_MS = 5000;

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);

  useEffect(() => {
    // Everything a connection owns lives in this effect run, so a later run
    // (Strict Mode's remount included) can never be reached by an earlier one.
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    function connect() {
      reconnectTimer = undefined;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      socket = ws;

      // close() only starts the closing handshake; the browser delivers the
      // socket's remaining events afterwards. A socket this effect has already
      // let go of -- replaced, or released by cleanup -- must not touch state
      // or arm a reconnect, so every handler checks it is still the current one.
      const isCurrent = () => socket === ws;

      ws.onopen = () => {
        if (isCurrent()) setConnected(true);
      };
      ws.onclose = () => {
        if (!isCurrent()) return;
        socket = null;
        setConnected(false);
        scheduleReconnect();
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        if (!isCurrent()) return;
        try {
          setLastMessage(JSON.parse(e.data));
        } catch {}
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      const ws = socket;
      // Release before closing: the close event then finds no current socket.
      socket = null;
      ws?.close();
    };
  }, []);

  return { connected, lastMessage };
}
