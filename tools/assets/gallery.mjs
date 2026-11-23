// Review gallery: assets/review/index.html - contact sheet of candidates with approve/reject buttons.
// Buttons POST to the review server (forge assets review); without it, the page shows the CLI command.
import path from 'node:path';
import { writeText, escapeHtml } from '../lib/util.mjs';
import { loadManifest, key } from './manifest.mjs';

const media = (file, kind) => {
  const src = '../../' + file; // gallery lives in assets/review/
  if (/\.(png|jpe?g|webp|gif)$/i.test(file)) return `<img src="${escapeHtml(src)}" loading="lazy" alt="">`;
  if (/\.(opus|ogg|mp3|wav|flac)$/i.test(file)) return `<audio controls preload="none" src="${escapeHtml(src)}"></audio>`;
  if (/\.(webm|mp4|mov)$/i.test(file)) return `<video controls muted loop preload="metadata" src="${escapeHtml(src)}"></video>`;
  return `<a href="${escapeHtml(src)}">${escapeHtml(path.basename(file))}</a>`;
};

/** @param filter.status statuses to include (default: generated + rejected + approved) */
export function writeGallery(root, { statuses = ['generated', 'rejected', 'approved'], kinds = [] } = {}) {
  const m = loadManifest(root);
  const items = m.assets.filter((a) => !a.unused && statuses.includes(a.status) && (!kinds.length || kinds.includes(a.kind)) && a.candidates.length);
  const cards = items.map((a) => {
    const cands = a.candidates.map((c, i) => `
      <figure class="cand ${a.approved?.candidate === i ? 'chosen' : ''} ${c.draft ? 'draft' : ''}">
        ${media(c.file, a.kind)}
        <figcaption>#${i} · seed ${c.seed}${c.draft ? ' · draft' : ''} · ${c.seconds ?? '?'}s
          ${c.draft ? '' : `<button data-act="approve" data-id="${escapeHtml(key(a))}" data-cand="${i}">Approve #${i}</button>`}
        </figcaption>
      </figure>`).join('');
    const notes = (a.notes || []).slice(-3).map((n) => `<li>${escapeHtml(n.note)}</li>`).join('');
    return `
    <section class="asset status-${a.status}" id="${escapeHtml(key(a))}">
      <header><h2>${escapeHtml(key(a))}</h2><span class="badge">${a.status}</span></header>
      <p class="prompt"><b>Prompt:</b> ${escapeHtml(a.prompt || '')}</p>
      <p class="meta">Used in: ${escapeHtml((a.sources || []).join(', ') || '-')} · workflow ${escapeHtml(a.workflow || '-')}</p>
      ${notes ? `<ul class="notes">${notes}</ul>` : ''}
      <div class="cands">${cands}</div>
      <div class="actions">
        <input type="text" placeholder="What should change?" data-note="${escapeHtml(key(a))}">
        <button data-act="reject" data-id="${escapeHtml(key(a))}">Reject &amp; regenerate</button>
      </div>
    </section>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Asset review</title>
<style>
  body { font: 14px/1.45 system-ui, sans-serif; background: #151515; color: #ddd; margin: 0; padding: 20px; }
  h1 { margin: 0 0 4px; } .sub { color: #999; margin: 0 0 20px; }
  .asset { border: 1px solid #333; border-radius: 8px; padding: 12px 16px; margin: 0 0 18px; background: #1c1c1c; }
  .asset header { display: flex; gap: 10px; align-items: center; } .asset h2 { font-size: 16px; margin: 0; }
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: #333; }
  .status-approved .badge { background: #2e5d34; } .status-rejected .badge { background: #6b2b2b; }
  .prompt, .meta { margin: 6px 0; } .meta { color: #999; font-size: 12px; } .notes { color: #e0a458; font-size: 12px; }
  .cands { display: flex; flex-wrap: wrap; gap: 12px; margin: 10px 0; }
  .cand { margin: 0; padding: 6px; border: 2px solid transparent; border-radius: 6px; background: #111; max-width: 360px; }
  .cand.chosen { border-color: #4caf50; } .cand.draft { opacity: 0.8; }
  .cand img, .cand video { max-width: 340px; max-height: 340px; display: block; } .cand audio { width: 320px; }
  figcaption { font-size: 12px; color: #aaa; margin-top: 4px; display: flex; gap: 8px; align-items: center; justify-content: space-between; }
  .actions { display: flex; gap: 8px; } .actions input { flex: 1; padding: 6px; background: #111; color: #ddd; border: 1px solid #444; border-radius: 4px; }
  button { padding: 5px 10px; border-radius: 4px; border: 1px solid #555; background: #2a2a2a; color: #eee; cursor: pointer; }
  button:hover { background: #3a3a3a; }
  #toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #000; padding: 8px 14px; border-radius: 6px; display: none; max-width: 80vw; }
</style></head><body>
<h1>Asset review</h1>
<p class="sub">${items.length} asset(s) with candidates · generated ${new Date().toLocaleString()} · approving copies the file to assets/final/</p>
${cards || '<p>No candidates to review yet.</p>'}
<div id="toast"></div>
<script>
  const toast = (t) => { const el = document.getElementById('toast'); el.textContent = t; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 6000); };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const body = { action: b.dataset.act, id: b.dataset.id, candidate: b.dataset.cand != null ? Number(b.dataset.cand) : null,
                   note: (document.querySelector('[data-note="' + b.dataset.id + '"]') || {}).value || '' };
    if (body.action === 'reject' && !body.note) { toast('Add a note saying what should change.'); return; }
    try {
      const r = await fetch('/__forge/assets/decision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text());
      toast((await r.json()).message); setTimeout(() => location.reload(), 800);
    } catch (err) {
      const cmd = body.action === 'approve' ? 'node .forge/forge.mjs assets approve ' + body.id + ' --candidate ' + body.candidate
                                            : 'node .forge/forge.mjs assets reject ' + body.id + ' --note "' + body.note.replace(/"/g, "'") + '"';
      toast(location.protocol === 'file:' ? 'No review server - run: ' + cmd : 'Failed: ' + err.message);
    }
  });
</script>
</body></html>`;
  const out = path.join(root, 'assets', 'review', 'index.html');
  writeText(out, html);
  return { file: out, count: items.length };
}
