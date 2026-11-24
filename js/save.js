export const SAVE_VERSION = 1;
export const GENERATION_VERSION = 2;

async function access(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('deadwood', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('campaign');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Save storage is open in another tab.'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('campaign', mode);
      const request = operation(tx.objectStore('campaign'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error || request.error);
    });
  } finally { db.close(); }
}
export const readSave = () => access('readonly', (store) => store.get('latest'));
export const writeSave = (data) => access('readwrite', (store) => store.put(data, 'latest'));

export function isValidSave(s, seed, items, species, guns) {
  const num = (n, a, b) => Number.isFinite(n) && n >= a && n <= b;
  const list = (value, fn) => Array.isArray(value) && value.every(fn);
  const xy = (p) => p && num(p.x, -2000, 2000) && num(p.z, -2000, 2000);
  const ids = (a) => list(a, (id) => typeof id === 'string' || Number.isInteger(id));
  return s?.version === SAVE_VERSION && s.generation === GENERATION_VERSION && s.seed === seed &&
    xy(s.player) && num(s.player.y, -100, 300) && num(s.player.health, 0.01, 100) && num(s.player.stamina, 0, 100) &&
    Number.isFinite(s.player.yaw) && num(s.player.pitch, -2, 2) && s.state && num(s.state.wave, 1, 1e9) &&
    num(s.state.infection, 0, 5) && num(s.state.battery, 0, 100) && ['active', 'prep'].includes(s.state.waveState) &&
    s.slots?.length === 12 && list(s.slots, (v) => v === null || (v && Object.hasOwn(items, v.type) && Number.isInteger(v.n) && num(v.n, 1, items[v.type].stack))) &&
    s.ammo?.length === guns.length && list(s.ammo, (a) => a && num(a.mag, 0, 100) && num(a.reserve, 0, 1e12)) &&
    Number.isInteger(s.weapon) && num(s.weapon, 0, guns.length - 1) && s.progress &&
    ['taken', 'nests', 'cultists', 'hostile', 'hanging', 'villages', 'worms', 'stones', 'explored'].every((k) => ids(s[k])) &&
    list(s.blood, (p) => xy(p) && num(p.angle, 0, 7) && num(p.s, 0.5, 3)) &&
    list(s.supplies, (p) => xy(p) && Object.hasOwn(items, p.type) && num(p.base, -100, 300) && num(p.count, 1, 1000)) &&
    list(s.partial, (p) => Array.isArray(p) && typeof p[0] === 'string' && num(p[1], 1, 1000)) &&
    list(s.enemies, (e) => xy(e) && typeof e.type === 'string' && num(e.hp, 0.01, 100000) &&
      Number.isFinite(e.yaw) && num(e.speedMul, 0.1, 5) && list(e.broken, (l) => ['armL', 'armR', 'legL', 'legR'].includes(l))) &&
    list(s.animals?.records, (a) => xy(a) && typeof a.id === 'string' && typeof a.name === 'string' &&
      Object.hasOwn(species, a.species) && num(a.y, -100, 300) && num(a.hp, 0, 500) && num(a.trust, 0, 100) && num(a.flesh, 0, 10));
}
