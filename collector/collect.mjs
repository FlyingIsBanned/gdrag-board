// Hourly SkyBlock data collector for the GDrag Flip Board.
// GitHub Actions runs this every hour (Node 20+, no dependencies). It writes small JSON files
// into data/, which the web page reads, so history keeps building while nobody has the page open.
//
//   data/pets.json    XP snapshots for tracked pets (needs the HYPIXEL_API_KEY secret)
//   data/bazaar.json  hourly buy order / sell order for the items in config.json
//   data/gdrag.json   hourly cheapest clean Lvl 200 Golden Dragon and best profit per level
//   data/status.json  when the job last ran and anything that went wrong

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const API = 'https://api.hypixel.net/v2/skyblock';
const KEY = (process.env.HYPIXEL_API_KEY || '').trim();
const NOW = Date.now();
const HOUR = 36e5, DAY = 24 * HOUR;
const KEEP = 120 * DAY;              // how much bazaar and Golden Dragon price history to keep
const PLAYER_GAP = 50 * 60e3;        // Hypixel asks for no more than one request per player per hour
const IDLE_POINT = 6 * HOUR;         // save a pet point at least this often even when its XP hasn't moved
const XP_100 = 25353230, XP_PER_LEVEL = 1886700, XP_200 = XP_100 + 100 * XP_PER_LEVEL;

const root = new URL('../', import.meta.url);
const at = p => new URL(p, root);
async function readJSON(p, fallback) {
  try { return JSON.parse(await readFile(at(p), 'utf8')); } catch { return fallback; }
}
const writeJSON = (p, v) => writeFile(at(p), JSON.stringify(v) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, headers = {}, tries = 3) {
  let last;
  for (let t = 1; t <= tries; t++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      const j = await r.json().catch(() => null);
      if (r.ok && j && j.success !== false) return j;
      const cause = j?.cause || `HTTP ${r.status}`;
      if (r.status === 403) {
        throw Object.assign(new Error(`Hypixel rejected the API key (${cause}). Put a working key in the HYPIXEL_API_KEY repository secret.`), { fatal: true });
      }
      last = new Error(cause);
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break;   // won't fix itself on retry
    } catch (e) {
      if (e.fatal) throw e;
      last = e;
    }
    if (t < tries) await sleep(1500 * t);
  }
  throw last;
}

// ---------- item_bytes: base64 -> gzip -> NBT ----------
const td = new TextDecoder();
function parseNBT(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const str = () => { const l = dv.getUint16(o); o += 2; const s = td.decode(buf.subarray(o, o + l)); o += l; return s; };
  const pl = t => {
    switch (t) {
      case 1: { const v = dv.getInt8(o); o += 1; return v; }
      case 2: { const v = dv.getInt16(o); o += 2; return v; }
      case 3: { const v = dv.getInt32(o); o += 4; return v; }
      case 4: { const v = dv.getBigInt64(o); o += 8; return Number(v); }
      case 5: { const v = dv.getFloat32(o); o += 4; return v; }
      case 6: { const v = dv.getFloat64(o); o += 8; return v; }
      case 7: { const l = dv.getInt32(o); o += 4 + l; return null; }
      case 8: return str();
      case 9: { const et = dv.getInt8(o); o += 1; const l = dv.getInt32(o); o += 4; const a = []; for (let i = 0; i < l; i++) a.push(pl(et)); return a; }
      case 10: { const c = {}; for (;;) { const tt = dv.getInt8(o); o += 1; if (tt === 0) break; const n = str(); c[n] = pl(tt); } return c; }
      case 11: { const l = dv.getInt32(o); o += 4 + 4 * l; return null; }
      case 12: { const l = dv.getInt32(o); o += 4 + 8 * l; return null; }
      default: throw new Error('Unknown NBT tag ' + t);
    }
  };
  const t = dv.getInt8(o); o += 1; str();
  return pl(t);
}

// ---------- pets ----------
async function resolvePlayer(entry, known) {
  const raw = String(entry).trim(), plain = raw.replace(/-/g, '').toLowerCase();
  const isUuid = /^[0-9a-f]{32}$/.test(plain);
  try {
    const j = await getJSON(`https://playerdb.co/api/player/minecraft/${encodeURIComponent(isUuid ? plain : raw)}`,
      { 'User-Agent': 'gdrag-flip-board (GitHub Actions)' }, 2);
    const p = j?.data?.player;
    if (p?.raw_id) return { uuid: p.raw_id.toLowerCase(), name: p.username };
  } catch { /* fall back to what we already know */ }
  if (isUuid) return { uuid: plain, name: known[plain]?.name || raw };
  const hit = Object.entries(known).find(([, v]) => v.name?.toLowerCase() === raw.toLowerCase());
  if (hit) return { uuid: hit[0], name: hit[1].name };
  throw new Error(`Couldn't find a Minecraft player called "${raw}". Check the players list in config.json.`);
}

async function collectPets(config, log) {
  const store = await readJSON('data/pets.json', {});
  store.players ||= {}; store.pets ||= {};
  const players = (config.players || []).filter(p => p && !/^YOUR_/i.test(p));
  if (!players.length) { log.errors.push('pets: No players are listed in config.json yet.'); return store; }
  if (!KEY) { log.errors.push('pets: The HYPIXEL_API_KEY repository secret isn\'t set, so pets weren\'t checked.'); return store; }
  const types = new Set(config.petTypes || ['GOLDEN_DRAGON']);
  const extra = new Set((config.petUuids || []).map(String));

  for (const entry of players) {
    let who;
    try {
      who = await resolvePlayer(entry, store.players);
      const pl = (store.players[who.uuid] ||= {});
      pl.name = who.name;
      if (NOW - (pl.checked || 0) < PLAYER_GAP) { log.notes.push(`pets: ${who.name} was checked under an hour ago, skipped.`); continue; }
      const j = await getJSON(`${API}/profiles?uuid=${who.uuid}`, { 'API-Key': KEY });
      pl.checked = NOW;
      let n = 0;
      for (const prof of j.profiles || []) {
        const m = prof.members?.[who.uuid];
        for (const p of m?.pets_data?.pets || m?.pets || []) {
          const id = p?.uuid || p?.uniqueId;
          if (!id || !p.type || !(types.has(p.type) || extra.has(id))) continue;
          const exp = Number(p.exp) || 0;
          const t = (store.pets[id] ||= { owner: who.uuid, since: NOW, history: [] });
          Object.assign(t, {
            owner: who.uuid, ownerName: who.name, profile: prof.cute_name || '', type: p.type, tier: p.tier,
            held: p.heldItem || null, candy: p.candyUsed || 0, skin: p.skin || null, active: !!p.active, lastSeen: NOW,
          });
          const last = t.history[t.history.length - 1];
          if (!last || last[1] !== exp || NOW - last[0] >= IDLE_POINT) t.history.push([NOW, exp]);
          n++;
        }
      }
      log.notes.push(`pets: ${who.name}, ${n} tracked pet${n === 1 ? '' : 's'} found.`);
    } catch (e) {
      log.errors.push(`pets: ${who ? who.name + ': ' : ''}${e.message}`);
      if (e.fatal) break;   // a bad key fails for every player, no point asking again
    }
  }
  store.updated = NOW;
  return store;
}

// ---------- bazaar ----------
async function collectBazaar(config, log) {
  const store = await readJSON('data/bazaar.json', {});
  store.items ||= {};
  const j = await getJSON(`${API}/bazaar`);
  for (const it of config.bazaar || []) {
    const p = j.products?.[it.id];
    if (!p) { log.errors.push(`bazaar: ${it.id} isn't on the bazaar. Check the id in config.json.`); continue; }
    // API naming is from the instant-trade side: sell_summary = buy orders, buy_summary = sell offers
    const h = (store.items[it.id] ||= []);
    h.push([j.lastUpdated || NOW, p.sell_summary?.[0]?.pricePerUnit ?? null, p.buy_summary?.[0]?.pricePerUnit ?? null]);
    store.items[it.id] = h.filter(r => r[0] >= NOW - KEEP);
  }
  store.updated = NOW;
  return store;
}

// ---------- Golden Dragon auction summary ----------
function readDragon(a) {
  try {
    const ea = parseNBT(gunzipSync(Buffer.from(a.item_bytes, 'base64')))?.i?.[0]?.tag?.ExtraAttributes;
    if (!ea || ea.id !== 'PET' || !ea.petInfo) return null;
    const pi = JSON.parse(ea.petInfo);
    if (pi.type !== 'GOLDEN_DRAGON') return null;
    const m = a.item_name.match(/\[Lvl (\d+)\]/);
    return {
      uuid: a.uuid, level: m ? +m[1] : 0, exp: Number(pi.exp) || 0, candy: pi.candyUsed || 0, skin: pi.skin || null,
      bin: !!a.bin, price: a.bin ? a.starting_bid : (a.highest_bid_amount || a.starting_bid), end: a.end,
    };
  } catch { return null; }
}
async function collectGdrag(log) {
  const store = await readJSON('data/gdrag.json', {});
  store.history ||= [];
  const first = await getJSON(`${API}/auctions?page=0`);
  const found = new Map();
  const absorb = page => {
    for (const a of page?.auctions || []) {
      if (!a.item_name || !a.item_name.includes('Golden Dragon')) continue;
      const d = readDragon(a);
      if (d) found.set(d.uuid, d);
    }
  };
  absorb(first);
  const total = first.totalPages || 1;
  let missed = 0;
  for (let p = 1; p < total; p += 6) {
    const batch = await Promise.all(Array.from({ length: Math.min(6, total - p) }, (_, i) =>
      getJSON(`${API}/auctions?page=${p + i}`).catch(() => { if (p + i !== total - 1) missed++; return null; })));
    batch.forEach(absorb);   // handle page by page so memory stays small
  }
  // A missing page could hide the cheapest listing, so skip the hour rather than save a wrong price.
  // (The last page is allowed to vanish: it disappears when the listing count drops mid-scan.)
  if (missed) throw new Error(`${missed} auction page${missed === 1 ? '' : 's'} failed to load, so this hour's Golden Dragon prices were skipped.`);

  const clean = [...found.values()].filter(d => d.candy === 0 && !d.skin && (!d.end || d.end > NOW));
  const l200 = clean.filter(d => d.level >= 200 && d.bin).sort((a, b) => a.price - b.price);
  const ref = l200[0]?.price ?? null;
  const mid = clean.filter(d => d.level >= 100 && d.level < 200).map(d => {
    const lvLeft = Math.max(0, XP_200 - d.exp) / XP_PER_LEVEL;
    const profit = ref != null ? ref - d.price : null;
    return { ...d, lvLeft, profit, ppl: profit != null && lvLeft > 0 ? profit / lvLeft : null };
  });
  const top = mid.filter(d => d.bin && d.ppl != null).sort((a, b) => b.ppl - a.ppl).slice(0, 5);
  const snap = first.lastUpdated || NOW;
  store.history.push([snap, ref, top[0] ? Math.round(top[0].ppl) : null, mid.length, l200.length]);
  store.history = store.history.filter(r => r[0] >= NOW - KEEP);
  store.latest = {
    at: snap, cheapest200: ref, listed100to199: mid.length, clean200Listed: l200.length,
    top: top.map(d => ({ uuid: d.uuid, level: d.level, exp: d.exp, price: d.price, ppl: Math.round(d.ppl) })),
  };
  store.updated = NOW;
  log.notes.push(`gdrag: scanned ${total} pages, cheapest clean Lvl 200 ${ref ?? 'none'}, ${mid.length} Lvl 100-199 listed.`);
  return store;
}

// ---------- run ----------
const config = await readJSON('config.json', {});
await mkdir(at('data/'), { recursive: true });
const log = { notes: [], errors: [] };
const jobs = { pets: () => collectPets(config, log), bazaar: () => collectBazaar(config, log), gdrag: () => collectGdrag(log) };
let saved = 0;
for (const [name, job] of Object.entries(jobs)) {
  try { await writeJSON(`data/${name}.json`, await job()); saved++; }
  catch (e) { log.errors.push(`${name}: ${e.message}`); }
}
await writeJSON('data/status.json', { updated: NOW, keySet: !!KEY, notes: log.notes, errors: log.errors });
for (const n of log.notes) console.log(n);
for (const e of log.errors) console.log('::warning::' + e);
if (!saved) process.exitCode = 1;
