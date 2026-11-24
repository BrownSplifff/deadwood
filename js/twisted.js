import { clamp } from './util.js';

export const TWISTED = {
  hp: 160, speed: 2.5, chase: 8, dmg: 18, detect: 35, range: 4,
  atkDur: 1.15, turn: 9, pitch: 1.8, crawl: 1.5,
};

export function poseTwisted(e, dt) {
  const p = e.parts;
  e.phase += dt * (2 + e.curSpeed * 2.1);
  const gait = clamp(e.curSpeed / 4, 0, 1);
  const strike = e.state === 'attack' ? Math.sin(Math.PI * clamp(e.attackT / e.cfg.atkDur, 0, 1)) : 0;
  const fall = clamp(e.deadT * 2, 0, 1);
  const stalk = e.state === 'stalk' ? 0.16 : 0;
  p.model.position.set(0, 0.87 - stalk - 0.61 * fall + strike * 0.22 + Math.sin(e.phase) * 0.045, -0.36);
  p.model.rotation.set(1.28 - strike * 0.32 + e.hurtT * 0.6, 0, Math.sin(e.phase * 0.5) * 0.08 + fall);
  p.torso.rotation.x = -0.19;
  p.headP.rotation.set(-0.87, Math.sin(e.phase * 0.3) * 0.23, e.headTilt);
  for (const [side, arm, leg] of [[1, p.armL, p.legR], [-1, p.armR, p.legL]]) {
    const swing = Math.sin(e.phase + (side > 0 ? 0 : Math.PI)) * gait;
    arm.sh.rotation.set(-1.35 + swing * 0.55 - strike * 0.9, 0, side * 0.16);
    arm.el.rotation.x = -0.24 - Math.max(0, swing) * 0.55;
    leg.hp.rotation.set(-1.18 + swing * 0.62, 0, -side * 0.22);
    leg.kn.rotation.x = 0.61 + Math.max(0, -swing) * 0.5;
  }
}
