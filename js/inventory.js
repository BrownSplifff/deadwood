// =====================================================================================
//  12-slot inventory (4 x 3) with stacking, item actions and drag-and-drop.
//  Item behaviour (what "Use" does) lives in main.js; this module only knows the data.
// =====================================================================================
export const ITEMS = {
  ammo:    { name: 'Ammo Box', icon: '▤', color: '#b8a84a', stack: 10, use: 'Load', desc: 'Rounds for all three guns. Used automatically when you reload with an empty reserve.' },
  med:     { name: 'Medical Kit', icon: '✚', color: '#e05050', stack: 5, use: 'Use', desc: 'Restores 50 health. Quick use: H.' },
  battery: { name: 'Battery', icon: '▮', color: '#5ad8ff', stack: 5, use: 'Swap', desc: 'Fresh flashlight battery. Quick use: B.' },
  flesh:   { name: 'Infected Flesh', icon: '❦', color: '#8ad04a', stack: 6, use: 'Eat', desc: 'Raw, rotten zombie meat. +30% speed and damage per piece, but the infection spreads and drains your stamina. Six pieces will turn you.' },
  canned:  { name: 'Canned Food', icon: '◍', color: '#c08850', stack: 5, use: 'Eat', desc: 'Old but sealed. Restores 10 health and some stamina.' },
  water:   { name: 'Water Bottle', icon: '◐', color: '#6aa8e8', stack: 5, use: 'Drink', desc: 'Restores stamina.' },
  coin:    { name: 'Ancient Coin', icon: '◉', color: '#e0b840', stack: 50, desc: 'Gold coin stamped with a forgotten king.' },
  bandage: { name: 'Mummy Bandage', icon: '≋', color: '#d8c8a0', stack: 10, desc: 'Ancient linen, still faintly warm.' },
  relic:   { name: 'Ancient Relic', icon: '☥', color: '#d8a030', stack: 3, desc: 'A small idol of a jackal-headed god.' },
  cloth:   { name: 'Cloth', icon: '▦', color: '#9a7a6a', stack: 10, desc: 'Ritual cloth from the desert camps.' },
  eye:     { name: 'Eye of the Pharaoh', icon: '◈', color: '#40ffd0', stack: 1, desc: 'Unique relic torn from the Ancient Mummy. It still watches.' },
  seal:    { name: 'Desert Seal', icon: '⬢', color: '#ffcf60', stack: 1, desc: 'Proof that the Ancient Mummy has fallen. Something beyond the desert will answer to it.' },
};

export class Inventory {
  constructor(size = 12) { this.size = size; this.slots = new Array(size).fill(null); this.onChange = null; }
  clear() { this.slots.fill(null); this.changed(); }
  changed() { if (this.onChange) this.onChange(); }
  count(type) { return this.slots.reduce((n, s) => n + (s && s.type === type ? s.n : 0), 0); }
  /** add n items; returns how many did NOT fit */
  add(type, n = 1) {
    const max = ITEMS[type].stack;
    for (const s of this.slots) if (n > 0 && s && s.type === type && s.n < max) { const k = Math.min(n, max - s.n); s.n += k; n -= k; }
    for (let i = 0; i < this.size && n > 0; i++) if (!this.slots[i]) { const k = Math.min(n, max); this.slots[i] = { type, n: k }; n -= k; }
    this.changed();
    return n;
  }
  canAdd(type, n = 1) {
    const max = ITEMS[type].stack;
    let room = 0;
    for (const s of this.slots) room += !s ? max : s.type === type ? max - s.n : 0;
    return room >= n;
  }
  removeAt(i, n = 1) {
    const s = this.slots[i]; if (!s) return 0;
    const k = Math.min(n, s.n); s.n -= k; if (s.n <= 0) this.slots[i] = null;
    this.changed(); return k;
  }
  remove(type, n = 1) {
    let done = 0;
    for (let i = this.size - 1; i >= 0 && done < n; i--) if (this.slots[i] && this.slots[i].type === type) done += this.removeAt(i, n - done);
    return done;
  }
  indexOf(type) { return this.slots.findIndex((s) => s && s.type === type); }
  /** drag-and-drop: merge stacks of the same item, otherwise swap */
  move(from, to) {
    if (from === to) return;
    const a = this.slots[from], b = this.slots[to];
    if (a && b && a.type === b.type) {
      const max = ITEMS[a.type].stack, k = Math.min(a.n, max - b.n);
      b.n += k; a.n -= k; if (a.n <= 0) this.slots[from] = null;
    } else { this.slots[from] = b; this.slots[to] = a; }
    this.changed();
  }
}

/** DOM view of the inventory. handlers: { use(i), drop(i, all), close() } */
export class InventoryUI {
  constructor(inv, root, handlers) {
    this.inv = inv; this.root = root; this.h = handlers; this.sel = -1; this.isOpen = false;
    this.grid = root.querySelector('.inv-grid'); this.info = root.querySelector('.inv-info'); this.menu = root.querySelector('.inv-menu');
    this.grid.innerHTML = '';
    for (let i = 0; i < inv.size; i++) {
      const d = document.createElement('div'); d.className = 'inv-slot'; d.dataset.i = i; d.draggable = true;
      d.addEventListener('click', () => { this.select(i); this.hideMenu(); });
      d.addEventListener('contextmenu', (e) => { e.preventDefault(); this.select(i); this.showMenu(i, e.clientX, e.clientY); });
      d.addEventListener('dragstart', (e) => { if (!inv.slots[i]) { e.preventDefault(); return; } e.dataTransfer.setData('text/plain', String(i)); d.classList.add('dragging'); });
      d.addEventListener('dragend', () => d.classList.remove('dragging'));
      d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('over'); });
      d.addEventListener('dragleave', () => d.classList.remove('over'));
      d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('over'); const from = +e.dataTransfer.getData('text/plain'); inv.move(from, i); this.select(i); });
      this.grid.appendChild(d);
    }
    root.addEventListener('click', (e) => { if (!e.target.closest('.inv-menu') && !e.target.closest('.inv-slot')) this.hideMenu(); });
    this.menu.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const i = +this.menu.dataset.i, act = b.dataset.act;
      this.hideMenu();
      if (act === 'use') this.h.use(i);
      else if (act === 'drop') this.h.drop(i, false);
      else if (act === 'dropall') this.h.drop(i, true);
    });
    inv.onChange = () => this.render();
    this.render();
  }
  open() { this.isOpen = true; this.root.classList.remove('hidden'); this.render(); }
  close() { this.isOpen = false; this.root.classList.add('hidden'); this.hideMenu(); }
  select(i) { this.sel = i; this.render(); }
  showMenu(i, x, y) {
    const s = this.inv.slots[i]; if (!s) { this.hideMenu(); return; }
    const it = ITEMS[s.type];
    this.menu.dataset.i = i;
    this.menu.innerHTML = (it.use ? `<button data-act="use">${it.use}${s.type === 'flesh' && this.h.fatal && this.h.fatal() ? ' (FATAL)' : ''}</button>` : '') +
      `<button data-act="drop">Drop one [G]</button>` + (s.n > 1 ? '<button data-act="dropall">Drop stack</button>' : '');
    const r = (this.menu.offsetParent || this.root).getBoundingClientRect();
    this.menu.style.left = (x - r.left) + 'px'; this.menu.style.top = (y - r.top) + 'px';
    this.menu.classList.remove('hidden');
  }
  hideMenu() { this.menu.classList.add('hidden'); }
  render() {
    const slots = this.grid.children;
    for (let i = 0; i < this.inv.size; i++) {
      const s = this.inv.slots[i], d = slots[i];
      d.classList.toggle('sel', i === this.sel);
      if (!s) { d.innerHTML = ''; d.title = ''; continue; }
      const it = ITEMS[s.type];
      d.innerHTML = `<span class="ico" style="color:${it.color}">${it.icon}</span><span class="nm">${it.name}</span>${s.n > 1 ? `<span class="qty">${s.n}</span>` : ''}`;
      d.title = it.name;
    }
    const s = this.inv.slots[this.sel];
    if (s) {
      const it = ITEMS[s.type];
      this.info.innerHTML = `<h3 style="color:${it.color}">${it.icon} ${it.name}</h3><p>${it.desc}</p><p class="q">Quantity: ${s.n} / ${it.stack}</p>` + (this.h.extraInfo ? this.h.extraInfo(s) : '') + `<p class="hint">Right-click for actions · G drops one · drag to rearrange</p>`;
    } else this.info.innerHTML = `<h3>Inventory</h3><p>Select an item. Right-click for actions. Drag items between slots.</p><p class="q">${this.inv.slots.filter(Boolean).length} / ${this.inv.size} slots used</p>`;
  }
}
