// ============ 巡游模式：第一人称 / 自动导览 / 自测 ============
import * as THREE from 'three';
import { FLOOR_GAP, locusStatus } from './data.js';
import { furnitureAABB, slotWorldPos } from './furniture.js';

const EYE = 1.58;
const RADIUS = 0.28;
const SPEED = 3.4;

export class TourMode {
  constructor(app) {
    this.app = app;
    this.sm = app.sm;
    this.canvas = app.sm.canvas;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 300);
    this.enabled = false;
    this.sub = 'walk';           // walk | auto | quiz
    this.pos = new THREE.Vector3(2, 0, 2);
    this.level = 0;
    this.yaw = 0; this.pitch = 0;
    this.keys = {};
    this.locked = false;
    this.nearLocus = null;
    this.seq = []; this.seqIndex = -1;
    this.phase = 'idle';         // idle | fly | dwell
    this.flyT = 0; this.flyFrom = null; this.flyTo = null; this.lookFrom = null; this.lookTo = null;
    this.dwellLeft = 0;
    this.dwellSec = 4;
    this.playing = false;
    this.quizStats = null;
    this.touchMode = matchMedia('(pointer: coarse)').matches;
    this.touchWalking = false;
    this.joy = { x: 0, y: 0 };
    this._look = null;
    this._stair = null;
    this._bind();
    if (this.touchMode) this._bindTouch();
  }

  get palace() { return this.app.palace; }

  // ---------- 启停 ----------
  enable(sub) {
    this.enabled = true;
    this.sub = sub;
    this.spawn();
    this.applyWalkCamera();
    if (sub === 'walk') {
      this.phase = 'idle';
      this.app.showTourOverlay(true);
    } else {
      this.startSequence(sub === 'quiz');
    }
  }

  disable() {
    this.enabled = false;
    this.playing = false;
    this.touchWalking = false;
    this.phase = 'idle';
    this.app.hideCard();
    this.app.setTourPrompt(null);
    this.app.setTouchHud(false);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  spawn() {
    // 出生点：路径第一个桩点附近，否则第一个房间中心
    const firstLocus = this.palace.path.length ? this.palace.loci.find(l => l.id === this.palace.path[0]) : null;
    if (firstLocus) {
      const item = this.palace.furniture.find(f => f.id === firstLocus.furnitureId);
      if (item) {
        const floor = this.palace.floors.find(f => f.id === item.floorId);
        this.level = floor ? floor.level : 0;
        this.pos.set(item.x + 1.6, 0, item.z + 1.6);
        this.yaw = Math.atan2(this.pos.x - item.x, this.pos.z - item.z);
        this.pitch = 0;
        return;
      }
    }
    const f0 = this.palace.floors.find(f => f.level === 0) || this.palace.floors[0];
    const room = f0 && f0.rooms[0];
    this.level = f0 ? f0.level : 0;
    if (room) this.pos.set(room.x + room.w / 2, 0, room.z + room.d / 2);
    else this.pos.set(2, 0, 2);
    this.yaw = Math.PI * 0.75; this.pitch = 0;
  }

  // ---------- 输入 ----------
  _bind() {
    window.addEventListener('keydown', e => {
      if (!this.enabled) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyE') this.interact();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.enabled && this.sub === 'walk' && !this.locked && !this.app.cardOpen) {
        this.app.showTourOverlay(true);
      }
    });
    document.addEventListener('mousemove', e => {
      if (!this.enabled || !this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.35, 1.35);
    });
    this.canvas.addEventListener('click', () => {
      if (this.enabled && this.sub === 'walk' && this.locked && this.nearLocus) this.interact();
    });
  }

  beginWalk() {
    this.app.showTourOverlay(false);
    if (this.touchMode) {
      this.touchWalking = true;
      this.app.setTouchHud(true);
    } else {
      this.canvas.requestPointerLock();
    }
  }

  interact() {
    if (this.sub !== 'walk' || !this.nearLocus) return;
    const locus = this.palace.loci.find(l => l.id === this.nearLocus);
    if (!locus) return;
    if (document.pointerLockElement) document.exitPointerLock();
    this.app.showCard(locus, { mode: 'view' });
  }

  useStair() {
    if (!this._stair) return;
    this.level += this._stair.dir;
    this.app.toast(`已到 ${this.level + 1}F`);
  }

  // ---------- 触屏：虚拟摇杆 + 拖动视角 ----------
  _bindTouch() {
    const base = document.getElementById('joy-base');
    const knob = document.getElementById('joy-knob');
    if (base && knob) {
      let joyId = null;
      const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
      const onJoy = e => {
        const r = base.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2 - 14, len = Math.hypot(dx, dy);
        if (len > max) { dx *= max / len; dy *= max / len; }
        setKnob(dx, dy);
        this.joy.x = dx / max; this.joy.y = -dy / max;
      };
      base.addEventListener('pointerdown', e => {
        joyId = e.pointerId; base.setPointerCapture(e.pointerId); onJoy(e); e.preventDefault();
      });
      base.addEventListener('pointermove', e => { if (e.pointerId === joyId) onJoy(e); });
      const end = e => {
        if (e.pointerId !== joyId) return;
        joyId = null; this.joy.x = 0; this.joy.y = 0; setKnob(0, 0);
      };
      base.addEventListener('pointerup', end);
      base.addEventListener('pointercancel', end);
    }
    // 画布拖动 = 转视角
    this.canvas.addEventListener('pointerdown', e => {
      if (!this.enabled || this.sub !== 'walk' || !this.touchWalking || e.pointerType !== 'touch') return;
      this._look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointermove', e => {
      if (!this._look || e.pointerId !== this._look.id) return;
      this.yaw -= (e.clientX - this._look.x) * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - this._look.y) * 0.005, -1.35, 1.35);
      this._look.x = e.clientX; this._look.y = e.clientY;
    });
    const lookEnd = e => { if (this._look && e.pointerId === this._look.id) this._look = null; };
    this.canvas.addEventListener('pointerup', lookEnd);
    this.canvas.addEventListener('pointercancel', lookEnd);
    const act = document.getElementById('touch-action');
    if (act) act.addEventListener('click', () => {
      if (this._stair) this.useStair();
      else if (this.nearLocus) this.interact();
    });
  }

  // ---------- 步行更新 ----------
  walkUpdate(dt) {
    let fx = this.joy.x, fz = this.joy.y;
    if (this.keys.KeyW || this.keys.ArrowUp) fz += 1;
    if (this.keys.KeyS || this.keys.ArrowDown) fz -= 1;
    if (this.keys.KeyA || this.keys.ArrowLeft) fx -= 1;
    if (this.keys.KeyD || this.keys.ArrowRight) fx += 1;
    if (fx || fz) {
      const len = Math.max(1, Math.hypot(fx, fz)); fx /= len; fz /= len;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const dx = (fz * -sin + fx * cos) * SPEED * dt;
      const dz = (fz * -cos + fx * -sin) * SPEED * dt;
      this.tryMove(dx, dz);
    }
    // 楼梯与桩点感知
    const stair = this.stairAt();
    this._stair = stair;
    let prompt = null;
    this.nearLocus = this.findNearLocus();
    const touch = this.touchMode;
    if (this.nearLocus) {
      const locus = this.palace.loci.find(l => l.id === this.nearLocus);
      const order = this.palace.path.indexOf(this.nearLocus);
      prompt = `桩点 ${order >= 0 ? order + 1 : ''} · ${locus.title || '（空）'}${touch ? '' : ' — 按 <b>E</b> 查看'}`;
      this.highlight(this.nearLocus);
    } else this.highlight(null);
    if (stair) {
      prompt = touch ? null : (stair.dir > 0 ? '按 <b>E</b> 上楼' : '按 <b>E</b> 下楼');
      if (this.keys.KeyE) { this.keys.KeyE = false; this.useStair(); }
    }
    this.app.setTourPrompt(prompt);
    if (touch) this.app.setTouchAction(stair ? (stair.dir > 0 ? '⬆️' : '⬇️') : this.nearLocus ? '👁️' : null);
    this.applyWalkCamera();
  }

  applyWalkCamera() {
    const y = this.level * FLOOR_GAP + EYE;
    this.camera.position.set(this.pos.x, y, this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }

  tryMove(dx, dz) {
    const cols = this.sm.colliders(this.level);
    const collide = (x, z) => cols.some(b =>
      x + RADIUS > b.minX && x - RADIUS < b.maxX && z + RADIUS > b.minZ && z - RADIUS < b.maxZ);
    const onFloor = (x, z) => {
      if (this.level === 0) return true;
      const floor = this.palace.floors.find(f => f.level === this.level);
      if (floor && floor.rooms.some(r => x > r.x - 0.2 && x < r.x + r.w + 0.2 && z > r.z - 0.2 && z < r.z + r.d + 0.2)) return true;
      return !!this.stairAt(x, z);
    };
    let nx = this.pos.x + dx, nz = this.pos.z;
    if (!collide(nx, nz) && onFloor(nx, nz)) this.pos.x = nx;
    nz = this.pos.z + dz;
    if (!collide(this.pos.x, nz) && onFloor(this.pos.x, nz)) this.pos.z = nz;
  }

  stairAt(x = this.pos.x, z = this.pos.z) {
    for (const item of this.palace.furniture) {
      const floor = this.palace.floors.find(f => f.id === item.floorId);
      if (!floor) continue;
      const bb = furnitureAABB(item, 0.35);
      if (!bb.isStairs) continue;
      const inside = x > bb.minX && x < bb.maxX && z > bb.minZ && z < bb.maxZ;
      if (!inside) continue;
      if (floor.level === this.level && this.palace.floors.some(f => f.level === this.level + 1)) return { dir: 1 };
      if (floor.level === this.level - 1) return { dir: -1 };
    }
    return null;
  }

  findNearLocus() {
    let best = null, bestD = 2.4;
    for (const locus of this.palace.loci) {
      const g = this.sm.markerGroups.get(locus.id);
      if (!g || g.userData.level !== this.level) continue;
      const d = Math.hypot(g.position.x - this.pos.x, g.position.z - this.pos.z);
      if (d < bestD) { bestD = d; best = locus.id; }
    }
    return best;
  }

  highlight(locusId) {
    for (const [id, g] of this.sm.markerGroups) {
      const s = id === locusId ? 1.5 : 1;
      g.scale.set(s, s, s);
    }
  }

  // ---------- 自动导览 / 自测 ----------
  startSequence(quiz) {
    const ids = this.palace.path.filter(id => {
      const l = this.palace.loci.find(x => x.id === id);
      return l && (!quiz || locusStatus(l) !== 'empty');
    });
    if (!ids.length) {
      this.app.toast(quiz ? '还没有已挂载内容的桩点，先去建造模式添加吧' : '还没有记忆路径，先去建造模式添加记忆点', 'warn');
      this.app.exitToBuild();
      return;
    }
    this.seq = ids;
    this.seqIndex = -1;
    this.playing = true;
    this.quizStats = quiz ? { total: ids.length, done: 0, known: 0, fuzzy: 0, forgot: 0 } : null;
    // 相机初始：从出生点起飞
    const y = this.level * FLOOR_GAP + EYE;
    this.camera.position.set(this.pos.x, y, this.pos.z);
    this.next();
  }

  viewpointFor(locusId) {
    const locus = this.palace.loci.find(l => l.id === locusId);
    const item = this.palace.furniture.find(f => f.id === locus.furnitureId);
    const floor = this.palace.floors.find(f => f.id === item.floorId);
    const level = floor ? floor.level : 0;
    const m = slotWorldPos(item, locus.slot);
    m.y += level * FLOOR_GAP;
    // 站位：从家具中心向外退 2 米
    const away = new THREE.Vector3(this.camera.position.x - item.x, 0, this.camera.position.z - item.z);
    if (away.lengthSq() < 0.01) away.set(1, 0, 1);
    away.normalize().multiplyScalar(2.0);
    const eye = new THREE.Vector3(item.x + away.x, level * FLOOR_GAP + EYE, item.z + away.z);
    return { eye, look: m, level };
  }

  next() {
    this.app.hideCard();
    if (this.seqIndex + 1 >= this.seq.length) {
      if (this.quizStats) { this.finishQuiz(); return; }
      if (this.app.tourLoop) this.seqIndex = -1;
      else {
        this.playing = false; this.phase = 'idle';
        this.app.setTourPrompt('导览结束 ✓ 可点击「重新播放」或返回');
        this.app.onSeqEnd();
        return;
      }
    }
    this.seqIndex++;
    this.flyToLocus(this.seq[this.seqIndex]);
    this.app.updateSeqUI();
  }

  prev() {
    if (this.seqIndex <= 0) return;
    this.app.hideCard();
    this.seqIndex -= 2;
    this.next();
  }

  flyToLocus(locusId) {
    const vp = this.viewpointFor(locusId);
    this.phase = 'fly';
    this.flyT = 0;
    this.flyFrom = this.camera.position.clone();
    this.flyTo = vp.eye;
    const cur = new THREE.Vector3();
    this.camera.getWorldDirection(cur);
    this.lookFrom = this.camera.position.clone().add(cur.multiplyScalar(4));
    this.lookTo = vp.look;
    this.level = vp.level;
    this.flyDur = Math.max(0.9, Math.min(3.2, this.flyFrom.distanceTo(this.flyTo) * 0.18));
  }

  seqUpdate(dt) {
    if (this.phase === 'fly') {
      this.flyT += dt / this.flyDur;
      const t = Math.min(1, this.flyT);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const p = this.flyFrom.clone().lerp(this.flyTo, e);
      const lk = this.lookFrom.clone().lerp(this.lookTo, e);
      this.camera.position.copy(p);
      this.camera.lookAt(lk);
      if (t >= 1) {
        this.phase = 'dwell';
        this.dwellLeft = this.dwellSec;
        const locus = this.palace.loci.find(l => l.id === this.seq[this.seqIndex]);
        this.highlight(locus.id);
        this.app.showCard(locus, { mode: this.quizStats ? 'quiz' : 'view', seq: true });
      }
      return;
    }
    if (this.phase === 'dwell' && !this.quizStats && this.playing) {
      this.dwellLeft -= dt;
      if (this.dwellLeft <= 0) this.next();
    }
  }

  grade(result) {
    // result: known | fuzzy | forgot
    const locus = this.palace.loci.find(l => l.id === this.seq[this.seqIndex]);
    if (locus) {
      locus.status = result === 'known' ? 'known' : result === 'fuzzy' ? 'fuzzy' : 'filled';
      locus.reviews = (locus.reviews || 0) + 1;
      locus.lastReview = Date.now();
      this.quizStats.done++;
      this.quizStats[result === 'known' ? 'known' : result === 'fuzzy' ? 'fuzzy' : 'forgot']++;
      this.app.save();
      this.sm.rebuildMarkers();
      this.sm.setViewMode('tour');
    }
    this.next();
  }

  finishQuiz() {
    this.playing = false; this.phase = 'idle';
    this.app.showQuizSummary(this.quizStats);
  }

  update(dt) {
    if (!this.enabled) return;
    if (this.sub === 'walk') { if (this.locked || this.touchWalking) this.walkUpdate(dt); }
    else this.seqUpdate(dt);
  }
}
