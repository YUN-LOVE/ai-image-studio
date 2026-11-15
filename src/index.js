/**
 * Workers AI 文生图工作室 — 单文件 Worker
 * 功能：10 个模型统一调用 / KV 出图缓存 / 每日 Neuron 额度面板 / 参考图编辑 / 生成历史
 */

const DAY_LIMIT = 10000;        // 免费额度：10,000 neurons/天，00:00 UTC 重置
const CACHE_TTL = 60 * 60 * 24 * 30; // 出图缓存 30 天
const RATE_PER_MIN = 30;        // 每 IP 每分钟最多生成次数

/* ------------------------------------------------------------------ */
/* 模型目录                                                            */
/* pricing 用于本地估算 neuron 消耗，规则来自官方计价页的 tile/step 拆分 */
/* ------------------------------------------------------------------ */
const MODELS = [
  {
    id: 'flux-2-dev',
    name: 'FLUX.2 [dev] 32B',
    description: '当前画质最强，支持多参考图与 JSON 结构化 prompt。单张约 3,750 neurons，免费额度每天只能出 2–3 张。',
    key: '@cf/black-forest-labs/flux-2-dev',
    protocol: 'multipart', output: 'base64',
    stepsKey: 'steps', defaultSteps: 25, maxSteps: 50,
    size: { min: 256, max: 1920, w: 1024, h: 768 },
    supportsNegative: false, defaultGuidance: 4, supportsReference: true,
    pricing: { tile: true, perTilePerStep: 37.5 },
    tier: 'frontier', badges: ['最强画质', '贵'], license: 'check-license',
  },
  {
    id: 'flux-2-klein-9b',
    name: 'FLUX.2 [klein] 9B',
    description: 'FLUX.2 蒸馏版，支持多参考图编辑，速度与画质平衡。单张约 1,364 neurons。',
    key: '@cf/black-forest-labs/flux-2-klein-9b',
    protocol: 'multipart', output: 'base64',
    stepsKey: 'steps', defaultSteps: 4, maxSteps: 50,
    size: { min: 256, max: 1920, w: 1024, h: 768 },
    supportsNegative: false, defaultGuidance: 1, supportsReference: true,
    pricing: { firstMP: 1363.64, perMP: 181.82 },
    tier: 'flux2fast', badges: ['多参考图'], license: 'check-license',
  },
  {
    id: 'flux-2-klein-4b',
    name: 'FLUX.2 [klein] 4B',
    description: '免费额度内画质/成本最佳平衡，1024×1024 约 104 neurons，一天可出约 90 张。默认模型。',
    key: '@cf/black-forest-labs/flux-2-klein-4b',
    protocol: 'multipart', output: 'base64',
    stepsKey: 'steps', defaultSteps: 4, maxSteps: 50,
    size: { min: 256, max: 1920, w: 1024, h: 768 },
    supportsNegative: false, defaultGuidance: 1, supportsReference: true,
    pricing: { tile: true, perTile: 26.05 },
    tier: 'flux2fast', badges: ['性价比', '推荐'], license: 'check-license',
  },
  {
    id: 'leonardo-phoenix-1.0',
    name: 'Leonardo Phoenix 1.0',
    description: '文字渲染与提示词遵循度最强，适合海报、banner、带字产品图。单张约 2,370 neurons。',
    key: '@cf/leonardo/phoenix-1.0',
    protocol: 'json', output: 'stream',
    stepsKey: 'num_steps', defaultSteps: 25, maxSteps: 50,
    size: { min: 256, max: 2048, w: 1024, h: 1024 },
    supportsNegative: true, defaultGuidance: 2, supportsReference: false,
    pricing: { tile: true, perTile: 530, perStep: 10 },
    tier: 'partner', badges: ['文字最强', '商用友好'], license: 'ok',
  },
  {
    id: 'leonardo-lucid-origin',
    name: 'Leonardo Lucid Origin',
    description: '照片级写实，商用友好。单张约 2,844 neurons，一天约 3 张。',
    key: '@cf/leonardo/lucid-origin',
    protocol: 'json', output: 'stream',
    stepsKey: 'num_steps', defaultSteps: 25, maxSteps: 40,
    size: { min: 256, max: 2500, w: 1120, h: 1120 },
    supportsNegative: false, defaultGuidance: 4.5, supportsReference: false,
    pricing: { tile: true, perTile: 636, perStep: 12 },
    tier: 'partner', badges: ['写实', '商用友好'], license: 'ok',
  },
  {
    id: 'flux-1-schnell',
    name: 'FLUX.1 [schnell]',
    description: '上一代 FLUX，速度快、便宜（约 58 neurons/张）。注意：不支持自定义宽高，步数上限 8。',
    key: '@cf/black-forest-labs/flux-1-schnell',
    protocol: 'json', output: 'base64',
    stepsKey: 'steps', defaultSteps: 4, maxSteps: 8,
    size: null,
    supportsNegative: false, defaultGuidance: undefined, supportsReference: false,
    pricing: { tile: true, perTile: 4.8, perStep: 9.6 },
    tier: 'legacy', badges: ['便宜'], license: 'check-license',
  },
  {
    id: 'stable-diffusion-xl-base-1.0',
    name: 'Stable Diffusion XL Base 1.0',
    description: 'Stability AI SDXL 基础模型。Beta 阶段，速度慢、易出黑图，但基本不消耗 neuron。',
    key: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    protocol: 'json', output: 'stream',
    stepsKey: 'num_steps', defaultSteps: 20, maxSteps: 20,
    size: { min: 256, max: 2048, w: 1024, h: 1024 },
    supportsNegative: true, defaultGuidance: 7.5, supportsReference: false,
    pricing: {},
    tier: 'legacy', badges: ['Beta', '免费'], license: 'ok',
  },
  {
    id: 'stable-diffusion-xl-lightning',
    name: 'Stable Diffusion XL Lightning',
    description: 'ByteDance SDXL-Lightning，几步出 1024px。$0.00/step，适合不限量刷图。',
    key: '@cf/bytedance/stable-diffusion-xl-lightning',
    protocol: 'json', output: 'stream',
    stepsKey: 'num_steps', defaultSteps: 4, maxSteps: 20,
    size: { min: 256, max: 2048, w: 1024, h: 1024 },
    supportsNegative: true, defaultGuidance: 7.5, supportsReference: false,
    pricing: {},
    tier: 'legacy', badges: ['Beta', '免费'], license: 'ok',
  },
  {
    id: 'dreamshaper-8-lcm',
    name: 'DreamShaper 8 LCM',
    description: '社区 SD 微调模型，偏写实。官方计价表未收录，视作免费，文档支持最弱。',
    key: '@cf/lykon/dreamshaper-8-lcm',
    protocol: 'json', output: 'stream',
    stepsKey: 'num_steps', defaultSteps: 8, maxSteps: 20,
    size: { min: 256, max: 2048, w: 1024, h: 1024 },
    supportsNegative: true, defaultGuidance: 7.5, supportsReference: false,
    pricing: {},
    tier: 'legacy', badges: ['免费'], license: 'ok',
  },
];

const GROUPS = [
  { label: '前沿画质', ids: ['flux-2-dev'] },
  { label: 'FLUX.2 快速版', ids: ['flux-2-klein-9b', 'flux-2-klein-4b'] },
  { label: 'Leonardo（商用友好）', ids: ['leonardo-phoenix-1.0', 'leonardo-lucid-origin'] },
  { label: '经典 / 免费', ids: ['flux-1-schnell', 'stable-diffusion-xl-lightning', 'stable-diffusion-xl-base-1.0', 'dreamshaper-8-lcm'] },
];

const MODEL_MAP = new Map(MODELS.map((m) => [m.id, m]));
const DEFAULT_MODEL = 'flux-2-klein-4b';

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));
const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sniffBytes(u8) {
  if (u8[0] === 0x89 && u8[1] === 0x50) return 'image/png';
  if (u8[0] === 0xff && u8[1] === 0xd8) return 'image/jpeg';
  if (u8[8] === 0x57 && u8[9] === 0x45) return 'image/webp';
  return 'image/png';
}

function sniffB64(b64) {
  if (b64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function stripDataUrl(s) {
  return String(s).replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
}

/**
 * 把 ai.run 的四种返回形态统一成 { bytes, mime }
 *  - ReadableStream（SDXL / Lightning / DreamShaper / Phoenix）
 *  - { image: base64 }（FLUX 系列）
 *  - Uint8Array / ArrayBuffer
 *  - { response: base64 }（部分模型的历史返回）
 */
async function extractImage(raw) {
  if (raw == null) throw new Error('模型返回空结果');

  if (typeof raw === 'object' && typeof raw.getReader === 'function') {
    const buf = await new Response(raw).arrayBuffer();
    return { bytes: buf, mime: sniffBytes(new Uint8Array(buf)) };
  }
  if (raw instanceof ArrayBuffer) {
    return { bytes: raw, mime: sniffBytes(new Uint8Array(raw)) };
  }
  if (ArrayBuffer.isView(raw)) {
    const u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    return { bytes: u8.slice().buffer, mime: sniffBytes(u8) };
  }

  const b64raw =
    typeof raw === 'string' ? raw :
    typeof raw.image === 'string' ? raw.image :
    typeof raw.response === 'string' ? raw.response : null;

  if (b64raw) {
    const b64 = stripDataUrl(b64raw);
    return { bytes: b64ToBytes(b64).buffer, mime: sniffB64(b64) };
  }

  throw new Error('无法识别的返回格式：' + Object.keys(raw).join(','));
}

/** 本地估算 neuron 消耗（仅用于额度面板，实际以 Dashboard 为准） */
function estimateNeurons(model, w, h, steps) {
  const p = model.pricing || {};
  const tiles = p.tile ? Math.ceil(w / 512) * Math.ceil(h / 512) : 0;
  let n = 0;
  if (p.perTile) n += tiles * p.perTile;
  if (p.perStep) n += steps * p.perStep;
  if (p.perTilePerStep) n += tiles * steps * p.perTilePerStep;
  if (p.firstMP) {
    const mp = (w * h) / 1048576;
    n += p.firstMP + Math.max(0, mp - 1) * (p.perMP || 0);
  }
  return round2(n);
}

function friendly(err) {
  const msg = String((err && err.message) || err);
  if (/neuron|allocation|quota|used up|limit exceeded/i.test(msg))
    return { status: 429, hint: '今日免费额度可能已用尽（10,000 neurons，00:00 UTC 重置）。换用 FLUX.2 klein 4B 或免费模型，或升级 Workers Paid。' };
  if (/no such model|not found|unknown model/i.test(msg))
    return { status: 400, hint: '模型不存在或已下线：' + msg };
  if (/rate|too many|429/i.test(msg))
    return { status: 429, hint: '触发速率限制（文生图 720 请求/分钟），稍后重试。' };
  if (/timeout|1102|exceeded.*time|CPU/i.test(msg))
    return { status: 504, hint: '生成超时。大模型在免费计划的 30s 请求上限下容易超时，建议降低分辨率/步数，或升级 Workers Paid。' };
  if (/license|partner|paid/i.test(msg))
    return { status: 402, hint: '该模型需要 Workers Paid 计划或预付 AI Gateway credits。' };
  return { status: 500, hint: '生成失败：' + msg };
}

/* ------------------------------------------------------------------ */
/* 额度：优先 Durable Object（原子计数），无绑定时降级 KV（尽力而为）    */
/* ------------------------------------------------------------------ */
async function quotaOp(env, payload) {
  if (env.QUOTA) {
    const stub = env.QUOTA.get(env.QUOTA.idFromName('quota'));
    const res = await stub.fetch('https://quota/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return await res.json();
  }
  // KV 降级：存在并发读改写竞争，仅作兜底
  const day = payload.day;
  const rec = (await env.CACHE?.get('quota:' + day, 'json')) || { neurons: 0, images: 0, byModel: {} };
  if (payload.op === 'usage') return rec;
  if (payload.op === 'reserve') {
    if (rec.neurons + payload.neurons > payload.limit) return { ok: false, reason: 'quota', rec };
    rec.neurons = round2(rec.neurons + payload.neurons);
    rec.images += 1;
    rec.byModel[payload.modelId] = (rec.byModel[payload.modelId] || 0) + 1;
    await env.CACHE?.put('quota:' + day, JSON.stringify(rec), { expirationTtl: 172800 });
    return { ok: true, rec };
  }
  if (payload.op === 'release') {
    rec.neurons = Math.max(0, round2(rec.neurons - payload.neurons));
    rec.images = Math.max(0, rec.images - 1);
    await env.CACHE?.put('quota:' + day, JSON.stringify(rec), { expirationTtl: 172800 });
    return { ok: true, rec };
  }
  return { ok: false, rec };
}

export class Quota {
  constructor(state) {
    this.state = state;
    this.rate = new Map(); // IP -> 当前分钟计数（实例内存，重启即清空）
  }

  async fetch(request) {
    const p = await request.json();
    const dayKey = 'day:' + p.day;
    let rec = (await this.state.storage.get(dayKey)) || { neurons: 0, images: 0, byModel: {} };

    if (p.op === 'usage') return Response.json(rec);

    if (p.op === 'reserve') {
      // 频率限制
      const minute = Math.floor(Date.now() / 60000);
      const rk = p.ip + ':' + minute;
      const hit = (this.rate.get(rk) || 0) + 1;
      this.rate.set(rk, hit);
      if (this.rate.size > 8000) this.rate.clear();
      if (hit > RATE_PER_MIN) return Response.json({ ok: false, reason: 'rate', rec });

      if (rec.neurons + p.neurons > p.limit) {
        return Response.json({ ok: false, reason: 'quota', rec });
      }

      rec.neurons = round2(rec.neurons + p.neurons);
      rec.images += 1;
      rec.byModel[p.modelId] = (rec.byModel[p.modelId] || 0) + 1;
      await this.state.storage.put(dayKey, rec);
      if (p.prevDay && p.prevDay !== p.day) {
        await this.state.storage.delete('day:' + p.prevDay);
      }
      return Response.json({ ok: true, rec });
    }

    if (p.op === 'release') {
      rec.neurons = Math.max(0, round2(rec.neurons - p.neurons));
      rec.images = Math.max(0, rec.images - 1);
      await this.state.storage.put(dayKey, rec);
      return Response.json({ ok: true, rec });
    }

    return Response.json({ ok: false, reason: 'unknown-op' }, { status: 400 });
  }
}

/* ------------------------------------------------------------------ */
/* 生成主流程                                                          */
/* ------------------------------------------------------------------ */
async function generate(env, body, ip) {
  const model = MODEL_MAP.get(body.model);
  if (!model) throw new Error('no such model: ' + body.model);

  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('prompt 不能为空');
  if (prompt.length > 2048) throw new Error('prompt 超过 2048 字符上限');

  const steps = clamp(body.steps ?? model.defaultSteps, 1, model.maxSteps);
  const width = model.size ? clamp(body.width ?? model.size.w, model.size.min, model.size.max) : null;
  const height = model.size ? clamp(body.height ?? model.size.h, model.size.min, model.size.max) : null;
  const guidance = model.defaultGuidance === undefined ? undefined : Number(body.guidance ?? model.defaultGuidance);
  const seed = body.seed == null || body.seed === '' ? undefined : Number(body.seed);
  const negative = model.supportsNegative ? (body.negativePrompt || '').trim() : '';

  // 参考图（仅 FLUX.2 系列）
  const refs = [];
  if (model.supportsReference && Array.isArray(body.references)) {
    for (const item of body.references.slice(0, 4)) {
      const bytes = b64ToBytes(stripDataUrl(item));
      refs.push(new Blob([bytes], { type: sniffBytes(bytes) }));
    }
  }

  /* ---------- 缓存查重 ---------- */
  const refHash = refs.length
    ? await sha256hex(refs.map((b) => b.size).join('|'))
    : '';
  const canonical = JSON.stringify([
    model.key, prompt, negative, width, height, steps, guidance ?? null, seed ?? null, refHash,
  ]);
  const cacheKey = await sha256hex(canonical);

  if (!body.bypassCache && env.CACHE) {
    const meta = await env.CACHE.getWithMetadata('img:' + cacheKey, { type: 'arrayBuffer' });
    if (meta.value) {
      const rec = await quotaOp(env, { op: 'usage', day: utcDay() });
      return {
        ok: true, cached: true, url: '/img/' + cacheKey, mime: meta.metadata?.mime || 'image/png',
        model: model.id, neurons: 0, quota: rec,
      };
    }
  }

  /* ---------- 额度预占 ---------- */
  const est = estimateNeurons(model, width || model.size?.w || 1024, height || model.size?.h || 1024, steps);
  const day = utcDay();
  const prevDay = utcDay(new Date(Date.now() - 86400000));
  const reserved = await quotaOp(env, {
    op: 'reserve', day, prevDay, neurons: est, limit: DAY_LIMIT, modelId: model.id, ip,
  });

  if (!reserved.ok) {
    if (reserved.reason === 'rate') {
      throw new Error('rate: 每分钟最多 ' + RATE_PER_MIN + ' 次生成，请稍候');
    }
    return {
      ok: false, reason: 'quota',
      hint: '今日额度不足：已用 ' + nf(reserved.rec?.neurons) + ' / ' + DAY_LIMIT +
            '，本次需要约 ' + nf(est) + ' neurons。建议改用 FLUX.2 klein 4B（约 104/张）或免费模型。',
      quota: reserved.rec,
    };
  }

  /* ---------- 调用模型 ---------- */
  let raw;
  try {
    if (model.protocol === 'multipart') {
      const form = new FormData();
      form.append('prompt', prompt);
      if (width != null) form.append('width', String(width));
      if (height != null) form.append('height', String(height));
      form.append('steps', String(steps));
      if (guidance != null) form.append('guidance', String(guidance));
      if (seed != null) form.append('seed', String(seed));
      refs.forEach((blob, i) => form.append('input_image_' + i, blob, 'ref' + i + '.png'));

      // FormData 不暴露序列化后的 body/boundary，必须借 Request 触发一次序列化
      const serialized = new Request('http://localhost/', { method: 'POST', body: form });
      raw = await env.AI.run(model.key, {
        multipart: {
          body: serialized.body,
          contentType: serialized.headers.get('content-type') || 'multipart/form-data',
        },
      });
    } else {
      const payload = { prompt };
      if (width != null) payload.width = width;
      if (height != null) payload.height = height;
      if (negative) payload.negative_prompt = negative;
      payload[model.stepsKey] = steps;
      if (guidance != null && model.stepsKey === 'num_steps') payload.guidance = guidance;
      if (seed != null) payload.seed = seed;
      raw = await env.AI.run(model.key, payload);
    }
  } catch (err) {
    // 失败要把预占的额度还回去
    await quotaOp(env, { op: 'release', day, prevDay, neurons: est, modelId: model.id });
    throw err;
  }

  const { bytes, mime } = await extractImage(raw);

  /* ---------- 落盘 + 历史 ---------- */
  let url = null;
  let image = null;

  if (env.CACHE) {
    await env.CACHE.put('img:' + cacheKey, bytes, {
      expirationTtl: CACHE_TTL,
      metadata: { mime, model: model.id, prompt, ts: Date.now() },
    });
    const stamp = String(Date.now()).padStart(13, '0');
    const rand = Math.random().toString(36).slice(2, 8);
    await env.CACHE.put('recent:' + stamp + ':' + rand, '1', {
      expirationTtl: 60 * 60 * 24 * 7,
      metadata: {
        key: cacheKey, mime, model: model.id,
        prompt: prompt.slice(0, 120), ts: Date.now(),
        w: width, h: height, neurons: est,
      },
    });
    url = '/img/' + cacheKey;
  } else {
    image = bytesToB64(bytes); // 没绑定 KV 时直接内联返回
  }

  return {
    ok: true, cached: false, url, image, mime,
    model: model.id, neurons: est,
    size: width && height ? { width, height } : null,
    steps, quota: (await quotaOp(env, { op: 'usage', day })),
  };
}

const nf = (n) => (n == null ? '0' : String(Math.round(n * 10) / 10));

/* ------------------------------------------------------------------ */
/* 前端                                                                */
/* ------------------------------------------------------------------ */
const CLIENT_JS = `
(function () {
  var state = { map: {}, model: null, busy: false };

  function $(id) { return document.getElementById(id); }
  function fmt(n) { n = Number(n) || 0; return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n * 10) / 10); }

  function est(m, w, h, s) {
    var p = m.pricing || {}, tiles = p.tile ? Math.ceil(w / 512) * Math.ceil(h / 512) : 0, n = 0;
    if (p.perTile) n += tiles * p.perTile;
    if (p.perStep) n += s * p.perStep;
    if (p.perTilePerStep) n += tiles * s * p.perTilePerStep;
    if (p.firstMP) { var mp = (w * h) / 1048576; n += p.firstMP + Math.max(0, mp - 1) * (p.perMP || 0); }
    return Math.round(n * 10) / 10;
  }

  fetch('/api/models').then(function (r) { return r.json(); }).then(function (d) {
    d.models.forEach(function (m) { state.map[m.id] = m; });
    var sel = $('model');
    d.groups.forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g.label;
      g.ids.forEach(function (id) {
        var m = state.map[id];
        if (!m) return;
        var o = document.createElement('option');
        o.value = id;
        o.textContent = m.name + (m.badges && m.badges.length ? '  · ' + m.badges.join(' / ') : '');
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.value = d.defaultModel;
    sync();
    refreshQuota();
    loadHistory();
  });

  function sync() {
    var m = state.map[$('model').value];
    state.model = m;
    $('modelDesc').textContent = m.description;
    $('negWrap').style.display = m.supportsNegative ? '' : 'none';
    $('sizeWrap').style.display = m.size ? '' : 'none';
    if (m.size) {
      ['width', 'height'].forEach(function (k) {
        var inp = $(k);
        inp.min = m.size.min; inp.max = m.size.max;
        inp.value = k === 'width' ? m.size.w : m.size.h;
      });
    }
    var st = $('steps');
    st.max = m.maxSteps; st.value = m.defaultSteps;
    $('stepsVal').textContent = m.defaultSteps;
    $('guideWrap').style.display = m.defaultGuidance === undefined ? 'none' : '';
    if (m.defaultGuidance !== undefined) {
      $('guidance').value = m.defaultGuidance;
      $('guideVal').textContent = m.defaultGuidance;
    }
    $('refWrap').style.display = m.supportsReference ? '' : 'none';
    $('lic').textContent = m.license === 'ok' ? '商用友好' : '商用需确认 BFL 许可';
    cost();
  }

  function cost() {
    var m = state.model; if (!m) return;
    var w = m.size ? Number($('width').value) || m.size.w : 1024;
    var h = m.size ? Number($('height').value) || m.size.h : 1024;
    var n = est(m, w, h, Number($('steps').value));
    var daily = n > 0 ? Math.floor(10000 / n) : 999;
    $('cost').textContent = '估算 ' + fmt(n) + ' neurons/张 · 满额约可出 ' + daily + ' 张/天';
  }

  function refreshQuota() {
    fetch('/api/quota').then(function (r) { return r.json(); }).then(function (q) {
      var pct = Math.min(100, (q.used / q.limit) * 100);
      $('quotaBar').style.width = pct + '%';
      $('quotaBar').className = pct > 85 ? 'danger' : pct > 60 ? 'warn' : '';
      var left = Math.max(0, q.limit - q.used);
      $('quotaText').textContent = '今日已用 ' + fmt(q.used) + ' / ' + fmt(q.limit) +
        ' neurons（约 ' + q.images + ' 张）· 剩余 ' + fmt(left) + ' · ' + q.resetIn + ' 后重置';
    });
  }

  function loadHistory() {
    fetch('/api/history').then(function (r) { return r.json(); }).then(function (d) {
      var g = $('gallery');
      g.innerHTML = '';
      if (!d.items.length) { g.innerHTML = '<p class="hint">还没有生成记录</p>'; return; }
      d.items.forEach(function (it) {
        var card = document.createElement('div');
        card.className = 'card';
        var img = document.createElement('img');
        img.src = it.url; img.loading = 'lazy'; img.alt = it.prompt;
        var cap = document.createElement('span');
        cap.textContent = it.model.replace('flux-2-', 'f2-');
        card.appendChild(img); card.appendChild(cap);
        card.onclick = function () {
          $('stage').innerHTML = '';
          var big = document.createElement('img'); big.src = it.url;
          $('stage').appendChild(big);
          $('meta').textContent = it.prompt;
        };
        g.appendChild(card);
      });
    });
  }

  function fileToB64(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function setBusy(on, msg) {
    state.busy = on;
    $('btn').disabled = on;
    $('btn').textContent = on ? msg : '生成';
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show';
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.className = 'toast'; }, 5200);
  }

  async function generate() {
    if (state.busy) return;
    var m = state.model;
    var prompt = $('prompt').value.trim();
    if (!prompt) { toast('先写点提示词'); return; }

    var body = { model: m.id, prompt: prompt, steps: Number($('steps').value), bypassCache: $('bypass').checked };
    if (m.size) { body.width = Number($('width').value); body.height = Number($('height').value); }
    if (m.supportsNegative && $('negative').value.trim()) body.negativePrompt = $('negative').value.trim();
    if (m.defaultGuidance !== undefined) body.guidance = Number($('guidance').value);
    if ($('seed').value) body.seed = Number($('seed').value);
    if (m.supportsReference && $('refs').files.length) {
      var arr = [];
      for (var i = 0; i < $('refs').files.length && i < 4; i++) arr.push(await fileToB64($('refs').files[i]));
      body.references = arr;
    }

    setBusy(true, '生成中…');
    var t0 = Date.now();
    try {
      var res = await fetch('/api/generate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      var data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.hint || data.error || '生成失败');

      $('stage').innerHTML = '';
      var img = document.createElement('img');
      img.src = data.url || ('data:' + data.mime + ';base64,' + data.image);
      $('stage').appendChild(img);

      var secs = ((Date.now() - t0) / 1000).toFixed(1);
      $('meta').textContent = (data.cached ? '命中缓存 · ' : '') + secs + 's · ' +
        (data.neurons ? fmt(data.neurons) + ' neurons' : '免费') +
        (data.size ? ' · ' + data.size.width + '×' + data.size.height : '');

      refreshQuota();
      loadHistory();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }

  $('model').addEventListener('change', sync);
  ['width', 'height'].forEach(function (k) { $(k).addEventListener('input', cost); });
  $('steps').addEventListener('input', function () { $('stepsVal').textContent = this.value; cost(); });
  $('guidance').addEventListener('input', function () { $('guideVal').textContent = this.value; });
  $('btn').addEventListener('click', generate);
  $('prompt').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate();
  });
})();
`;

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Workers AI 文生图工作室</title>
<style>
  :root{
    --bg:#0d0f12; --panel:#15181d; --line:#23272e; --fg:#e7e9ec;
    --dim:#8b929e; --accent:#f48120; --ok:#3fb950; --warn:#d29922; --danger:#f85149;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
    font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .app{display:grid;grid-template-columns:360px 1fr;min-height:100vh}
  @media(max-width:860px){.app{grid-template-columns:1fr}}
  aside{border-right:1px solid var(--line);padding:20px;display:flex;flex-direction:column;gap:14px;
    background:var(--panel);position:sticky;top:0;height:100vh;overflow:auto}
  .brand{font-weight:650;font-size:16px;letter-spacing:.2px}
  .brand span{color:var(--accent)}
  .brand small{display:block;font-weight:400;color:var(--dim);font-size:12px;margin-top:2px}
  label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dim)}
  label span.v{color:var(--fg);font-variant-numeric:tabular-nums}
  select,textarea,input[type=number],input[type=file]{
    width:100%;background:#0b0d10;color:var(--fg);border:1px solid var(--line);
    border-radius:8px;padding:9px 10px;font:inherit;outline:none}
  select:focus,textarea:focus,input:focus{border-color:var(--accent)}
  textarea{resize:vertical;font-family:inherit}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  input[type=range]{width:100%;accent-color:var(--accent)}
  .hint{color:var(--dim);font-size:12px;margin:0;line-height:1.5}
  .go{background:var(--accent);color:#0d0f12;border:0;border-radius:9px;padding:11px;
    font-weight:650;font-size:14px;cursor:pointer;transition:.15s}
  .go:hover{filter:brightness(1.1)}
  .go:disabled{opacity:.55;cursor:not-allowed}
  .check{flex-direction:row;align-items:center;gap:8px;cursor:pointer}
  .check input{width:auto;accent-color:var(--accent)}
  main{padding:20px 24px;display:flex;flex-direction:column;gap:16px;min-width:0}
  .quotawrap{display:flex;flex-direction:column;gap:6px}
  .quotabar{height:7px;border-radius:99px;background:#1c2027;overflow:hidden}
  .quotabar i{display:block;height:100%;width:0;background:var(--ok);transition:width .4s}
  .quotabar i.warn{background:var(--warn)}
  .quotabar i.danger{background:var(--danger)}
  .stage{flex:1;min-height:340px;border:1px solid var(--line);border-radius:14px;
    display:grid;place-items:center;background:
      repeating-conic-gradient(#16191e 0% 25%,#1a1e24 0% 50%) 50%/22px 22px;padding:14px}
  .stage img{max-width:100%;max-height:70vh;border-radius:8px;box-shadow:0 8px 34px #0009}
  h3{margin:0;font-size:13px;color:var(--dim);font-weight:500}
  .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}
  .card{position:relative;border-radius:9px;overflow:hidden;cursor:pointer;
    border:1px solid var(--line);aspect-ratio:1;background:#111419}
  .card img{width:100%;height:100%;object-fit:cover;display:block;transition:.2s}
  .card:hover img{opacity:.75}
  .card span{position:absolute;left:0;right:0;bottom:0;font-size:10px;padding:3px 5px;
    background:#000a;color:#cfd4db;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,20px);opacity:0;
    background:#1f242c;border:1px solid var(--line);color:var(--fg);padding:11px 16px;
    border-radius:10px;max-width:min(520px,90vw);font-size:13px;pointer-events:none;
    transition:.25s;z-index:9}
  .toast.show{opacity:1;transform:translate(-50%,0)}
</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="brand">Workers AI <span>文生图</span>
      <small>10 个模型 · KV 缓存 · 额度估算</small>
    </div>

    <label>模型<select id="model"></select></label>
    <p id="modelDesc" class="hint"></p>

    <label>提示词
      <textarea id="prompt" rows="4" placeholder="a cyberpunk lizard in neon rain, 35mm, shallow depth of field"></textarea>
    </label>

    <label id="negWrap">反向提示词
      <textarea id="negative" rows="2" placeholder="blurry, watermark, extra fingers"></textarea>
    </label>

    <div id="sizeWrap" class="row">
      <label>宽<input id="width" type="number" step="64"></label>
      <label>高<input id="height" type="number" step="64"></label>
    </div>

    <label>步数 <span class="v" id="stepsVal"></span><input id="steps" type="range" min="1"></label>

    <label id="guideWrap">guidance <span class="v" id="guideVal"></span>
      <input id="guidance" type="range" min="0" max="10" step="0.5">
    </label>

    <label>seed（留空随机）<input id="seed" type="number" placeholder="42"></label>

    <label id="refWrap">参考图（最多 4 张，multipart 上传）
      <input id="refs" type="file" accept="image/*" multiple>
    </label>

    <label class="check"><input id="bypass" type="checkbox"> 跳过缓存，强制重新生成</label>

    <button id="btn" class="go">生成</button>
    <p class="hint" id="cost"></p>
    <p class="hint">许可：<span id="lic"></span></p>
  </aside>

  <main>
    <div class="quotawrap">
      <div class="quotabar"><i id="quotaBar"></i></div>
      <div class="hint" id="quotaText">正在读取额度…</div>
    </div>

    <div id="stage" class="stage">
      <p class="hint">写好提示词，点“生成”。Ctrl/⌘ + Enter 也可以。</p>
    </div>
    <p class="hint" id="meta"></p>

    <h3>最近生成</h3>
    <div id="gallery" class="gallery"></div>
  </main>
</div>
<div id="toast" class="toast"></div>
<script>${CLIENT_JS}</script>
</body>
</html>`;

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    // ---- 首页 ----
    if (p === '/' || p === '/index.html') {
      return new Response(HTML, {
        headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-cache' },
      });
    }

    // ---- 模型清单 ----
    if (p === '/api/models') {
      return json({
        defaultModel: DEFAULT_MODEL,
        groups: GROUPS,
        models: MODELS.map((m) => ({
          id: m.id, name: m.name, description: m.description,
          size: m.size, maxSteps: m.maxSteps, defaultSteps: m.defaultSteps,
          defaultGuidance: m.defaultGuidance, supportsNegative: m.supportsNegative,
          supportsReference: !!m.supportsReference, badges: m.badges,
          license: m.license, pricing: m.pricing,
          estimatedNeurons: estimateNeurons(m, m.size?.w || 1024, m.size?.h || 1024, m.defaultSteps),
        })),
      });
    }

    // ---- 额度 ----
    if (p === '/api/quota') {
      const day = utcDay();
      const rec = await quotaOp(env, { op: 'usage', day });
      const next = new Date();
      next.setUTCHours(24, 0, 0, 0);
      const mins = Math.max(0, Math.round((next - Date.now()) / 60000));
      return json({
        day, used: round2(rec.neurons || 0), images: rec.images || 0,
        limit: DAY_LIMIT, remaining: Math.max(0, round2(DAY_LIMIT - (rec.neurons || 0))),
        byModel: rec.byModel || {},
        resetIn: mins >= 60 ? Math.floor(mins / 60) + ' 小时' : mins + ' 分钟',
      });
    }

    // ---- 历史 ----
    if (p === '/api/history') {
      if (!env.CACHE) return json({ items: [] });
      const list = await env.CACHE.list({ prefix: 'recent:', limit: 200 });
      const items = list.keys
        .map((k) => k.metadata)
        .filter((m) => m && m.key)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 36)
        .map((m) => ({
          url: '/img/' + m.key, model: m.model, prompt: m.prompt,
          ts: m.ts, neurons: m.neurons, w: m.w, h: m.h,
        }));
      return json({ items });
    }

    // ---- 图片读取 ----
    if (p.startsWith('/img/')) {
      if (!env.CACHE) return new Response('Cache not configured', { status: 501 });
      const key = p.slice(5);
      if (!/^[a-f0-9]{64}$/.test(key)) return new Response('Bad key', { status: 400 });
      const hit = await env.CACHE.getWithMetadata('img:' + key, { type: 'arrayBuffer' });
      if (!hit.value) return new Response('Not found', { status: 404 });
      return new Response(hit.value, {
        headers: {
          'content-type': hit.metadata?.mime || 'image/png',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // ---- 生成 ----
    if (p === '/api/generate' && req.method === 'POST') {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'body 必须是 JSON' }, 400);
      }

      const ip = req.headers.get('cf-connecting-ip') || '0.0.0.0';

      try {
        const result = await generate(env, body, ip);
        return json(result, result.ok === false ? 429 : 200);
      } catch (err) {
        const f = friendly(err);
        return json({ ok: false, error: String((err && err.message) || err), hint: f.hint }, f.status);
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};