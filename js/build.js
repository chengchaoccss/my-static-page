// ============ 建造模式：上帝视角编辑器 ============
import * as THREE from 'three';
import { GRID, snap, makeRoom, makeFurniture, roomsOverlap } from './data.js';
import { CATALOG, buildFurniture, furnitureAABB } from './furniture.js';

const FSNAP = 0.25; // 家具吸附步长

export class BuildMode {
  constructor(app) {
    this.app = app;
    this.sm = app.sm;
    this.canvas = app.sm.canvas;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.orbit = { tx: 5, ty: 0, tz: 5, dist: 18, theta: Math.PI / 4, phi: 1.0 };
    this.tool = 'select';
    this.selection = null;      // {kind:'furniture'|'room', id}
    this.drag = null;
    this.ghost = null;          // 家具放置预览
    this.ghostRot = 0;
    this.roomDraft = null;      // 画房间拖拽中
    this.enabled = false;
    this.selHelper = new THREE.Group();
    this.sm.scene.add(this.selHelper);
    this._camAnim = null;
    this.touches = new Map();   // 触屏多指手势
    this._bind();
  }

  get palace() { return this.app.palace; }
  get level() { return this.app.activeLevel; }
  get floor() { return this.palace.floors.find(f => f.level === this.level); }

  enable() {
    this.enabled = true;
    this.fitCamera();
    this.setTool('select');
  }
  disable() {
    this.enabled = false;
    this.clearGhost(); this.roomDraft = null; this.setSelection(null);
  }

  // ---------- 相机 ----------
  fitCamera() {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const f of this.palace.floors) for (const r of f.rooms) {
      minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.w);
      minZ = Math.min(minZ, r.z); maxZ = Math.max(maxZ, r.z + r.d);
    }
    if (minX > maxX) { minX = 0; maxX = 10; minZ = 0; maxZ = 8; }
    this.orbit.tx = (minX + maxX) / 2; this.orbit.tz = (minZ + maxZ) / 2;
    this.orbit.ty = this.sm.floorY(this.level);
    this.orbit.dist = Math.max(maxX - minX, maxZ - minZ, 8) * 1.35;
  }

  updateCamera() {
    const o = this.orbit;
    if (this._camAnim) {
      const a = this._camAnim;
      a.t = Math.min(1, a.t + 0.06);
      const e = 1 - Math.pow(1 - a.t, 3);
      o.tx = a.fx + (a.x - a.fx) * e; o.ty = a.fy + (a.y - a.fy) * e; o.tz = a.fz + (a.z - a.fz) * e;
      o.dist = a.fd + (a.d - a.fd) * e;
      if (a.t >= 1) this._camAnim = null;
    }
    const { tx, ty, tz, dist, theta, phi } = o;
    this.camera.position.set(
      tx + dist * Math.sin(phi) * Math.cos(theta),
      ty + dist * Math.cos(phi),
      tz + dist * Math.sin(phi) * Math.sin(theta),
    );
    this.camera.lookAt(tx, ty, tz);
  }

  flyTo(x, y, z, dist = 8) {
    const o = this.orbit;
    this._camAnim = { t: 0, fx: o.tx, fy: o.ty, fz: o.tz, fd: o.dist, x, y, z, d: dist };
  }

  // ---------- 工具 ----------
  setTool(tool) {
    this.tool = tool;
    this.clearGhost(); this.roomDraft = null;
    if (tool.startsWith('furn:')) {
      const type = tool.slice(5);
      this.ghostRot = 0;
      this.makeGhost(type);
      this.app.setHint(`点击地面放置「${CATALOG[type].name}」 · <kbd>R</kbd> 旋转 · <kbd>Esc</kbd> 取消 · 右键退出`);
    } else if (tool === 'room') {
      this.app.setHint('在地面按住左键拖拽，画出房间轮廓（相邻房间自动开门）');
    } else if (tool === 'delete') {
      this.app.setHint('点击要删除的家具或房间地板');
    } else {
      this.app.setHint('左键选择 · 拖拽移动家具 · 右键旋转视角 · 滚轮缩放 · <kbd>Shift</kbd>+右键平移');
    }
    this.app.onToolChange(tool);
  }

  makeGhost(type) {
    this.clearGhost();
    const fake = { id: 'ghost', type, x: 0, z: 0, rot: this.ghostRot, colorIndex: this.app.lastColorIndex || 0 };
    this.ghost = buildFurniture(fake);
    this.ghost.traverse(o => {
      if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.castShadow = false; }
    });
    this.ghost.position.y = this.sm.floorY(this.level);
    this.ghost.visible = false;
    this.sm.scene.add(this.ghost);
  }
  clearGhost() {
    if (this.ghost) { this.sm.scene.remove(this.ghost); this.ghost = null; }
  }

  // ---------- 选择 ----------
  setSelection(sel) {
    this.selection = sel;
    this.selHelper.clear();
    if (sel && sel.kind === 'furniture') {
      const item = this.palace.furniture.find(f => f.id === sel.id);
      if (item) {
        const bb = furnitureAABB(item, 0.12);
        const def = CATALOG[item.type];
        const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(bb.maxX - bb.minX, def.h + 0.2, bb.maxZ - bb.minZ));
        const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#e8a13c' }));
        line.position.set((bb.minX + bb.maxX) / 2, this.sm.floorY(this.level) + (def.h + 0.2) / 2, (bb.minZ + bb.maxZ) / 2);
        this.selHelper.add(line);
      }
    } else if (sel && sel.kind === 'room') {
      const room = this.floor && this.floor.rooms.find(r => r.id === sel.id);
      if (room) {
        const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(room.w, 0.24, room.d));
        const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#e8a13c' }));
        line.position.set(room.x + room.w / 2, this.sm.floorY(this.level), room.z + room.d / 2);
        this.selHelper.add(line);
      }
    }
    this.app.renderRightPanel();
  }

  refreshSelection() { this.setSelection(this.selection); }

  // ---------- 事件 ----------
  _ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  _bind() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', e => this.enabled && this.onDown(e));
    cv.addEventListener('pointermove', e => this.enabled && this.onMove(e));
    cv.addEventListener('pointerup', e => this.enabled && this.onUp(e));
    cv.addEventListener('wheel', e => {
      if (!this.enabled) return;
      e.preventDefault();
      this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9), 4, 90);
    }, { passive: false });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => this.enabled && this.onKey(e));
  }

  // ---------- 双指手势：平移 / 捏合缩放 / 旋转 ----------
  gestureState() {
    const pts = [...this.touches.values()];
    const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
    return { cx, cy, dist: Math.hypot(dx, dy), ang: Math.atan2(dy, dx) };
  }

  onTouchDown(e) {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      // 进入手势模式：取消进行中的单指操作
      this.drag = null; this.roomDraft = null; this.selHelper.clear();
      if (this.ghost) this.ghost.visible = false;
      this.gesture = this.gestureState();
      return true;
    }
    return false;
  }

  onTouchMove(e) {
    if (!this.touches.has(e.pointerId)) return false;
    this.touches.get(e.pointerId).x = e.clientX;
    this.touches.get(e.pointerId).y = e.clientY;
    if (this.touches.size < 2 || !this.gesture) return this.touches.size >= 2;
    const g = this.gestureState(), prev = this.gesture;
    // 捏合缩放
    if (prev.dist > 10) {
      this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * prev.dist / Math.max(10, g.dist), 4, 90);
    }
    // 双指旋转（拧转）
    let da = g.ang - prev.ang;
    if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
    this.orbit.theta += da;
    // 双指平移
    const s = this.orbit.dist * 0.0016;
    const dx = g.cx - prev.cx, dy = g.cy - prev.cy;
    const cos = Math.cos(this.orbit.theta), sin = Math.sin(this.orbit.theta);
    this.orbit.tx += (dx * sin - dy * cos) * s * -1;
    this.orbit.tz += (-dx * cos - dy * sin) * s * -1;
    this.gesture = g;
    return true;
  }

  onTouchUp(e) {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.gesture = null;
  }

  onDown(e) {
    if (e.pointerType === 'touch' && this.onTouchDown(e)) return;
    const ndc = this._ndc(e);
    if (e.button === 2 || e.button === 1) {
      // 右键/中键：旋转或平移视角；家具放置时右键退出工具
      if (e.button === 2 && this.tool.startsWith('furn:')) { this.setTool('select'); return; }
      this.drag = { kind: e.shiftKey || e.button === 1 ? 'pan' : 'rotate', x: e.clientX, y: e.clientY };
      cvCapture(this.canvas, e);
      return;
    }
    if (e.button !== 0) return;

    if (this.tool === 'room') {
      const p = this.sm.groundPoint(ndc, this.camera, this.level);
      if (p) { this.roomDraft = { x0: snap(p.x), z0: snap(p.z), x1: snap(p.x), z1: snap(p.z) }; cvCapture(this.canvas, e); }
      return;
    }
    if (this.tool.startsWith('furn:')) {
      this.placeFurniture(ndc);
      return;
    }
    if (this.tool === 'delete') {
      const hit = this.sm.pick(ndc, this.camera, { furniture: true, rooms: true, loci: true });
      if (hit) this.deleteByHit(hit);
      return;
    }
    // select 工具
    const hit = this.sm.pick(ndc, this.camera, { loci: true, furniture: true, rooms: true });
    if (hit && hit.kind === 'locus') { this.app.openLocusEditor(hit.id); return; }
    if (hit && hit.kind === 'furniture') {
      const item = this.palace.furniture.find(f => f.id === hit.id);
      const floor = this.palace.floors.find(f => f.id === item.floorId);
      if (floor && floor.level !== this.level) { this.app.setActiveLevel(floor.level); }
      this.setSelection({ kind: 'furniture', id: hit.id });
      const p = this.sm.groundPoint(ndc, this.camera, floor ? floor.level : this.level);
      this.drag = { kind: 'move', id: hit.id, offX: item.x - p.x, offZ: item.z - p.z, moved: false, snapDone: false };
      cvCapture(this.canvas, e);
      return;
    }
    if (hit && hit.kind === 'room') { this.setSelection({ kind: 'room', id: hit.id }); return; }
    this.setSelection(null);
  }

  onMove(e) {
    if (e.pointerType === 'touch' && this.onTouchMove(e)) return;
    const ndc = this._ndc(e);
    if (this.drag) {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (this.drag.kind === 'rotate') {
        this.orbit.theta += dx * 0.008;
        this.orbit.phi = THREE.MathUtils.clamp(this.orbit.phi + dy * 0.006, 0.15, 1.45);
        this.drag.x = e.clientX; this.drag.y = e.clientY;
        return;
      }
      if (this.drag.kind === 'pan') {
        const s = this.orbit.dist * 0.0016;
        const cos = Math.cos(this.orbit.theta), sin = Math.sin(this.orbit.theta);
        this.orbit.tx += (-dx * -sin + dy * cos) * s * -1;
        this.orbit.tz += (dx * cos + dy * sin) * s;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
        return;
      }
      if (this.drag.kind === 'move') {
        const item = this.palace.furniture.find(f => f.id === this.drag.id);
        if (!item) { this.drag = null; return; }
        if (!this.drag.moved) { this.app.snapshot(); this.drag.moved = true; }
        const floor = this.palace.floors.find(f => f.id === item.floorId);
        const p = this.sm.groundPoint(ndc, this.camera, floor ? floor.level : this.level);
        if (p) {
          item.x = Math.round((p.x + this.drag.offX) / FSNAP) * FSNAP;
          item.z = Math.round((p.z + this.drag.offZ) / FSNAP) * FSNAP;
          this.sm.updateFurnitureTransform(item);
          this.refreshSelection();
        }
        return;
      }
    }
    if (this.roomDraft) {
      const p = this.sm.groundPoint(ndc, this.camera, this.level);
      if (p) { this.roomDraft.x1 = snap(p.x); this.roomDraft.z1 = snap(p.z); }
      this.drawRoomDraft();
      return;
    }
    if (this.ghost) {
      const p = this.sm.groundPoint(ndc, this.camera, this.level);
      if (p) {
        this.ghost.visible = true;
        this.ghost.position.x = Math.round(p.x / FSNAP) * FSNAP;
        this.ghost.position.z = Math.round(p.z / FSNAP) * FSNAP;
        this.ghost.rotation.y = this.ghostRot;
      }
    }
  }

  onUp(e) {
    if (e.pointerType === 'touch') this.onTouchUp(e);
    if (this.drag) {
      if (this.drag.kind === 'move' && this.drag.moved) this.app.commitTransform();
      this.drag = null;
      return;
    }
    if (this.roomDraft) {
      this.commitRoomDraft();
      return;
    }
  }

  onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Escape') { this.setTool('select'); return; }
    if ((e.key === 'r' || e.key === 'R')) {
      if (this.ghost) { this.ghostRot += Math.PI / 4; this.ghost.rotation.y = this.ghostRot; }
      else if (this.selection && this.selection.kind === 'furniture') this.app.rotateSelected(Math.PI / 4);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selection) { this.deleteByHit(this.selection); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.app.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); this.app.redo(); return; }
  }

  // ---------- 房间绘制 ----------
  drawRoomDraft() {
    this.selHelper.clear();
    if (!this.roomDraft) return;
    const { x0, z0, x1, z1 } = this.roomDraft;
    const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
    if (w < 0.01 || d < 0.01) return;
    const ok = w >= 1.5 && d >= 1.5 && !this.draftOverlaps();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.1, d),
      new THREE.MeshBasicMaterial({ color: ok ? '#6f8f7c' : '#c0654f', transparent: true, opacity: 0.4 }),
    );
    mesh.position.set(Math.min(x0, x1) + w / 2, this.sm.floorY(this.level) + 0.06, Math.min(z0, z1) + d / 2);
    this.selHelper.add(mesh);
    this.app.setHint(`房间尺寸 ${w.toFixed(1)} × ${d.toFixed(1)} 米${ok ? '' : w < 1.5 || d < 1.5 ? '（太小，至少 1.5×1.5）' : '（与已有房间重叠）'}`);
  }

  draftOverlaps() {
    const { x0, z0, x1, z1 } = this.roomDraft;
    const rect = { x: Math.min(x0, x1), z: Math.min(z0, z1), w: Math.abs(x1 - x0), d: Math.abs(z1 - z0) };
    return this.floor.rooms.some(r => roomsOverlap(rect, r));
  }

  commitRoomDraft() {
    const { x0, z0, x1, z1 } = this.roomDraft;
    const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
    const ok = w >= 1.5 && d >= 1.5 && !this.draftOverlaps();
    this.roomDraft = null;
    this.selHelper.clear();
    if (!ok) {
      if (w > 0.3 || d > 0.3) this.app.toast(w < 1.5 || d < 1.5 ? '房间太小了，至少 1.5 × 1.5 米' : '不能与已有房间重叠', 'warn');
      this.setTool('room');
      return;
    }
    this.app.snapshot();
    const room = makeRoom(Math.min(x0, x1), Math.min(z0, z1), w, d);
    room.name = `房间 ${this.floor.rooms.length + 1}`;
    this.floor.rooms.push(room);
    this.app.commitStructure();
    this.app.toast(`已创建「${room.name}」，相邻房间会自动开门 ✓`);
    this.setSelection({ kind: 'room', id: room.id });
    this.setTool('room');
  }

  // ---------- 家具放置 / 删除 ----------
  placeFurniture(ndc) {
    const type = this.tool.slice(5);
    const p = this.sm.groundPoint(ndc, this.camera, this.level);
    if (!p) return;
    this.app.snapshot();
    const item = makeFurniture(this.floor.id, type, Math.round(p.x / FSNAP) * FSNAP, Math.round(p.z / FSNAP) * FSNAP);
    item.rot = this.ghostRot;
    item.colorIndex = this.app.lastColorIndex || 0;
    this.palace.furniture.push(item);
    this.sm.addFurnitureMesh(item);
    this.sm.setViewMode('build', this.level);
    this.app.save();
    this.app.toast(`已放置「${CATALOG[type].name}」`);
  }

  deleteByHit(hit) {
    if (hit.kind === 'furniture') {
      const item = this.palace.furniture.find(f => f.id === hit.id);
      const lociOn = this.palace.loci.filter(l => l.furnitureId === hit.id);
      if (lociOn.length && !confirm(`该家具上有 ${lociOn.length} 个记忆点，删除后记忆点也会移除。确定删除？`)) return;
      this.app.snapshot();
      this.palace.furniture = this.palace.furniture.filter(f => f.id !== hit.id);
      this.palace.loci = this.palace.loci.filter(l => l.furnitureId !== hit.id);
      this.palace.path = this.palace.path.filter(id => this.palace.loci.some(l => l.id === id));
      this.sm.removeFurnitureMesh(hit.id);
      this.sm.rebuildMarkers();
      if (this.selection && this.selection.id === hit.id) this.setSelection(null);
      this.app.save(); this.app.renderPathPanel();
    } else if (hit.kind === 'room') {
      const room = this.floor.rooms.find(r => r.id === hit.id);
      if (!room) return;
      if (!confirm(`删除「${room.name}」？（房间内家具会保留）`)) return;
      this.app.snapshot();
      this.floor.rooms = this.floor.rooms.filter(r => r.id !== hit.id);
      if (this.selection && this.selection.id === hit.id) this.setSelection(null);
      this.app.commitStructure();
    } else if (hit.kind === 'locus') {
      this.app.deleteLocus(hit.id, true);
    }
  }
}

function cvCapture(cv, e) { try { cv.setPointerCapture(e.pointerId); } catch { /* noop */ } }
