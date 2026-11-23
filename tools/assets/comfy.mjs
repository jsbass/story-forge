// Minimal ComfyUI HTTP client (no dependencies; Node 20+ fetch/FormData/Blob).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188';

export class ComfyError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

export class Comfy {
  constructor(url = DEFAULT_COMFY_URL, { fetchImpl = fetch } = {}) {
    this.url = url.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.clientId = crypto.randomUUID();
    this._objectInfo = null;
    this._models = new Map();
  }

  async request(p, { method = 'GET', body, json = true, timeoutMs = 30000 } = {}) {
    let res;
    try {
      res = await this.fetch(this.url + p, {
        method,
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        headers: body === undefined || body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new ComfyError(`ComfyUI not reachable at ${this.url} (${e.cause?.code || e.message}). Is it running?`);
    }
    if (!res.ok) {
      let detail = await res.text();
      try { detail = JSON.parse(detail); } catch { /* text */ }
      throw new ComfyError(`ComfyUI ${method} ${p} failed: HTTP ${res.status}`, detail);
    }
    return json ? res.json() : Buffer.from(await res.arrayBuffer());
  }

  async ping() {
    try { await this.systemStats(); return true; } catch { return false; }
  }

  systemStats() { return this.request('/system_stats', { timeoutMs: 5000 }); }

  async objectInfo() {
    if (!this._objectInfo) this._objectInfo = await this.request('/object_info', { timeoutMs: 60000 });
    return this._objectInfo;
  }

  async modelFolders() { return this.request('/models'); }

  async models(folder) {
    if (!this._models.has(folder)) {
      let list = [];
      try { list = await this.request(`/models/${encodeURIComponent(folder)}`); } catch { list = []; }
      this._models.set(folder, list);
    }
    return this._models.get(folder);
  }

  clearCache() { this._objectInfo = null; this._models.clear(); }

  /** Queue an API-format graph. Throws with node_errors when ComfyUI rejects it. */
  async queue(graph) {
    try {
      return await this.request('/prompt', { method: 'POST', body: { prompt: graph, client_id: this.clientId } });
    } catch (e) {
      if (e.details?.node_errors) {
        const msgs = Object.entries(e.details.node_errors).flatMap(([node, ne]) =>
          (ne.errors || []).map((er) => `node ${node} (${ne.class_type}): ${er.message}${er.details ? ' - ' + er.details : ''}`));
        throw new ComfyError(`ComfyUI rejected the workflow:\n  ${msgs.join('\n  ') || e.details.error?.message}`, e.details);
      }
      throw e;
    }
  }

  history(promptId) { return this.request(`/history/${encodeURIComponent(promptId)}`); }
  queueState() { return this.request('/queue'); }
  interrupt() { return this.request('/interrupt', { method: 'POST', body: {} }); }
  free() { return this.request('/free', { method: 'POST', body: { unload_models: true, free_memory: true } }); }

  /** Poll until the prompt finishes. Returns the history entry. */
  async wait(promptId, { timeoutMs = 30 * 60 * 1000, intervalMs = 1000, onTick } = {}) {
    const start = Date.now();
    for (;;) {
      const h = await this.history(promptId);
      const entry = h[promptId];
      if (entry) {
        const st = entry.status || {};
        if (st.status_str === 'error') {
          const err = (st.messages || []).find(([t]) => t === 'execution_error');
          const d = err?.[1] || {};
          throw new ComfyError(`Generation failed in node ${d.node_id} (${d.node_type}): ${d.exception_message || 'unknown error'}`, d);
        }
        if (st.completed || Object.keys(entry.outputs || {}).length) return entry;
      }
      if (Date.now() - start > timeoutMs) throw new ComfyError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${promptId}`);
      onTick?.(Date.now() - start);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /** All files a history entry produced: [{node, filename, subfolder, type}] */
  static outputFiles(entry) {
    const files = [];
    for (const [node, out] of Object.entries(entry.outputs || {})) {
      for (const v of Object.values(out)) {
        if (!Array.isArray(v)) continue;
        for (const f of v) if (f && typeof f === 'object' && f.filename) files.push({ node, ...f });
      }
    }
    return files;
  }

  async download(file, dest) {
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
    const buf = await this.request(`/view?${q}`, { json: false, timeoutMs: 120000 });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    return dest;
  }

  /** Upload a reference image into ComfyUI's input folder. Returns the name to use in LoadImage. */
  async uploadImage(file, { subfolder = 'forge', overwrite = true } = {}) {
    const fd = new FormData();
    fd.append('image', new Blob([fs.readFileSync(file)]), path.basename(file));
    fd.append('subfolder', subfolder);
    fd.append('overwrite', String(overwrite));
    const r = await this.request('/upload/image', { method: 'POST', body: fd });
    return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
  }
}
