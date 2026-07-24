// ============ 数据模型与本地存储 ============
export const STORE_KEY = 'memoryPalace.v1';
export const GRID = 0.5;           // 网格步长（米）
export const WALL_H = 2.7;         // 墙高
export const WALL_T = 0.14;        // 墙厚
export const FLOOR_GAP = 3.4;      // 层间高度
export const DOOR_W_CELLS = 2;     // 门洞宽（格数，2 格 = 1 米）
export const DOOR_H = 2.1;         // 门洞高

// 家具动漫色板（高饱和糖果色）
export const PALETTE = [
  '#ff8fab', // 樱花粉
  '#7ec8f7', // 天空蓝
  '#ffd166', // 阳光黄
  '#8fdd88', // 嫩芽绿
  '#c3a6ff', // 薰衣草紫
  '#ffb377', // 蜜橘橙
  '#7fe0d4', // 薄荷青
  '#ff7b9c', // 玫红
];
// 房间地板色板（明快粉彩）
export const FLOOR_PALETTE = [
  '#f6d9ae', '#c9ecc4', '#bcdcf5', '#f9cfc4', '#e5d1f5', '#fff0bd',
];

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function makePalace(name) {
  return {
    id: uid(), name, createdAt: Date.now(), updatedAt: Date.now(),
    floors: [makeFloor(0)],
    furniture: [],   // {id, floorId, type, x, z, rot, colorIndex}
    loci: [],        // {id, furnitureId, slot, title, body, mnemonic, image, status, reviews, lastReview}
    path: [],        // 有序 locus id 列表（即记忆路径）
  };
}
export function makeFloor(level) {
  return { id: uid(), level, name: `${level + 1}F`, rooms: [] };
}
export function makeRoom(x, z, w, d) {
  return { id: uid(), name: '房间', x, z, w, d, floorColor: 0 };
}
export function makeFurniture(floorId, type, x, z) {
  return { id: uid(), floorId, type, x, z, rot: 0, colorIndex: 0 };
}
export function makeLocus(furnitureId, slot) {
  return {
    id: uid(), furnitureId, slot,
    title: '', body: '', mnemonic: '', image: null,
    status: 'empty',   // empty | filled | fuzzy | known
    reviews: 0, lastReview: null,
  };
}

export function locusStatus(locus) {
  if (locus.status === 'known') return 'known';
  if (locus.status === 'fuzzy') return 'fuzzy';
  return (locus.title || locus.body || locus.image) ? 'filled' : 'empty';
}

// ---------- 存储 ----------
function blank() { return { version: 1, palaces: [] }; }

export function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return blank();
    const data = JSON.parse(raw);
    if (!Array.isArray(data.palaces)) return blank();
    return data;
  } catch { return blank(); }
}

export function saveStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

export function storageUsage() {
  const raw = localStorage.getItem(STORE_KEY) || '';
  return { bytes: raw.length * 2, limit: 5 * 1024 * 1024 };
}

// ---------- 撤销栈（结构快照） ----------
export class UndoStack {
  constructor(limit = 25) { this.limit = limit; this.undoS = []; this.redoS = []; }
  snapshot(palace) {
    this.undoS.push(JSON.stringify(palace));
    if (this.undoS.length > this.limit) this.undoS.shift();
    this.redoS.length = 0;
  }
  undo(palace) {
    if (!this.undoS.length) return null;
    this.redoS.push(JSON.stringify(palace));
    return JSON.parse(this.undoS.pop());
  }
  redo(palace) {
    if (!this.redoS.length) return null;
    this.undoS.push(JSON.stringify(palace));
    return JSON.parse(this.redoS.pop());
  }
  get canUndo() { return this.undoS.length > 0; }
  get canRedo() { return this.redoS.length > 0; }
}

// ---------- 几何工具 ----------
export const snap = v => Math.round(v / GRID) * GRID;
export function roomsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.z < b.z + b.d && a.z + a.d > b.z;
}

// ---------- 示例宫殿 ----------
export function makeSamplePalace() {
  const p = makePalace('示例宫殿 · 中国朝代顺序');
  const f1 = p.floors[0];
  const f2 = makeFloor(1); p.floors.push(f2);

  // 一层：客厅 + 书房 + 走廊；二层：卧室
  const living = Object.assign(makeRoom(0, 0, 7, 6), { name: '客厅', floorColor: 0 });
  const study = Object.assign(makeRoom(7, 0, 5, 6), { name: '书房', floorColor: 2 });
  const hall  = Object.assign(makeRoom(0, 6, 12, 3), { name: '走廊', floorColor: 1 });
  f1.rooms.push(living, study, hall);
  const bed = Object.assign(makeRoom(3, 0, 7, 6), { name: '卧室', floorColor: 3 });
  f2.rooms.push(bed);

  const put = (floorId, type, x, z, rot = 0, colorIndex = 0) => {
    const it = Object.assign(makeFurniture(floorId, type, x, z), { rot, colorIndex });
    p.furniture.push(it); return it;
  };
  const sofa = put(f1.id, 'sofa', 2.5, 1.2, 0, 0);
  const tv   = put(f1.id, 'tvstand', 2.5, 5.2, Math.PI, 4);
  const tea  = put(f1.id, 'coffeetable', 2.5, 3, 0, 2);
  const shelf= put(f1.id, 'bookshelf', 6.2, 1, Math.PI / 2, 3);
  put(f1.id, 'plant', 0.7, 5.2, 0, 0);
  put(f1.id, 'rug', 2.5, 3, 0, 1);
  const desk = put(f1.id, 'desk', 9.5, 1, 0, 2);
  put(f1.id, 'chair', 9.5, 2.2, Math.PI, 3);
  const clock= put(f1.id, 'grandclock', 11.3, 4.5, -Math.PI / 2, 6);
  put(f1.id, 'stairs', 10.5, 7.5, Math.PI / 2, 5);
  const bedF = put(f2.id, 'bed', 5.5, 2, 0, 1);
  const ward = put(f2.id, 'wardrobe', 8.8, 1, Math.PI / 2, 5);

  const mount = (furn, slot, title, body, mnemonic) => {
    const l = Object.assign(makeLocus(furn.id, slot), { title, body, mnemonic, status: 'filled' });
    p.loci.push(l); p.path.push(l.id); return l;
  };
  mount(sofa, 0, '夏', '约前2070–前1600年，禹建立，中国第一个王朝', '沙发上坐着大禹，抱着治水的铲子在乘凉（夏天）');
  mount(tea, 0, '商', '约前1600–前1046年，汤建立，甲骨文出现', '茶几上摆满做生意（商）用的龟甲算盘');
  mount(tv, 0, '周', '前1046–前256年，分西周东周，礼乐制度', '电视里在播《周游列国》纪录片');
  mount(shelf, 0, '秦', '前221–前207年，始皇统一六国、统一文字', '书架第一层压着一排统一字体的竹简');
  mount(shelf, 1, '汉', '前202–220年，分西汉东汉，丝绸之路', '书架第二层挂着一条丝绸，通向西域');
  mount(desk, 0, '三国', '220–280年，魏蜀吴三分天下', '书桌上三个笔筒摆成三角，互相对峙');
  mount(clock, 0, '晋 / 南北朝', '265–589年，短暂统一后南北分裂', '老爷钟的钟摆左右摇摆，像南北来回拉锯');
  mount(bedF, 0, '隋 / 唐', '581–907年，大运河、盛唐气象', '床上铺着一条大运河形状的蓝色绸被');
  mount(ward, 0, '宋元明清', '960–1912年，四个朝代依次更替', '衣柜四层各挂一件朝服：宋青、元白、明红、清蓝');

  return p;
}
