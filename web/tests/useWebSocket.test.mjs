// Lifecycle regression tests for src/hooks/useWebSocket.ts.
//
// The real hook runs under the real React 19 reconciler (development build, so
// <StrictMode> performs its mount -> cleanup -> remount pass). Only the edges are
// faked: the global WebSocket, the timers, and the root container. The hook
// renders no host elements, so the container needs no DOM behind it.
//
// Nothing here opens a socket, touches the network or starts a server.
//
//   cd web && node --test tests/useWebSocket.test.mjs
//
// Needs a Node that imports .ts directly (type stripping: 22.18+, 23.6+).
import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const RETRY_MS = 5000;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The hook builds its URL from window.location; no `document`, so react-dom
// takes its non-DOM paths.
globalThis.window = { location: { protocol: "http:", host: "sigil.test" } };

const { StrictMode, act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useWebSocket } = await import("../src/hooks/useWebSocket.ts");

/** Every socket the hook has constructed, in order. */
let sockets = [];
let failNextConstruction = false;

class FakeWebSocket {
  constructor(url) {
    if (failNextConstruction) {
      failNextConstruction = false;
      throw new Error("construction refused");
    }
    this.url = url;
    this.closeCalls = 0;
    this.onopen = this.onclose = this.onerror = this.onmessage = null;
    sockets.push(this);
  }
  // Like a browser, close() only starts the closing handshake; the close event
  // is dispatched later. Tests dispatch it explicitly with serverClose().
  close() {
    this.closeCalls += 1;
  }
  serverOpen() {
    this.onopen?.({});
  }
  serverClose() {
    this.onclose?.({});
  }
  serverError() {
    this.onerror?.({});
  }
  serverMessage(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function fakeContainer() {
  const noop = () => {};
  const doc = { nodeType: 9, addEventListener: noop, removeEventListener: noop };
  // At commit React asks the container's window which element has focus.
  doc.defaultView = { document: doc, HTMLIFrameElement: class {} };
  doc.activeElement = null;
  doc.body = null;
  return {
    nodeType: 1,
    nodeName: "DIV",
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: doc,
    addEventListener: noop,
    removeEventListener: noop,
  };
}

/** Mounts a component that calls the hook; `view.current` is its latest return. */
function mount({ strict = false } = {}) {
  const view = { current: null };
  function Probe() {
    view.current = useWebSocket();
    return null;
  }
  const root = createRoot(fakeContainer());
  const tree = strict
    ? createElement(StrictMode, null, createElement(Probe))
    : createElement(Probe);
  act(() => root.render(tree));
  return { view, unmount: () => act(() => root.unmount()) };
}

const tick = (ms) => act(() => mock.timers.tick(ms));
const live = () => sockets.filter((s) => s.closeCalls === 0);

beforeEach(() => {
  sockets = [];
  failNextConstruction = false;
  globalThis.WebSocket = FakeWebSocket;
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
  delete globalThis.WebSocket;
});

test("connects to /ws on the page's host", () => {
  const { unmount } = mount();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, "ws://sigil.test/ws");
  unmount();
});

test("unmount closes the socket and its close event does not reconnect", () => {
  const { unmount } = mount();
  const [ws] = sockets;
  act(() => ws.serverOpen());

  unmount();
  assert.equal(ws.closeCalls, 1, "cleanup closes the socket");

  // The browser delivers the close event after the component is gone.
  ws.serverClose();
  tick(RETRY_MS * 4);
  assert.equal(sockets.length, 1, "no socket is created after unmount");
});

test("unmount cancels a retry that is already pending", () => {
  const { unmount } = mount();
  act(() => sockets[0].serverClose()); // connection lost; retry timer armed

  unmount();
  tick(RETRY_MS * 4);
  assert.equal(sockets.length, 1, "the pending retry never fires");
});

test("unmount cancels the retry armed by a failed construction", () => {
  failNextConstruction = true;
  const { unmount } = mount();
  assert.equal(sockets.length, 0);

  unmount();
  tick(RETRY_MS * 4);
  assert.equal(sockets.length, 0);
});

test("a mounted connection that drops reconnects after the retry delay", () => {
  const { view, unmount } = mount();
  assert.equal(view.current.connected, false);

  act(() => sockets[0].serverOpen());
  assert.equal(view.current.connected, true);

  act(() => sockets[0].serverClose());
  assert.equal(view.current.connected, false);

  tick(RETRY_MS - 1);
  assert.equal(sockets.length, 1, "not before the delay");
  tick(1);
  assert.equal(sockets.length, 2, "one replacement socket");

  act(() => sockets[1].serverOpen());
  assert.equal(view.current.connected, true);

  const msg = { event: "pipeline_status", data: { status: "running" }, ts: "t" };
  act(() => sockets[1].serverMessage(msg));
  assert.deepEqual(view.current.lastMessage, msg);

  unmount();
});

test("keeps retrying while mounted: socket error, then failed construction", () => {
  const { view, unmount } = mount();

  // An error closes the socket; its close event arms the retry.
  act(() => sockets[0].serverError());
  assert.equal(sockets[0].closeCalls, 1);
  act(() => sockets[0].serverClose());

  failNextConstruction = true;
  tick(RETRY_MS); // retry throws in the constructor and re-arms
  assert.equal(sockets.length, 1);

  tick(RETRY_MS);
  assert.equal(sockets.length, 2);
  act(() => sockets[1].serverOpen());
  assert.equal(view.current.connected, true);

  unmount();
  assert.equal(live().length, 0);
});

test("Strict Mode remount leaves exactly one live socket and no stray retry", () => {
  const { view, unmount } = mount({ strict: true });

  // mount -> cleanup -> remount: the first socket is discarded, the second kept.
  assert.equal(sockets.length, 2);
  assert.equal(sockets[0].closeCalls, 1);
  assert.equal(sockets[1].closeCalls, 0);

  act(() => sockets[1].serverOpen());
  assert.equal(view.current.connected, true);

  // The discarded socket's events arrive late. They belong to a connection the
  // hook no longer owns: they must not flip state or arm a reconnect.
  act(() => {
    sockets[0].serverOpen();
    sockets[0].serverMessage({ event: "stale", data: {}, ts: "t" });
    sockets[0].serverClose();
  });
  assert.equal(view.current.connected, true, "stale close does not mark us disconnected");
  assert.equal(view.current.lastMessage, null, "stale message is dropped");

  tick(RETRY_MS * 4);
  assert.equal(sockets.length, 2, "stale close does not open a duplicate connection");
  assert.equal(live().length, 1);

  // The surviving connection still reconnects normally.
  act(() => sockets[1].serverClose());
  assert.equal(view.current.connected, false);
  tick(RETRY_MS);
  assert.equal(sockets.length, 3);

  unmount();
  sockets[2].serverClose();
  tick(RETRY_MS * 4);
  assert.equal(sockets.length, 3);
  assert.equal(sockets[2].closeCalls, 1, "the last socket is closed by unmount");
});
