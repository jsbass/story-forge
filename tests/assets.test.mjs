import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Comfy } from '../tools/assets/comfy.mjs';
import { listWorkflows, bindWorkflow, validateWorkflow } from '../tools/assets/workflows.mjs';
import { assetIdFor, applyCapabilities, upgradeReport, approveAsset, rejectAsset } from '../tools/assets/manifest.mjs';
import { composeValues } from '../tools/assets/generate.mjs';
import { loadCatalog } from '../tools/assets/assess.mjs';

/** A tiny fake ComfyUI: object_info, models, prompt -> history -> view. */
function fakeComfy({ nodes, models }) {
  const queued = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/system_stats') return json({ system: { comfyui_version: 'fake', argv: ['main.py'] }, devices: [] });
    if (u.pathname === '/object_info') return json(Object.fromEntries(nodes.map((n) => [n, { input: {} }])));
    if (u.pathname.startsWith('/models/')) return json(models[decodeURIComponent(u.pathname.slice(8))] || []);
    if (u.pathname === '/prompt' && req.method === 'POST') {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        const body = JSON.parse(b);
        const missing = Object.entries(body.prompt).filter(([, n]) => !nodes.includes(n.class_type));
        if (missing.length) return json({ error: { message: 'bad' }, node_errors: { [missing[0][0]]: { class_type: missing[0][1].class_type, errors: [{ message: 'unknown node' }] } } }, 400);
        queued.push(body.prompt);
        json({ prompt_id: `p${queued.length}` });
      });
      return;
    }
    if (u.pathname.startsWith('/history/')) {
      const id = u.pathname.slice(9);
      return json({ [id]: { status: { status_str: 'success', completed: true }, outputs: { 7: { images: [{ filename: 'x_00001_.png', subfolder: 'forge', type: 'output' }] } } } });
    }
    if (u.pathname === '/view') { res.writeHead(200); return res.end(Buffer.from('PNGDATA')); }
    json({}, 404);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, queued })));
}

test('built-in workflows are well-formed: every param points at a real node input', () => {
  const wfs = listWorkflows(null);
  for (const id of ['sdxl-image', 'sdxl-draft', 'sdxl-image-upscale', 'sdxl-ipadapter-portrait', 'stable-audio-sfx', 'ace15-music', 'wan22-video']) {
    const wf = wfs.get(id);
    assert.ok(wf, id);
    for (const [name, p] of Object.entries(wf.params)) {
      assert.ok(wf.graph[p.node], `${id}.${name} -> node ${p.node}`);
      assert.ok(p.input in wf.graph[p.node].inputs, `${id}.${name} -> input ${p.input}`);
    }
    for (const [nid, n] of Object.entries(wf.graph)) {
      for (const v of Object.values(n.inputs)) if (Array.isArray(v)) assert.ok(wf.graph[v[0]], `${id} node ${nid} links to missing node ${v[0]}`);
    }
  }
});

test('catalog capabilities reference existing workflows', () => {
  const c = loadCatalog();
  const wfs = listWorkflows(null);
  for (const [cap, def] of Object.entries(c.capabilities)) for (const w of def.workflows) assert.ok(wfs.get(w), `${cap} -> ${w}`);
  for (const m of c.models) {
    assert.ok(c.capabilities[m.capability], m.id);
    for (const f of m.files) assert.ok(f.url.startsWith('https://') && f.sm_folder && f.comfy_folder && f.filename, `${m.id}/${f.filename}`);
  }
});

test('bindWorkflow fills params and rejects unknown ones', () => {
  const wf = listWorkflows(null).get('sdxl-image');
  const { graph } = bindWorkflow(wf, { prompt: 'a lighthouse', seed: 42, checkpoint: 'x.safetensors', width: 832 });
  assert.equal(graph['2'].inputs.text, 'a lighthouse');
  assert.equal(graph['5'].inputs.seed, 42);
  assert.equal(graph['1'].inputs.ckpt_name, 'x.safetensors');
  assert.equal(graph['4'].inputs.width, 832);
  assert.equal(graph['4'].inputs.height, 768, 'default kept');
  assert.equal(wf.graph['2'].inputs.text, '', 'original graph untouched');
  assert.throws(() => bindWorkflow(wf, { bogus: 1 }), /no parameter 'bogus'/);
});

test('composeValues adds art prefix/negative and keeps only declared params', () => {
  const wf = listWorkflows(null).get('sdxl-image');
  const v = composeValues(wf, { kind: 'bg', prompt: 'stormy sea', negative: 'boats', params: { width: 1344, height: 768, seconds: 4 } }, { prompt_prefix: 'oil painting', negative: 'photo', checkpoint: 'art.safetensors' }, { seed: 7, prefix: 'forge/bg/x' });
  assert.equal(v.prompt, 'oil painting, stormy sea');
  assert.equal(v.negative, 'photo, boats');
  assert.equal(v.checkpoint, 'art.safetensors');
  assert.equal(v.seconds, undefined);
  const audio = composeValues(listWorkflows(null).get('stable-audio-sfx'), { kind: 'sfx', prompt: 'door creak', params: { seconds: 3 } }, { prompt_prefix: 'oil painting' }, { seed: 1, prefix: 'p' });
  assert.equal(audio.prompt, 'door creak', 'image style prefix not applied to audio');
  assert.equal(audio.seconds, 3);
});

test('prompt_template shapes the prompt (Stable Audio 3) and falls back to param defaults', () => {
  const wf = listWorkflows(null).get('stable-audio3-sfx');
  const v = composeValues(wf, { kind: 'ambience', prompt: 'rain on stone', params: { seconds: 12 } }, {}, { seed: 1, prefix: 'p' });
  assert.equal(v.prompt, 'rain on stone Length: 12 seconds');
  assert.equal(v.seconds, 12);
  const d = composeValues(wf, { kind: 'sfx', prompt: 'door creak', params: {} }, {}, { seed: 1, prefix: 'p' });
  assert.equal(d.prompt, 'door creak Length: 6 seconds');
});

test('applyCapabilities switches pending assets off a workflow this machine cannot run', () => {
  const m = { assets: [
    { id: 'rain', kind: 'ambience', status: 'blocked_capability', workflow: 'stable-audio-sfx', notes: [] },
    { id: 'old', kind: 'ambience', status: 'approved', workflow: 'stable-audio-sfx', notes: [] },
  ] };
  const profile = { capabilities: { sfx: { status: 'ready', workflows: [{ id: 'stable-audio3-sfx', ok: true }, { id: 'stable-audio-sfx', ok: false }] } } };
  const r = applyCapabilities(m, profile);
  assert.deepEqual(r.switched, ['ambience:rain: stable-audio-sfx -> stable-audio3-sfx']);
  assert.equal(m.assets[0].status, 'requested');
  assert.equal(m.assets[1].workflow, 'stable-audio-sfx', 'approved assets keep their workflow');
});

test('validate + queue + wait + download against a fake ComfyUI', async () => {
  const fake = await fakeComfy({
    nodes: ['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage'],
    models: { checkpoints: ['a.safetensors'] },
  });
  try {
    const comfy = new Comfy(fake.url);
    const wfs = listWorkflows(null);
    assert.deepEqual(await validateWorkflow(comfy, wfs.get('sdxl-image')), { ok: true, missingNodes: [], missingModels: [] });
    const bad = await validateWorkflow(comfy, wfs.get('sdxl-image'), { checkpoint: 'nope.safetensors' });
    assert.deepEqual(bad.missingModels, [{ folder: 'checkpoints', file: 'nope.safetensors', param: 'checkpoint' }]);
    const up = await validateWorkflow(comfy, wfs.get('sdxl-image-upscale'));
    assert.deepEqual(up.missingNodes.sort(), ['ImageScale', 'ImageUpscaleWithModel', 'UpscaleModelLoader']);

    const { graph } = bindWorkflow(wfs.get('sdxl-image'), { prompt: 'x', checkpoint: 'a.safetensors' });
    const { prompt_id } = await comfy.queue(graph);
    const entry = await comfy.wait(prompt_id, { intervalMs: 10 });
    const files = Comfy.outputFiles(entry);
    assert.equal(files.length, 1);
    const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'forge-comfy-')), 'out.png');
    await comfy.download(files[0], dest);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'PNGDATA');

    await assert.rejects(comfy.queue(bindWorkflow(wfs.get('sdxl-image-upscale'), {}).graph), /rejected the workflow/);
  } finally {
    fake.server.close();
  }
});

test('manifest helpers: ids, capability blocking, upgrade report, approve/reject', () => {
  assert.equal(assetIdFor('portrait', ['mara']), 'mara.neutral');
  assert.equal(assetIdFor('portrait', ['mara', 'worried']), 'mara.worried');
  assert.equal(assetIdFor('bg', ['hold']), 'hold');

  const m = { assets: [
    { id: 'hold', kind: 'bg', status: 'requested', candidates: [], notes: [], workflow: 'sdxl-image' },
    { id: 'rain', kind: 'ambience', status: 'requested', candidates: [], notes: [] },
    { id: 'mara.worried', kind: 'portrait', status: 'approved', candidates: [], notes: [], workflow: 'sdxl-image' },
  ] };
  const before = { capabilities: { image: { status: 'ready' }, sfx: { status: 'missing' }, char_consistency: { status: 'missing' } } };
  assert.deepEqual(applyCapabilities(m, before), { blocked: ['ambience:rain'], unblocked: [], switched: [] });
  const after = { capabilities: { image: { status: 'ready' }, sfx: { status: 'ready' }, char_consistency: { status: 'ready' } } };
  const rep = upgradeReport(m, before, after);
  assert.deepEqual(rep.newlyReady.sort(), ['char_consistency', 'sfx']);
  assert.deepEqual(rep.unblocked, ['ambience:rain']);
  assert.deepEqual(rep.improvable, ['portrait:mara.worried']);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-assets-'));
  fs.mkdirSync(path.join(root, 'assets/raw/bg/hold'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/raw/bg/hold/hold_1.png'), 'one');
  fs.writeFileSync(path.join(root, 'assets/raw/bg/hold/hold_2.png'), 'two');
  m.assets[0].candidates.push({ file: 'assets/raw/bg/hold/hold_1.png', seed: 1 }, { file: 'assets/raw/bg/hold/hold_2.png', seed: 2 });
  const a = approveAsset(root, m, 'bg:hold', 0);
  assert.equal(a.status, 'approved');
  assert.equal(fs.readFileSync(path.join(root, 'assets/final/bg/hold.png'), 'utf8'), 'one');
  approveAsset(root, m, 'hold', 1);
  assert.equal(fs.readFileSync(path.join(root, 'assets/final/bg/hold.png'), 'utf8'), 'two');
  assert.throws(() => approveAsset(root, m, 'hold', 5), /no candidate #5/);
  rejectAsset(m, 'hold', 'too bright');
  assert.equal(m.assets[0].status, 'rejected');
  assert.equal(m.assets[0].notes[0].note, 'too bright');
});
