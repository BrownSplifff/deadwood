import { FEED_TRUST, MAX_TRUST, SPECIES, stats } from './animals.js';

export function button(panel, label, action, disabled = false) {
  const el = document.createElement('button');
  el.textContent = label; el.onclick = action; el.disabled = disabled; panel.append(el);
  return el;
}

export class Companions {
  constructor(animals, inventory, panel, hud) { Object.assign(this, { animals, inventory, panel, hud }); }
  show(a, close, mount) {
    const s = stats(a), spec = SPECIES[a.species];
    const title = document.createElement('h2'), info = document.createElement('p');
    title.textContent = a.name;
    info.textContent = `${a.species} · HP ${Math.ceil(a.hp)}/${Math.round(s.max)} (base ${spec.hp}) · Trust ${a.trust}% · Infection ${a.flesh}/10 · Walk ${(spec.walk * s.speed).toFixed(1)} / ${spec.walk} m/s base · Run ${(spec.run * s.speed).toFixed(1)} / ${spec.run} m/s base · Defence ${Math.round(s.defence * 100)}% · Incoming damage ×${(1 / s.defence).toFixed(2)}`;
    this.panel.replaceChildren(title, info);
    const grain = this.inventory.count('grain');
    if (a !== this.animals.companion && a.trust < MAX_TRUST) {
      const hint = document.createElement('p');
      const remaining = Math.ceil((MAX_TRUST - a.trust) / FEED_TRUST);
      hint.textContent = `Feed ${remaining} more grain to befriend this animal. Grain available: ${grain === Infinity ? '∞' : grain}.`;
      this.panel.append(hint);
    }
    const add = (label, action, disabled) => button(this.panel, label, action, disabled);
    add('Feed grain', () => {
      if (this.inventory.remove('grain', 1)) { a.hp = Math.min(s.max, a.hp + 24); a.trust = Math.min(MAX_TRUST, a.trust + FEED_TRUST); a.fed = 3; }
      this.show(a, close, mount);
    }, !grain);
    add('Feed infected flesh', () => {
      if (a.flesh === 9 && !confirm('The tenth feeding will permanently kill this animal. Proceed?')) return;
      if (this.inventory.remove('flesh', 1)) {
        a.flesh++; a.fed = 3;
        if (a.flesh === 10) { this.animals.kill(a); close(); return; }
        a.hp *= stats(a).max / s.max;
      }
      this.show(a, close, mount);
    }, !this.inventory.count('flesh'));
    if (this.animals.companion === a) {
      if (mount) add('Mount', () => mount(a));
      add(a.follow ? 'Stay' : 'Follow', () => { a.follow = !a.follow; this.show(a, close, mount); });
      add('Name companion', () => {
        const name = prompt('Name your companion', a.name)?.trim();
        if (name) a.name = name.slice(0, 28);
        this.show(a, close, mount);
      });
    } else {
      add('Befriend', () => {
        const old = this.animals.companion;
        if (old && !confirm(`Release ${old.name} and befriend ${a.name}?`)) return;
        if (this.animals.befriend(a)) this.show(a, close, mount);
      }, a.trust < MAX_TRUST);
    }
    add('Return', close);
  }
  update() {
    const a = this.animals.companion;
    this.hud.hidden = !a;
    if (!a) return;
    const s = stats(a), status = this.animals.mount === a ? 'Mounted' : a.hp < s.max * 0.3 ? 'Injured' : a.follow ? 'Following' : 'Waiting';
    this.hud.firstElementChild.textContent = `${a.name} · ${status}`;
    this.hud.querySelector('progress').value = a.hp / s.max;
    this.hud.lastElementChild.textContent = `${'■'.repeat(a.flesh)}${'□'.repeat(10 - a.flesh)} · Speed +${Math.round((s.speed - 1) * 100)}% · Defence −${Math.round((1 - s.defence) * 100)}%`;
  }
}
