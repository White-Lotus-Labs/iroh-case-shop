#!/usr/bin/env node
// Runs Tripo API tasks for the host model and downloads the result.
//
//   node scripts/tripo.mjs <image.png> <out.glb> ['{"face_limit":50000}']
//   node scripts/tripo.mjs --submit '{"type":"animate_rig",...}' [out.glb]
//   node scripts/tripo.mjs --task <task_id> [out.glb]   (resume a started task)
//
// Needs TRIPO_API_KEY in .env.local. Tasks cost credits (image_to_model with
// detailed textures is about 40); see docs.tripo3d.ai/get-started/pricing.
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

process.loadEnvFile('.env.local');
const API = 'https://api.tripo3d.ai/v2/openapi';
const auth = { Authorization: `Bearer ${process.env.TRIPO_API_KEY}` };

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...auth, ...init.headers },
  });
  const body = await res.json();
  if (body.code !== 0) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body.data;
}

async function submit(task) {
  const { task_id } = await call('/task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  });
  return task_id;
}

async function imageToModel(image, overrides) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(image)]), basename(image));
  const { image_token } = await call('/upload', { method: 'POST', body: form });
  return submit({
    type: 'image_to_model',
    model_version: 'v3.1-20260211',
    file: { type: extname(image).slice(1), file_token: image_token },
    texture_quality: 'detailed',
    orientation: 'align_image',
    ...overrides,
  });
}

const args = process.argv.slice(2);
const [taskId, out] =
  args[0] === '--task'
    ? [args[1], args[2]]
    : args[0] === '--submit'
      ? [await submit(JSON.parse(args[1])), args[2]]
      : [await imageToModel(args[0], JSON.parse(args[2] ?? '{}')), args[1]];
console.log(`task ${taskId}`);

let task;
do {
  await new Promise((r) => setTimeout(r, 5000));
  // The gateway sometimes answers with an HTML error page (SyntaxError) or
  // drops the connection (TypeError); poll again. An API error code, such as
  // a bad task id, is final.
  task = await call(`/task/${taskId}`).catch((error) => {
    if (!(error instanceof SyntaxError || error instanceof TypeError))
      throw error;
    console.log(`poll failed: ${error.message.slice(0, 80)}`);
    return { status: 'running' };
  });
  console.log(`${task.status} ${task.progress ?? ''}%`);
} while (task.status === 'queued' || task.status === 'running');
if (task.status !== 'success') throw new Error(JSON.stringify(task));
const urls = (value) => String(value).startsWith('http');
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(task.output).filter(([, value]) => !urls(value)),
    ),
  ),
);

const save = async (url, path) =>
  writeFile(path, Buffer.from(await (await fetch(url)).arrayBuffer()));
const model = task.output.pbr_model ?? task.output.model;
if (out && model) {
  await save(model, out);
  if (task.output.rendered_image) {
    const preview = `${basename(out, extname(out))}-preview.webp`;
    await save(task.output.rendered_image, join(dirname(out), preview));
  }
  console.log(`saved ${out}`);
}
console.log(`${task.consumed_credit ?? '?'} credits`);
