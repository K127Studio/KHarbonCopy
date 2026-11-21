"use client";
import type { Req, Res } from "./protocol";

type Pending = { resolve: (r: Res) => void; reject: (e: Error) => void; progress?: (msg: string, f: number) => void };

type Body<T> = T extends unknown ? Omit<T, "id"> : never;

export class Engine {
  private w: Worker;
  private seq = 1;
  private pending = new Map<number, Pending>();
  constructor() {
    this.w = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    this.w.onmessage = (ev: MessageEvent<Res>) => {
      const m = ev.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === "progress") { p.progress?.(m.msg, m.frac); return; }
      this.pending.delete(m.id);
      if (m.type === "error") p.reject(new Error(m.error));
      else p.resolve(m);
    };
    this.w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "worker error"));
      this.pending.clear();
    };
  }
  call<T extends Res["type"]>(req: Body<Req>, progress?: (msg: string, f: number) => void, transfer: Transferable[] = []) {
    const id = this.seq++;
    return new Promise<Extract<Res, { type: T }>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: Res) => void, reject, progress });
      this.w.postMessage({ ...req, id }, transfer);
    });
  }
  terminate() { this.w.terminate(); }
}
