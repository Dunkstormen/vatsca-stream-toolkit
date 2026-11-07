// Connection from a page to the toolkit server's /ws hub, with reconnect.

import type { ClientMessage, ServerMessage } from "../../shared/protocol";

type Handler = (msg: ServerMessage) => void;

export class Link {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private statusHandlers = new Set<(open: boolean) => void>();
  private nextId = 1;
  private pending = new Map<number, (r: Extract<ServerMessage, { type: "result" }>) => void>();
  /** Identifies this page so it can ignore its own control changes when they come back. */
  readonly id = Math.random().toString(36).slice(2, 10);
  open = false;

  constructor(private url = defaultUrl()) {
    this.connect();
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  onStatus(h: (open: boolean) => void): () => void {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Sends and waits for the server's result. */
  request(msg: ClientMessage): Promise<Extract<ServerMessage, { type: "result" }>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return reject(new Error("Not connected to the toolkit"));
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => this.setOpen(true);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as ServerMessage;
      if (msg.type === "result" && msg.id != null) {
        this.pending.get(msg.id)?.(msg);
        this.pending.delete(msg.id);
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      this.setOpen(false);
      setTimeout(() => this.connect(), 1000);
    };
  }

  private setOpen(open: boolean): void {
    this.open = open;
    for (const h of this.statusHandlers) h(open);
  }
}

function defaultUrl(): string {
  const p = new URLSearchParams(location.search).get("server");
  if (p) return p;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}
