import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { PluginMessage } from "../shared/plugin";
import type { PluginStatus } from "../shared/protocol";

/**
 * The single connection to the EuroScope plugin. Reconnects on its own (1 s, doubling to 10 s),
 * so EuroScope can be started before or after the toolkit.
 *
 * Events: "message" (PluginMessage), "status" (PluginStatus).
 */
export class PluginClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private delay = 1000;
  private stopped = false;
  readonly status: PluginStatus;

  constructor(url: string) {
    super();
    this.status = { connected: false, url, error: "", hello: null, lastMessageAt: 0 };
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.terminate();
    this.ws = null;
  }

  setUrl(url: string): void {
    if (url === this.status.url) return;
    this.status.url = url;
    this.stop();
    this.delay = 1000;
    this.start();
  }

  /** Sends a raw plugin command (subscribe, filter, ...). Returns false when not connected. */
  send(msg: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private connect(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.status.url, { handshakeTimeout: 5000 });
    } catch (e) {
      this.setStatus({ connected: false, error: (e as Error).message });
      this.schedule();
      return;
    }
    this.ws = ws;
    ws.on("open", () => {
      this.delay = 1000;
      this.setStatus({ connected: true, error: "" });
    });
    ws.on("message", (data) => {
      let msg: PluginMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.status.lastMessageAt = Date.now();
      if (msg.type === "hello") this.setStatus({ hello: msg });
      this.emit("message", msg);
    });
    ws.on("error", (e) => {
      this.status.error = e.message;
    });
    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus({ connected: false, hello: null });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.connect();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, 10000);
  }

  private setStatus(patch: Partial<PluginStatus>): void {
    Object.assign(this.status, patch);
    this.emit("status", this.status);
  }
}
