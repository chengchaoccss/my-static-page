// ============ 3D 场景管理：楼层 / 墙体生成 / 桩点标记 / 路径 ============
import * as THREE from 'three';
import {
  GRID, WALL_H, WALL_T, FLOOR_GAP, DOOR_W_CELLS, DOOR_H,
  FLOOR_PALETTE, locusStatus,
} from './data.js';
import { buildFurniture, slotWorldPos, furnitureAABB, CATALOG, toonGrad } from './furniture.js';

const WALL_COLOR = '#fff2d9';
const SLAB_EDGE = '#e8b483';
export const STATUS_COLORS = { empty: '#b8bcc8', filled: '#ffa22e', fuzzy: '#ffd23e', known: '#57cc8a' };
const PATH_COLOR = '#ff9a2e';

const wallMat = new THREE.MeshToonMaterial({ color: WALL_COLOR, gradientMap: toonGrad });
const wallGhostMat = new THREE.MeshToonMaterial({ color: WALL_COLOR, gradientMap: toonGrad, transparent: true, opacity: 0.18, depthWrite: false });
const wallEdgeMat = new THREE.LineBasicMaterial({ color: '#8a7ba6', transparent: true, opacity: 0.45 });

// ---------- 墙体计算（网格去重 + 自动门洞） ----------
// 返回 { solids: [{x0,x1,z0,z1,y0,y1}], doors: [...同构], boxes2d: 碰撞 AABB }
export function computeWalls(floor) {
  const cells = new Map(); // key -> { rooms:Set, ori, line, idx }
  const mark = (ori, line, idx, roomId) => {
    const key = `${ori}|${line}|${idx}`;
    let c = cells.get(key);
    if (!c) { c = { rooms: new Set(), ori, line, idx }; cells.set(key, c); }
    c.rooms.add(roomId);
  };
  for (const r of floor.rooms) {
    const x0 = Math.round(r.x / GRID), x1 = Math.round((r.x + r.w) / GRID);
    const z0 = Math.round(r.z / GRID), z1 = Math.round((r.z + r.d) / GRID);
    for (let i = x0; i < x1; i++) { mark('H', z0, i, r.id); mark('H', z1, i, r.id); }
    for (let i = z0; i < z1; i++) { mark('V', x0, i, r.id); mark('V', x1, i, r.id); }
  }
  // 按 (ori, line) 分组找连续段
  const lines = new Map();
  for (const c of cells.values()) {
    const k = `${c.ori}|${c.line}`;
    if (!lines.has(k)) lines.set(k, []);
    lines.get(k).push(c);
  }
  const doorCells = new Set();
  for (const arr of lines.values()) {
    arr.sort((a, b) => a.idx - b.idx);
    // 找相同"房间对"（恰好 2 间共享）的连续段并开门
    let run = [];
    const flush = () => {
      if (run.length >= DOOR_W_CELLS + 1) {
        const start = Math.floor((run.length - DOOR_W_CELLS) / 2);
        for (let j = 0; j < DOOR_W_CELLS; j++) {
          const c = run[start + j];
          doorCells.add(`${c.ori}|${c.line}|${c.idx}`);
        }
      }
      run = [];
    };
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      const pairKey = c.rooms.size === 2 ? [...c.rooms].sort().join('+') : null;
      const prev = run[run.length - 1];
      const prevKey = prev && prev.rooms.size === 2 ? [...prev.rooms].sort().join('+') : null;
      if (pairKey && prev && prevKey === pairKey && prev.idx === c.idx - 1) run.push(c);
      else { flush(); if (pairKey) run = [c]; }
    }
    flush();
  }
  // 合并连续单元 → 实体墙 / 门楣
  const solids = [], doors = [];
  for (const arr of lines.values()) {
    arr.sort((a, b) => a.idx - b.idx);
    let i = 0;
    while (i < arr.length) {
      const isDoor = doorCells.has(`${arr[i].ori}|${arr[i].line}|${arr[i].idx}`);
      let j = i;
      while (
        j + 1 < arr.length && arr[j + 1].idx === arr[j].idx + 1 &&
        doorCells.has(`${arr[j + 1].ori}|${arr[j + 1].line}|${arr[j + 1].idx}`) === isDoor
      ) j++;
      const a = arr[i].idx * GRID, b = (arr[j].idx + 1) * GRID;
      const line = arr[i].line * GRID;
      const seg = arr[i].ori === 'H'
        ? { x0: a - WALL_T / 2, x1: b + WALL_T / 2, z0: line - WALL_T / 2, z1: line + WALL_T / 2 }
        : { x0: line - WALL_T / 2, x1: line + WALL_T / 2, z0: a - WALL_T / 2, z1: b + WALL_T / 2 };
      if (isDoor) doors.push({ ...seg, y0: DOOR_H, y1: WALL_H });
      else solids.push({ ...seg, y0: 0, y1: WALL_H });
      i = j + 1;
    }
  }
  return { solids, doors };
}

// ---------- 文本贴片 ----------
export function makeTextSprite(text, { fontSize = 42, color = '#3b3e36', bg = null, pad = 18 } = {}) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = `600 ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.width = w; cv.height = fontSize + pad * 2;
  const c2 = cv.getContext('2d');
  if (bg) {
    c2.fillStyle = bg;
    c2.beginPath();
    c2.roundRect(0, 0, cv.width, cv.height, cv.height / 2);
    c2.fill();
  }
  c2.font = `600 ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  c2.fillStyle = color;
  c2.textAlign = 'center'; c2.textBaseline = 'middle';
  c2.fillText(text, cv.width / 2, cv.height / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const s = 0.006;
  sp.scale.set(cv.width * s, cv.height * s, 1);
  return sp;
}

function makeNumBadge(num, colorHex) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const c = cv.getContext('2d');
  c.beginPath(); c.arc(48, 48, 44, 0, Math.PI * 2);
  c.fillStyle = colorHex; c.fill();
  c.lineWidth = 5; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke();
  c.fillStyle = '#fff';
  c.font = `700 ${String(num).length > 2 ? 34 : 44}px -apple-system, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(num), 48, 50);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(0.34, 0.34, 1);
  return sp;
}

// ---------- 场景管理器 ----------
export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#aee0ff');
    this.scene.fog = new THREE.Fog('#aee0ff', 60, 140);

    const hemi = new THREE.HemisphereLight('#ffffff', '#e8e0d0', 1.05);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff2d6', 1.9);
    sun.position.set(14, 24, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 70 });
    sun.shadow.bias = -0.0004;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    // 动漫草地
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(80, 48),
      new THREE.MeshToonMaterial({ color: '#93d47f', gradientMap: toonGrad }),
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.09;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.grid = new THREE.GridHelper(60, 120, '#6fae62', '#82c273');
    this.grid.material.transparent = true; this.grid.material.opacity = 0.45;
    this.scene.add(this.grid);

    // 飘浮的卡通云朵
    this.clouds = new THREE.Group();
    const cloudMat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonGrad });
    const seeds = [[-24, 15, -20, 1.4], [18, 18, -26, 1.9], [30, 13, 10, 1.2], [-14, 20, 24, 1.6], [4, 16, -38, 1.3]];
    for (const [x, y, z, s] of seeds) {
      const c = new THREE.Group();
      [[0, 0, 0, 1.6], [1.5, 0.25, 0.2, 1.1], [-1.4, 0.15, -0.1, 1.0], [0.4, 0.7, -0.3, 0.9]].forEach(([px, py, pz, r]) => {
        const b = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), cloudMat);
        b.position.set(px, py, pz);
        c.add(b);
      });
      c.position.set(x, y, z); c.scale.setScalar(s);
      c.userData.speed = 0.25 + s * 0.15;
      this.clouds.add(c);
    }
    this.scene.add(this.clouds);

    this.floorGroups = new Map();   // level -> Group
    this.furnGroups = new Map();    // furnId -> Group
    this.markerGroups = new Map();  // locusId -> Group
    this.pathGroup = new THREE.Group();
    this.scene.add(this.pathGroup);
    this.wallCache = new Map();     // level -> {solids, doors}
    this.roomLabels = [];
    this.palace = null;
    this.raycaster = new THREE.Raycaster();
    this._clock = new THREE.Clock();
  }

  setPalace(palace) { this.palace = palace; this.rebuildAll(); }

  floorY(level) { return level * FLOOR_GAP; }

  rebuildAll() {
    for (const g of this.floorGroups.values()) { this.scene.remove(g); disposeDeep(g); }
    this.floorGroups.clear(); this.wallCache.clear(); this.roomLabels = [];
    for (const g of this.furnGroups.values()) { this.scene.remove(g); disposeDeep(g); }
    this.furnGroups.clear();
    if (!this.palace) return;

    for (const floor of this.palace.floors) {
      const fg = new THREE.Group();
      fg.position.y = this.floorY(floor.level);
      fg.userData.level = floor.level;
      // 地板
      for (const room of floor.rooms) {
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(room.w, 0.16, room.d),
          new THREE.MeshToonMaterial({ color: FLOOR_PALETTE[room.floorColor % FLOOR_PALETTE.length], gradientMap: toonGrad }),
        );
        slab.position.set(room.x + room.w / 2, -0.08, room.z + room.d / 2);
        slab.receiveShadow = true; slab.castShadow = true;
        slab.userData = { kind: 'room', id: room.id, level: floor.level };
        fg.add(slab);
        const edge = new THREE.Mesh(
          new THREE.BoxGeometry(room.w + 0.08, 0.05, room.d + 0.08),
          new THREE.MeshToonMaterial({ color: SLAB_EDGE, gradientMap: toonGrad }),
        );
        edge.position.set(room.x + room.w / 2, -0.14, room.z + room.d / 2);
        fg.add(edge);
        // 房间名标签（建造模式显示）
        const label = makeTextSprite(room.name, { color: '#6a5f85', bg: 'rgba(255,255,255,.92)' });
        label.position.set(room.x + room.w / 2, 0.35, room.z + room.d / 2);
        label.userData.isRoomLabel = true;
        fg.add(label);
        this.roomLabels.push(label);
      }
      // 墙体
      const walls = computeWalls(floor);
      this.wallCache.set(floor.level, walls);
      const addWall = (seg) => {
        const w = seg.x1 - seg.x0, d = seg.z1 - seg.z0, h = seg.y1 - seg.y0;
        const geo = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.position.set((seg.x0 + seg.x1) / 2, seg.y0 + h / 2, (seg.z0 + seg.z1) / 2);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.isWall = true;
        // 漫画描线
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), wallEdgeMat);
        edges.position.copy(mesh.position);
        edges.userData.isWallEdge = true;
        fg.add(mesh, edges);
      };
      walls.solids.forEach(s => addWall(s));
      walls.doors.forEach(s => addWall(s));
      this.scene.add(fg);
      this.floorGroups.set(floor.level, fg);
    }
    this.rebuildFurnitureAll();
  }

  rebuildFurnitureAll() {
    for (const g of this.furnGroups.values()) { this.scene.remove(g); disposeDeep(g); }
    this.furnGroups.clear();
    if (!this.palace) return;
    for (const item of this.palace.furniture) {
      this.addFurnitureMesh(item);
    }
    this.rebuildMarkers();
  }

  addFurnitureMesh(item) {
    const floor = this.palace.floors.find(f => f.id === item.floorId);
    const g = buildFurniture(item);
    g.position.y = this.floorY(floor ? floor.level : 0);
    g.userData.level = floor ? floor.level : 0;
    this.scene.add(g);
    this.furnGroups.set(item.id, g);
    return g;
  }

  removeFurnitureMesh(id) {
    const g = this.furnGroups.get(id);
    if (g) { this.scene.remove(g); disposeDeep(g); this.furnGroups.delete(id); }
  }

  updateFurnitureTransform(item) {
    const g = this.furnGroups.get(item.id);
    if (!g) return;
    g.position.x = item.x; g.position.z = item.z; g.rotation.y = item.rot;
    this.updateMarkersFor(item);
  }

  // ---------- 桩点标记 ----------
  rebuildMarkers() {
    for (const g of this.markerGroups.values()) { this.scene.remove(g); disposeDeep(g); }
    this.markerGroups.clear();
    if (!this.palace) return;
    for (const locus of this.palace.loci) this.addMarkerMesh(locus);
    this.rebuildPath();
  }

  addMarkerMesh(locus) {
    const item = this.palace.furniture.find(f => f.id === locus.furnitureId);
    if (!item) return;
    const floor = this.palace.floors.find(f => f.id === item.floorId);
    const status = locusStatus(locus);
    const color = STATUS_COLORS[status];
    const order = this.palace.path.indexOf(locus.id);

    const g = new THREE.Group();
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.13),
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45 }),
    );
    gem.userData = { kind: 'locus', id: locus.id };
    g.add(gem);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.012, 8, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65 }),
    );
    halo.rotation.x = Math.PI / 2;
    g.add(halo);
    const badge = makeNumBadge(order >= 0 ? order + 1 : '·', color);
    badge.position.y = 0.42;
    badge.userData = { kind: 'locus', id: locus.id };
    g.add(badge);

    const pos = slotWorldPos(item, locus.slot);
    g.position.set(pos.x, pos.y + this.floorY(floor ? floor.level : 0), pos.z);
    g.userData = { kind: 'locus', id: locus.id, baseY: g.position.y, phase: Math.random() * 6.28, level: floor ? floor.level : 0 };
    this.scene.add(g);
    this.markerGroups.set(locus.id, g);
  }

  updateMarkersFor(item) {
    for (const locus of this.palace.loci) {
      if (locus.furnitureId !== item.id) continue;
      const g = this.markerGroups.get(locus.id);
      if (!g) continue;
      const floor = this.palace.floors.find(f => f.id === item.floorId);
      const pos = slotWorldPos(item, locus.slot);
      g.position.set(pos.x, pos.y + this.floorY(floor ? floor.level : 0), pos.z);
      g.userData.baseY = g.position.y;
    }
    this.rebuildPath();
  }

  // ---------- 记忆路径 ----------
  rebuildPath() {
    disposeDeep(this.pathGroup);
    this.pathGroup.clear();
    if (!this.palace) return;
    const pts = [];
    for (const id of this.palace.path) {
      const g = this.markerGroups.get(id);
      if (g) pts.push({ v: new THREE.Vector3(g.position.x, g.userData.baseY - 0.1, g.position.z), level: g.userData.level });
    }
    const mat = new THREE.MeshBasicMaterial({ color: PATH_COLOR, transparent: true, opacity: 0.8 });
    let run = [];
    const flushRun = () => {
      if (run.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(run.map(p => p.v), false, 'catmullrom', 0.1);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, run.length * 8), 0.035, 6), mat);
        tube.userData.level = run[0].level;
        this.pathGroup.add(tube);
      }
      run = [];
    };
    for (const p of pts) {
      if (run.length && run[run.length - 1].level !== p.level) flushRun();
      run.push(p);
    }
    flushRun();
  }

  // ---------- 可见性（建造：单层聚焦；巡游：全部） ----------
  setViewMode(mode, activeLevel = 0) {
    this.viewMode = mode; this.activeLevel = activeLevel;
    this.grid.visible = mode === 'build';
    this.grid.position.y = this.floorY(activeLevel) + 0.01;
    for (const [level, fg] of this.floorGroups) {
      if (mode === 'build') {
        fg.visible = level <= activeLevel;
        const ghost = level < activeLevel;
        fg.traverse(o => {
          if (o.isMesh && o.userData.isWall) o.material = ghost ? wallGhostMat : wallMat;
          if (o.isLine && o.userData.isWallEdge) o.visible = !ghost;
          if (o.isSprite && o.userData.isRoomLabel) o.visible = !ghost;
          if (o.isMesh) o.castShadow = !ghost;
        });
      } else {
        fg.visible = true;
        fg.traverse(o => {
          if (o.isMesh && o.userData.isWall) { o.material = wallMat; o.castShadow = true; }
          if (o.isLine && o.userData.isWallEdge) o.visible = true;
          if (o.isSprite && o.userData.isRoomLabel) o.visible = false;
        });
      }
    }
    for (const g of this.furnGroups.values()) {
      g.visible = mode === 'build' ? g.userData.level <= activeLevel : true;
    }
    for (const g of this.markerGroups.values()) {
      g.visible = mode === 'build' ? g.userData.level === activeLevel : true;
    }
    for (const t of this.pathGroup.children) {
      t.visible = mode === 'build' ? t.userData.level === activeLevel : true;
    }
  }

  setPathVisible(v) { this.pathGroup.visible = v; }
  setMarkersVisible(v) { for (const g of this.markerGroups.values()) g.visible = v && (this.viewMode !== 'build' || g.userData.level === this.activeLevel); }

  // ---------- 碰撞查询 ----------
  colliders(level) {
    const walls = this.wallCache.get(level);
    const out = [];
    if (walls) for (const s of walls.solids) out.push({ minX: s.x0, maxX: s.x1, minZ: s.z0, maxZ: s.z1 });
    for (const item of this.palace.furniture) {
      const floor = this.palace.floors.find(f => f.id === item.floorId);
      if (!floor || floor.level !== level) continue;
      const bb = furnitureAABB(item, 0.05);
      if (bb.noCollide || bb.isStairs || bb.h < 0.5) continue;
      out.push(bb);
    }
    return out;
  }

  // ---------- 拾取 ----------
  pick(ndc, camera, opts = {}) {
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const h of hits) {
      if (!h.object.visible) continue;
      let o = h.object;
      if (opts.loci && o.userData.kind === 'locus') return { kind: 'locus', id: o.userData.id, point: h.point };
      if (opts.furniture && o.userData.furnId) return { kind: 'furniture', id: o.userData.furnId, point: h.point };
      if (opts.rooms && o.userData.kind === 'room') return { kind: 'room', id: o.userData.id, point: h.point };
      if (opts.stopAtWall && o.userData.isWall) return { kind: 'wall', point: h.point };
    }
    return null;
  }

  groundPoint(ndc, camera, level = 0) {
    this.raycaster.setFromCamera(ndc, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.floorY(level));
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, p) ? p : null;
  }

  update(camera) {
    const t = this._clock.getElapsedTime();
    for (const g of this.markerGroups.values()) {
      g.position.y = g.userData.baseY + Math.sin(t * 2 + g.userData.phase) * 0.05;
      g.children[0].rotation.y = t * 1.2 + g.userData.phase;
    }
    for (const c of this.clouds.children) {
      c.position.x += c.userData.speed * 0.016;
      if (c.position.x > 55) c.position.x = -55;
    }
    this.renderer.render(this.scene, camera);
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
  }
}

function disposeDeep(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.isSprite && o.material.map) { o.material.map.dispose(); o.material.dispose(); }
  });
}

// ---------- 宫殿缩略图（列表页卡片用） ----------
let thumbRenderer = null;
export function renderPalaceThumb(palace) {
  try {
    if (!thumbRenderer) {
      thumbRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      thumbRenderer.setSize(420, 260);
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#bfe6ff');
    scene.add(new THREE.HemisphereLight('#ffffff', '#e8e0d0', 1.05));
    const sun = new THREE.DirectionalLight('#fff2d6', 1.8);
    sun.position.set(10, 18, 8); scene.add(sun);
    const g0 = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshToonMaterial({ color: '#93d47f', gradientMap: toonGrad }));
    g0.rotation.x = -Math.PI / 2; g0.position.y = -0.1; scene.add(g0);

    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxLevel = 0;
    for (const floor of palace.floors) {
      maxLevel = Math.max(maxLevel, floor.level);
      const fg = new THREE.Group();
      fg.position.y = floor.level * FLOOR_GAP;
      for (const room of floor.rooms) {
        minX = Math.min(minX, room.x); maxX = Math.max(maxX, room.x + room.w);
        minZ = Math.min(minZ, room.z); maxZ = Math.max(maxZ, room.z + room.d);
        const slab = new THREE.Mesh(
          new THREE.BoxGeometry(room.w, 0.16, room.d),
          new THREE.MeshToonMaterial({ color: FLOOR_PALETTE[room.floorColor % FLOOR_PALETTE.length], gradientMap: toonGrad }),
        );
        slab.position.set(room.x + room.w / 2, -0.08, room.z + room.d / 2);
        fg.add(slab);
      }
      const walls = computeWalls(floor);
      for (const s of [...walls.solids, ...walls.doors]) {
        const w = s.x1 - s.x0, d = s.z1 - s.z0, h = s.y1 - s.y0;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
        mesh.position.set((s.x0 + s.x1) / 2, s.y0 + h / 2, (s.z0 + s.z1) / 2);
        fg.add(mesh);
      }
      scene.add(fg);
    }
    for (const item of palace.furniture) {
      const floor = palace.floors.find(f => f.id === item.floorId);
      const g = buildFurniture(item);
      g.position.y = (floor ? floor.level : 0) * FLOOR_GAP;
      scene.add(g);
    }
    if (minX > maxX) { minX = -3; maxX = 3; minZ = -3; maxZ = 3; }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ, 6);
    const cam = new THREE.PerspectiveCamera(42, 420 / 260, 0.1, 300);
    cam.position.set(cx + span * 0.85, span * 0.95 + maxLevel * FLOOR_GAP, cz + span * 0.95);
    cam.lookAt(cx, maxLevel * FLOOR_GAP * 0.4, cz);
    thumbRenderer.render(scene, cam);
    const url = thumbRenderer.domElement.toDataURL('image/jpeg', 0.75);
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    return url;
  } catch { return null; }
}
