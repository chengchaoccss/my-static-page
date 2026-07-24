// ============ 程序化低多边形家具库 ============
import * as THREE from 'three';
import { PALETTE } from './data.js';

// ---------- 小工具 ----------
const matCache = new Map();
function M(hex) {
  if (!matCache.has(hex)) {
    matCache.set(hex, new THREE.MeshLambertMaterial({ color: hex, flatShading: true }));
  }
  return matCache.get(hex);
}
export function shade(hex, f) {
  const c = new THREE.Color(hex);
  if (f >= 0) c.lerp(new THREE.Color('#ffffff'), f); else c.lerp(new THREE.Color('#2c2a24'), -f);
  return '#' + c.getHexString();
}
function B(parent, w, h, d, hex, x = 0, y = 0, z = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(hex));
  m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
function C(parent, rt, rb, h, hex, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), M(hex));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
function Ico(parent, r, hex, x, y, z, detail = 0) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), M(hex));
  m.position.set(x, y, z); m.castShadow = true;
  parent.add(m); return m;
}
// 确定性伪随机（家具细节用，避免每次重建变样）
function rng(seedStr) {
  let s = 0;
  for (let i = 0; i < seedStr.length; i++) s = (s * 31 + seedStr.charCodeAt(i)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const wood = '#b59b7c', woodD = '#96805f', darkacc = '#55584f', cream = '#efe9dd';

function legs4(g, w, d, h, hex, r = 0.04, inset = 0.08) {
  const hw = w / 2 - inset, hd = d / 2 - inset;
  [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]].forEach(([x, z]) => C(g, r, r, h, hex, x, h / 2, z, 6));
}

// ---------- 家具目录 ----------
// 每项：name 名称 / cat 分类 / ico 面板图标 / w,d 占地 / h 高度 / build(group, mainHex, id)
export const CATALOG = {
  sofa: {
    name: '沙发', cat: '客厅', ico: '🛋️', w: 2.2, d: 1.0, h: 0.85,
    build(g, c) {
      B(g, 2.2, 0.32, 1.0, shade(c, -0.15), 0, 0.26, 0);
      B(g, 2.2, 0.55, 0.24, shade(c, -0.1), 0, 0.58, -0.38);
      B(g, 0.24, 0.34, 1.0, shade(c, -0.1), -0.98, 0.59, 0);
      B(g, 0.24, 0.34, 1.0, shade(c, -0.1), 0.98, 0.59, 0);
      B(g, 0.82, 0.18, 0.68, c, -0.44, 0.51, 0.06);
      B(g, 0.82, 0.18, 0.68, shade(c, 0.12), 0.44, 0.51, 0.06);
      legs4(g, 2.1, 0.9, 0.1, woodD);
    },
  },
  armchair: {
    name: '单人沙发', cat: '客厅', ico: '💺', w: 1.0, d: 1.0, h: 0.85,
    build(g, c) {
      B(g, 1.0, 0.32, 1.0, shade(c, -0.15), 0, 0.26, 0);
      B(g, 1.0, 0.55, 0.24, shade(c, -0.05), 0, 0.58, -0.38);
      B(g, 0.2, 0.3, 1.0, shade(c, -0.05), -0.4, 0.57, 0);
      B(g, 0.2, 0.3, 1.0, shade(c, -0.05), 0.4, 0.57, 0);
      B(g, 0.56, 0.16, 0.6, shade(c, 0.12), 0, 0.5, 0.1);
      legs4(g, 0.9, 0.9, 0.1, woodD);
    },
  },
  coffeetable: {
    name: '茶几', cat: '客厅', ico: '🫖', w: 1.2, d: 0.7, h: 0.45,
    build(g, c) {
      B(g, 1.2, 0.07, 0.7, c, 0, 0.42, 0);
      B(g, 1.0, 0.05, 0.55, shade(c, -0.2), 0, 0.18, 0);
      legs4(g, 1.1, 0.6, 0.4, woodD, 0.035);
      C(g, 0.09, 0.07, 0.1, cream, -0.3, 0.51, 0.1, 8);
    },
  },
  tvstand: {
    name: '电视柜', cat: '客厅', ico: '📺', w: 1.8, d: 0.45, h: 1.4,
    build(g, c) {
      B(g, 1.8, 0.42, 0.45, c, 0, 0.31, 0);
      B(g, 0.56, 0.3, 0.4, shade(c, -0.18), -0.58, 0.31, 0.01);
      B(g, 0.56, 0.3, 0.4, shade(c, -0.18), 0.58, 0.31, 0.01);
      legs4(g, 1.7, 0.38, 0.1, woodD);
      B(g, 1.3, 0.78, 0.06, '#3c3f3a', 0, 1.0, -0.1);
      B(g, 1.18, 0.66, 0.02, '#5b7b8a', 0, 1.0, -0.065);
    },
  },
  floorlamp: {
    name: '落地灯', cat: '客厅', ico: '💡', w: 0.45, d: 0.45, h: 1.6,
    build(g, c) {
      C(g, 0.16, 0.2, 0.05, darkacc, 0, 0.025, 0, 10);
      C(g, 0.02, 0.02, 1.25, darkacc, 0, 0.66, 0, 6);
      C(g, 0.14, 0.22, 0.3, c, 0, 1.42, 0, 10);
      C(g, 0.1, 0.1, 0.02, '#f7ecc8', 0, 1.28, 0, 10);
    },
  },
  bookshelf: {
    name: '书架', cat: '客厅', ico: '📚', w: 1.2, d: 0.36, h: 1.9,
    build(g, c, id) {
      B(g, 1.2, 1.9, 0.34, shade(c, -0.15), 0, 0.95, 0);
      B(g, 1.08, 1.78, 0.3, shade(c, 0.35), 0, 0.95, 0.03);
      const r = rng(id || 'shelf');
      for (let i = 0; i < 4; i++) {
        const y = 0.28 + i * 0.44;
        B(g, 1.08, 0.05, 0.32, shade(c, -0.15), 0, y + 0.2, 0.02);
        let x = -0.46;
        while (x < 0.42) {
          const bw = 0.07 + r() * 0.07, bh = 0.24 + r() * 0.12;
          B(g, bw, bh, 0.2, PALETTE[Math.floor(r() * PALETTE.length)], x + bw / 2, y + bh / 2 - 0.02, 0.04);
          x += bw + 0.015;
          if (r() < 0.15) x += 0.08;
        }
      }
    },
  },
  rug: {
    name: '地毯', cat: '客厅', ico: '🟫', w: 2.4, d: 1.7, h: 0.04, noCollide: true,
    build(g, c) {
      B(g, 2.4, 0.03, 1.7, shade(c, -0.08), 0, 0.015, 0);
      B(g, 2.1, 0.032, 1.4, c, 0, 0.016, 0);
      B(g, 1.2, 0.034, 0.8, shade(c, 0.18), 0, 0.017, 0);
    },
  },
  wallart: {
    name: '装饰画', cat: '客厅', ico: '🖼️', w: 0.9, d: 0.18, h: 1.75,
    build(g, c) {
      C(g, 0.02, 0.02, 1.5, woodD, -0.3, 0.75, 0, 6);
      C(g, 0.02, 0.02, 1.5, woodD, 0.3, 0.75, 0, 6);
      B(g, 0.9, 1.1, 0.06, woodD, 0, 1.05, 0.02);
      B(g, 0.78, 0.98, 0.05, cream, 0, 1.05, 0.035);
      Ico(g, 0.16, c, -0.12, 1.12, 0.08);
      C(g, 0.12, 0.12, 0.03, shade(c, 0.3), 0.18, 0.85, 0.07, 8);
    },
  },
  bed: {
    name: '床', cat: '卧室', ico: '🛏️', w: 1.7, d: 2.2, h: 1.0,
    build(g, c) {
      B(g, 1.7, 0.28, 2.2, woodD, 0, 0.24, 0);
      B(g, 1.7, 0.9, 0.12, wood, 0, 0.55, -1.04);
      B(g, 1.58, 0.22, 2.0, cream, 0, 0.48, 0.04);
      B(g, 1.58, 0.14, 0.9, c, 0, 0.55, 0.56);
      B(g, 0.6, 0.14, 0.4, '#ffffff', -0.4, 0.63, -0.7, 0.1);
      B(g, 0.6, 0.14, 0.4, '#f4efe2', 0.42, 0.63, -0.7, -0.08);
      legs4(g, 1.6, 2.1, 0.12, woodD, 0.05);
    },
  },
  wardrobe: {
    name: '衣柜', cat: '卧室', ico: '🚪', w: 1.5, d: 0.6, h: 2.1,
    build(g, c) {
      B(g, 1.5, 2.1, 0.6, c, 0, 1.05, 0);
      B(g, 0.02, 1.9, 0.04, shade(c, -0.3), 0, 1.02, 0.3);
      B(g, 0.05, 0.3, 0.05, darkacc, -0.09, 1.05, 0.31);
      B(g, 0.05, 0.3, 0.05, darkacc, 0.09, 1.05, 0.31);
      B(g, 1.5, 0.08, 0.62, shade(c, -0.2), 0, 2.06, 0);
    },
  },
  nightstand: {
    name: '床头柜', cat: '卧室', ico: '🕯️', w: 0.5, d: 0.45, h: 0.55,
    build(g, c) {
      B(g, 0.5, 0.42, 0.45, c, 0, 0.3, 0);
      B(g, 0.4, 0.12, 0.02, shade(c, -0.25), 0, 0.36, 0.23);
      C(g, 0.03, 0.03, 0.03, darkacc, 0, 0.36, 0.25, 6);
      legs4(g, 0.44, 0.4, 0.09, woodD, 0.03);
      C(g, 0.06, 0.08, 0.14, cream, 0.1, 0.58, 0, 8);
    },
  },
  dresser: {
    name: '梳妆台', cat: '卧室', ico: '🪞', w: 1.1, d: 0.45, h: 1.5,
    build(g, c) {
      B(g, 1.1, 0.5, 0.45, c, 0, 0.45, 0);
      legs4(g, 1.0, 0.4, 0.2, woodD, 0.035);
      B(g, 0.44, 0.1, 0.02, shade(c, -0.25), -0.28, 0.5, 0.23);
      B(g, 0.44, 0.1, 0.02, shade(c, -0.25), 0.28, 0.5, 0.23);
      C(g, 0.32, 0.32, 0.04, woodD, 0, 1.1, -0.12, 12).rotation.x = Math.PI / 2;
      C(g, 0.27, 0.27, 0.05, '#cfe0e4', 0, 1.1, -0.115, 12).rotation.x = Math.PI / 2;
    },
  },
  desk: {
    name: '书桌', cat: '书房', ico: '🖥️', w: 1.4, d: 0.7, h: 1.1,
    build(g, c) {
      B(g, 1.4, 0.06, 0.7, c, 0, 0.74, 0);
      B(g, 0.4, 0.68, 0.62, shade(c, -0.12), 0.45, 0.37, 0);
      C(g, 0.03, 0.03, 0.7, woodD, -0.62, 0.37, -0.28, 6);
      C(g, 0.03, 0.03, 0.7, woodD, -0.62, 0.37, 0.28, 6);
      B(g, 0.5, 0.34, 0.04, '#3c3f3a', -0.2, 0.98, -0.18);
      B(g, 0.44, 0.28, 0.02, '#6b8b9a', -0.2, 0.98, -0.155);
      B(g, 0.06, 0.1, 0.05, darkacc, -0.2, 0.8, -0.18);
      B(g, 0.34, 0.025, 0.14, '#e8e2d2', -0.16, 0.79, 0.14, -0.15);
    },
  },
  chair: {
    name: '椅子', cat: '书房', ico: '🪑', w: 0.5, d: 0.52, h: 0.9,
    build(g, c) {
      B(g, 0.46, 0.06, 0.46, c, 0, 0.45, 0);
      B(g, 0.46, 0.5, 0.06, shade(c, -0.08), 0, 0.72, -0.2);
      legs4(g, 0.42, 0.42, 0.43, woodD, 0.025, 0.04);
    },
  },
  bookpile: {
    name: '书堆', cat: '书房', ico: '📖', w: 0.45, d: 0.45, h: 0.4, noCollide: true,
    build(g, c, id) {
      const r = rng(id || 'pile');
      let y = 0;
      for (let i = 0; i < 5; i++) {
        const h = 0.055 + r() * 0.02;
        B(g, 0.34 - i * 0.02, h, 0.24, i === 2 ? c : PALETTE[Math.floor(r() * PALETTE.length)],
          (r() - 0.5) * 0.06, y + h / 2, (r() - 0.5) * 0.06, (r() - 0.5) * 0.5);
        y += h;
      }
    },
  },
  fridge: {
    name: '冰箱', cat: '厨房', ico: '🧊', w: 0.75, d: 0.7, h: 1.85,
    build(g, c) {
      B(g, 0.75, 1.85, 0.7, c, 0, 0.925, 0);
      B(g, 0.77, 0.03, 0.72, shade(c, -0.25), 0, 1.28, 0);
      B(g, 0.05, 0.4, 0.05, darkacc, -0.28, 1.55, 0.36);
      B(g, 0.05, 0.6, 0.05, darkacc, -0.28, 0.8, 0.36);
    },
  },
  stove: {
    name: '灶台', cat: '厨房', ico: '🍳', w: 1.5, d: 0.65, h: 0.92,
    build(g, c) {
      B(g, 1.5, 0.86, 0.65, c, 0, 0.43, 0);
      B(g, 1.54, 0.06, 0.69, shade(c, 0.3), 0, 0.89, 0);
      C(g, 0.13, 0.13, 0.03, '#3c3f3a', -0.4, 0.93, 0.05, 10);
      C(g, 0.13, 0.13, 0.03, '#3c3f3a', -0.05, 0.93, -0.12, 10);
      C(g, 0.16, 0.14, 0.16, '#8a8f85', 0.45, 1.0, 0, 10);
      B(g, 0.4, 0.25, 0.02, shade(c, -0.3), -0.25, 0.5, 0.34);
    },
  },
  diningtable: {
    name: '餐桌', cat: '厨房', ico: '🍽️', w: 1.6, d: 0.9, h: 0.78,
    build(g, c) {
      B(g, 1.6, 0.07, 0.9, c, 0, 0.745, 0);
      legs4(g, 1.45, 0.75, 0.71, woodD, 0.045);
      C(g, 0.14, 0.1, 0.06, cream, 0, 0.81, 0, 10);
      Ico(g, 0.07, '#c9856a', -0.05, 0.87, 0.02);
      Ico(g, 0.06, '#a8b86a', 0.08, 0.86, -0.04);
    },
  },
  cabinet: {
    name: '橱柜', cat: '厨房', ico: '🗄️', w: 1.2, d: 0.55, h: 0.92,
    build(g, c) {
      B(g, 1.2, 0.86, 0.55, c, 0, 0.43, 0);
      B(g, 1.24, 0.06, 0.59, shade(c, 0.3), 0, 0.89, 0);
      B(g, 0.02, 0.7, 0.03, shade(c, -0.3), 0, 0.42, 0.28);
      B(g, 0.04, 0.16, 0.04, darkacc, -0.1, 0.5, 0.29);
      B(g, 0.04, 0.16, 0.04, darkacc, 0.1, 0.5, 0.29);
    },
  },
  plant: {
    name: '绿植', cat: '装饰', ico: '🪴', w: 0.55, d: 0.55, h: 1.3,
    build(g, c) {
      C(g, 0.16, 0.12, 0.3, '#c9a892', 0, 0.15, 0, 8);
      C(g, 0.03, 0.04, 0.5, '#8a7355', 0, 0.5, 0, 6);
      Ico(g, 0.26, '#7d9a76', 0, 0.95, 0);
      Ico(g, 0.18, '#8fae82', 0.16, 0.78, 0.1);
      Ico(g, 0.15, '#6d8a66', -0.15, 0.8, -0.08);
    },
  },
  grandclock: {
    name: '老爷钟', cat: '装饰', ico: '🕰️', w: 0.55, d: 0.35, h: 2.0,
    build(g, c) {
      B(g, 0.55, 2.0, 0.35, c, 0, 1.0, 0);
      C(g, 0.19, 0.19, 0.04, cream, 0, 1.68, 0.17, 12).rotation.x = Math.PI / 2;
      B(g, 0.02, 0.12, 0.01, darkacc, 0, 1.72, 0.2);
      B(g, 0.09, 0.02, 0.01, darkacc, 0.035, 1.68, 0.2);
      B(g, 0.3, 0.9, 0.02, shade(c, -0.35), 0, 0.85, 0.17);
      C(g, 0.06, 0.06, 0.02, '#d8b56a', 0, 0.6, 0.18, 10).rotation.x = Math.PI / 2;
      B(g, 0.6, 0.1, 0.4, shade(c, -0.2), 0, 2.03, 0);
    },
  },
  statue: {
    name: '雕塑', cat: '装饰', ico: '🗿', w: 0.55, d: 0.55, h: 1.5,
    build(g, c) {
      B(g, 0.5, 0.7, 0.5, shade(c, 0.25), 0, 0.35, 0);
      Ico(g, 0.22, c, 0, 0.94, 0, 0);
      C(g, 0.05, 0.14, 0.35, c, 0, 1.2, 0, 5);
      Ico(g, 0.12, shade(c, 0.3), 0, 1.44, 0, 0);
    },
  },
  mirror: {
    name: '穿衣镜', cat: '装饰', ico: '🪩', w: 0.6, d: 0.4, h: 1.7,
    build(g, c) {
      B(g, 0.5, 0.06, 0.4, woodD, 0, 0.03, 0);
      const fr = C(g, 0.3, 0.3, 0.05, c, 0, 1.0, 0, 12);
      fr.rotation.x = Math.PI / 2; fr.scale.y = 1.55;
      const mi = C(g, 0.25, 0.25, 0.06, '#cfe0e4', 0, 1.0, 0.0, 12);
      mi.rotation.x = Math.PI / 2; mi.scale.y = 1.55;
    },
  },
  stairs: {
    name: '楼梯', cat: '结构', ico: '🪜', w: 1.3, d: 3.0, h: 2.6, isStairs: true,
    build(g, c) {
      const steps = 10, rise = 2.6 / steps, run = 2.7 / steps;
      for (let i = 0; i < steps; i++) {
        B(g, 1.2, rise, run, i % 2 ? shade(c, 0.08) : c, 0, rise * (i + 0.5), 1.25 - run * (i + 0.5));
      }
      for (const side of [-0.62, 0.62]) {
        B(g, 0.06, 0.9, 3.0, shade(c, -0.25), side, 1.3, 0, 0).rotation.x = -Math.atan2(2.6, 2.7) * 0.97;
      }
    },
  },
};

export const CATEGORIES = ['客厅', '卧室', '书房', '厨房', '装饰', '结构'];

// ---------- 构建家具 3D 对象 ----------
export function buildFurniture(item) {
  const def = CATALOG[item.type];
  const g = new THREE.Group();
  if (!def) return g;
  def.build(g, PALETTE[item.colorIndex % PALETTE.length], item.id);
  g.position.set(item.x, 0, item.z);
  g.rotation.y = item.rot;
  g.userData = { kind: 'furniture', id: item.id };
  g.traverse(o => { o.userData.furnId = item.id; });
  return g;
}

// 家具局部坐标下第 slot 个记忆点的悬浮位置
export function slotLocalPos(type, slot) {
  const def = CATALOG[type] || { w: 1, d: 1, h: 1 };
  const spots = [
    [0, 0], [-0.28, 0], [0.28, 0], [0, -0.28], [0, 0.28],
    [-0.28, -0.28], [0.28, 0.28], [-0.28, 0.28], [0.28, -0.28],
  ];
  const [fx, fz] = spots[slot % spots.length];
  const tier = Math.floor(slot / spots.length);
  return new THREE.Vector3(fx * def.w, def.h + 0.42 + tier * 0.45, fz * def.d);
}

// 家具世界坐标记忆点位置
export function slotWorldPos(item, slot) {
  const p = slotLocalPos(item.type, slot);
  const cos = Math.cos(item.rot), sin = Math.sin(item.rot);
  return new THREE.Vector3(
    item.x + p.x * cos + p.z * sin,
    p.y,
    item.z - p.x * sin + p.z * cos,
  );
}

// 家具旋转后的世界包围盒（碰撞用）
export function furnitureAABB(item, pad = 0) {
  const def = CATALOG[item.type] || { w: 1, d: 1, h: 1 };
  const cos = Math.abs(Math.cos(item.rot)), sin = Math.abs(Math.sin(item.rot));
  const hw = (def.w * cos + def.d * sin) / 2 + pad;
  const hd = (def.w * sin + def.d * cos) / 2 + pad;
  return {
    minX: item.x - hw, maxX: item.x + hw,
    minZ: item.z - hd, maxZ: item.z + hd,
    h: def.h, noCollide: !!def.noCollide, isStairs: !!def.isStairs,
  };
}
