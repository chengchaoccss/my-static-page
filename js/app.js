// ============ 记忆宫殿 · 应用入口与 UI 粘合层 ============
import {
  loadStore, saveStore, storageUsage, makePalace, makeFloor, makeLocus, makeSamplePalace,
  locusStatus, UndoStack, PALETTE, FLOOR_PALETTE, uid,
} from './data.js';
import { CATALOG, CATEGORIES } from './furniture.js';
import { SceneManager, renderPalaceThumb, STATUS_COLORS } from './scene.js';
import { BuildMode } from './build.js';
import { TourMode } from './tour.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

class App {
  constructor() {
    // APK 内嵌 / 触屏模式
    if (new URLSearchParams(location.search).has('app') || matchMedia('(pointer: coarse)').matches) {
      document.body.classList.add('app-mode');
    }
    this.store = loadStore();
    this.palace = null;
    this.mode = 'build';
    this.activeLevel = 0;
    this.undoStack = new UndoStack();
    this.sm = null; this.build = null; this.tour = null;
    this.leftTab = 'tools';
    this.tourLoop = false;
    this.cardOpen = false;
    this.cardLocus = null;
    this.cardOpts = {};
    this.lastColorIndex = 0;
    this._saveTimer = null;
    this.thumbCache = new Map();
    this.bindGlobal();
    if (matchMedia('(pointer: coarse)').matches) {
      const keys = document.querySelector('#tour-start-overlay .keys');
      if (keys) keys.innerHTML = '<span>左下摇杆 行走</span><span>拖动屏幕 转视角</span><span>右下按钮 查看 / 上下楼</span>';
    }
    this.renderHome();
  }

  // ================= 宫殿列表页 =================
  renderHome() {
    $('#home').classList.remove('hidden');
    $('#studio').classList.add('hidden');
    const grid = $('#palace-grid');
    grid.innerHTML = '';
    if (!this.store.palaces.length) {
      const empty = el('div', 'empty-state', `
        <div class="big">🏛️</div>
        <h3>还没有宫殿</h3>
        <p>点击「新建宫殿」从一块空地开始搭建，<br>或先「生成示例宫殿」看看完整效果</p>`);
      grid.appendChild(empty);
    }
    for (const p of this.store.palaces) {
      const card = el('div', 'palace-card');
      const lociCount = p.loci.length;
      const roomCount = p.floors.reduce((n, f) => n + f.rooms.length, 0);
      const known = p.loci.filter(l => locusStatus(l) === 'known').length;
      card.innerHTML = `
        <div class="palace-thumb"><span class="thumb-fallback">🏛️</span></div>
        <div class="palace-body">
          <h3>${esc(p.name)}</h3>
          <div class="palace-meta">
            <span class="chip">${p.floors.length} 层</span>
            <span class="chip">${roomCount} 个房间</span>
            <span class="chip">${lociCount} 个记忆点</span>
            ${lociCount ? `<span class="chip">已掌握 ${known}/${lociCount}</span>` : ''}
          </div>
        </div>
        <div class="palace-foot">
          <span>${new Date(p.updatedAt).toLocaleDateString('zh-CN')} 更新</span>
          <span class="ops">
            <button class="btn ghost small" data-op="rename">重命名</button>
            <button class="btn ghost small" data-op="export">导出</button>
            <button class="btn ghost small danger" data-op="del">删除</button>
          </span>
        </div>`;
      card.addEventListener('click', e => {
        const op = e.target.dataset && e.target.dataset.op;
        if (op === 'rename') { e.stopPropagation(); this.renamePalace(p); return; }
        if (op === 'export') { e.stopPropagation(); this.exportPalace(p); return; }
        if (op === 'del') { e.stopPropagation(); this.deletePalace(p); return; }
        this.openPalace(p.id);
      });
      grid.appendChild(card);
      // 缩略图异步渲染
      requestAnimationFrame(() => {
        let url = this.thumbCache.get(p.id + ':' + p.updatedAt);
        if (!url) { url = renderPalaceThumb(p); if (url) this.thumbCache.set(p.id + ':' + p.updatedAt, url); }
        if (url) card.querySelector('.palace-thumb').innerHTML = `<img src="${url}" alt="">`;
      });
    }
    const u = storageUsage();
    $('#storage-fill').style.width = Math.min(100, (u.bytes / u.limit) * 100).toFixed(1) + '%';
    $('#storage-text').textContent = (u.bytes / 1024 / 1024).toFixed(2) + ' / 5 MB';
  }

  renamePalace(p) {
    this.prompt('重命名宫殿', p.name, name => {
      if (!name.trim()) return;
      p.name = name.trim(); p.updatedAt = Date.now();
      this.persist(); this.renderHome();
    });
  }

  deletePalace(p) {
    this.confirm(`删除宫殿「${esc(p.name)}」？`, '其中的所有房间、家具与记忆内容都会被删除，且无法恢复。建议先导出备份。', () => {
      this.store.palaces = this.store.palaces.filter(x => x.id !== p.id);
      this.persist(); this.renderHome();
      this.toast('已删除');
    });
  }

  exportPalace(p) {
    const blob = new Blob([JSON.stringify({ app: 'memory-palace', version: 1, palace: p }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `记忆宫殿-${p.name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.toast('已导出 JSON 备份');
  }

  importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const p = data.palace || data;
        if (!p || !Array.isArray(p.floors) || !Array.isArray(p.furniture)) throw new Error('bad');
        p.id = uid(); p.updatedAt = Date.now();
        this.store.palaces.unshift(p);
        this.persist(); this.renderHome();
        this.toast(`已导入「${p.name || '宫殿'}」`);
      } catch {
        this.toast('导入失败：不是有效的宫殿备份文件', 'warn');
      }
    };
    reader.readAsText(file);
  }

  // ================= 打开宫殿 / 模式 =================
  openPalace(id) {
    this.palace = this.store.palaces.find(p => p.id === id);
    if (!this.palace) return;
    $('#home').classList.add('hidden');
    $('#studio').classList.remove('hidden');
    $('#palace-title').textContent = this.palace.name;
    if (!this.sm) {
      this.sm = new SceneManager($('#gl'));
      this.build = new BuildMode(this);
      this.tour = new TourMode(this);
      this.startLoop();
    }
    this.undoStack = new UndoStack();
    this.activeLevel = 0;
    this.sm.setPalace(this.palace);
    this.setMode('build');
    this.build.fitCamera();
    this.saveState('已保存');
  }

  backHome() {
    this.tour.disable(); this.build.disable();
    this.persist();
    this.palace = null;
    this.renderHome();
  }

  setMode(mode) {
    this.mode = mode;
    document.querySelectorAll('#mode-seg button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const isBuild = mode === 'build';
    $('#left-panel').classList.toggle('hidden', !isBuild);
    $('#floor-bar').classList.toggle('hidden', !isBuild);
    $('#right-panel').classList.add('hidden');
    $('#hintbar').classList.toggle('hidden', !isBuild);
    $('#crosshair').classList.toggle('hidden', mode !== 'walk');
    $('#tour-hud').classList.toggle('hidden', isBuild);
    $('#tour-controls').classList.toggle('hidden', mode !== 'auto');
    $('#quiz-progress').classList.add('hidden');
    $('#tour-start-overlay').classList.add('hidden');
    this.hideCard();
    this.tour.disable();
    this.build.disable();
    if (isBuild) {
      this.sm.setViewMode('build', this.activeLevel);
      this.build.enable();
      this.renderFloorBar(); this.renderLeftPanel();
    } else {
      this.sm.setViewMode('tour');
      this.tour.enable(mode);
      if (mode === 'quiz') this.updateSeqUI();
    }
  }

  exitToBuild() { this.setMode('build'); }

  // ================= 保存 / 撤销 =================
  persist() {
    if (this.palace) this.palace.updatedAt = Date.now();
    const r = saveStore(this.store);
    if (!r.ok) this.toast('保存失败：本地存储空间已满，请删除部分图片或导出后清理', 'warn');
    return r.ok;
  }

  save() {
    this.saveState('保存中…');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      if (this.persist()) this.saveState('已保存 ✓');
    }, 350);
  }

  saveState(text) { $('#save-state').textContent = text; }

  snapshot() {
    this.undoStack.snapshot(this.palace);
    this.updateUndoButtons();
  }

  undo() {
    const prev = this.undoStack.undo(this.palace);
    if (!prev) return;
    this.applyPalaceState(prev);
    this.toast('已撤销');
  }
  redo() {
    const next = this.undoStack.redo(this.palace);
    if (!next) return;
    this.applyPalaceState(next);
    this.toast('已重做');
  }
  applyPalaceState(state) {
    Object.assign(this.palace, state);
    if (!this.palace.floors.some(f => f.level === this.activeLevel)) this.activeLevel = 0;
    this.sm.rebuildAll();
    this.sm.setViewMode('build', this.activeLevel);
    this.build.setSelection(null);
    this.renderFloorBar(); this.renderLeftPanel();
    this.save();
    this.updateUndoButtons();
  }
  updateUndoButtons() {
    $('#btn-undo').disabled = !this.undoStack.canUndo;
    $('#btn-redo').disabled = !this.undoStack.canRedo;
  }

  commitStructure() {
    this.sm.rebuildAll();
    this.sm.setViewMode('build', this.activeLevel);
    this.renderFloorBar();
    this.save();
  }
  commitTransform() { this.save(); }

  // ================= 楼层 =================
  setActiveLevel(level) {
    this.activeLevel = level;
    this.sm.setViewMode('build', level);
    this.build.setSelection(null);
    this.build.orbit.ty = this.sm.floorY(level);
    this.renderFloorBar();
  }

  renderFloorBar() {
    const list = $('#floor-list');
    list.innerHTML = '';
    const floors = [...this.palace.floors].sort((a, b) => a.level - b.level);
    for (const f of floors) {
      const b = el('button', f.level === this.activeLevel ? 'active' : '', `${f.level + 1}F`);
      b.title = `第 ${f.level + 1} 层（${f.rooms.length} 个房间）`;
      b.addEventListener('click', () => this.setActiveLevel(f.level));
      b.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.tryDeleteFloor(f);
      });
      list.appendChild(b);
    }
  }

  addFloor() {
    const top = Math.max(...this.palace.floors.map(f => f.level));
    const topFloor = this.palace.floors.find(f => f.level === top);
    if (topFloor && !topFloor.rooms.length) { this.toast(`第 ${top + 1} 层还是空的，先在这一层画房间吧`, 'warn'); this.setActiveLevel(top); return; }
    this.snapshot();
    this.palace.floors.push(makeFloor(top + 1));
    this.commitStructure();
    this.setActiveLevel(top + 1);
    this.toast(`已新增第 ${top + 2} 层 · 记得在下层放一个「楼梯」连接`);
  }

  tryDeleteFloor(f) {
    const top = Math.max(...this.palace.floors.map(x => x.level));
    if (f.level !== top || this.palace.floors.length <= 1) { this.toast('只能删除最顶层', 'warn'); return; }
    const hasFurn = this.palace.furniture.some(x => x.floorId === f.id);
    if (f.rooms.length || hasFurn) {
      this.confirm(`删除第 ${f.level + 1} 层？`, '该层的房间、家具与记忆点都会被删除。', () => this.doDeleteFloor(f));
    } else this.doDeleteFloor(f);
  }
  doDeleteFloor(f) {
    this.snapshot();
    const furnIds = this.palace.furniture.filter(x => x.floorId === f.id).map(x => x.id);
    this.palace.furniture = this.palace.furniture.filter(x => x.floorId !== f.id);
    this.palace.loci = this.palace.loci.filter(l => !furnIds.includes(l.furnitureId));
    this.palace.path = this.palace.path.filter(id => this.palace.loci.some(l => l.id === id));
    this.palace.floors = this.palace.floors.filter(x => x.id !== f.id);
    if (this.activeLevel >= f.level) this.activeLevel = f.level - 1;
    this.commitStructure();
    this.renderLeftPanel();
  }

  // ================= 左侧面板 =================
  renderLeftPanel() {
    document.querySelectorAll('.panel-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === this.leftTab));
    const body = $('#left-body');
    body.innerHTML = '';
    if (this.leftTab === 'tools') {
      const tools = [
        { id: 'select', ico: '🖱️', name: '选择 / 移动', sub: '点击选中，拖拽移动家具' },
        { id: 'room', ico: '✏️', name: '画房间', sub: '拖拽绘制轮廓，自动生成墙体与门' },
        { id: 'delete', ico: '🗑️', name: '删除', sub: '点击删除家具或房间' },
      ];
      const wrap = el('div', 'tool-list');
      for (const t of tools) {
        const b = el('button', 'tool-item' + (this.build.tool === t.id ? ' active' : ''),
          `<span class="t-ico">${t.ico}</span><span><b>${t.name}</b><span class="t-sub">${t.sub}</span></span>`);
        b.addEventListener('click', () => { this.build.setTool(t.id); });
        wrap.appendChild(b);
      }
      body.appendChild(wrap);
      body.appendChild(el('div', 'cat-title', '小提示'));
      body.appendChild(el('div', '', `<div style="font-size:12.5px;color:var(--muted);line-height:1.8">
        · 先画房间，再从「家具」页挑选摆放<br>
        · 点击家具 → 右侧面板「＋添加记忆点」<br>
        · 相邻房间的公共墙会自动开门<br>
        · 多楼层需在下层放置「楼梯」连通<br>
        · <b>R</b> 旋转 · <b>Delete</b> 删除 · <b>Ctrl+Z</b> 撤销</div>`));
    } else if (this.leftTab === 'furn') {
      for (const cat of CATEGORIES) {
        body.appendChild(el('div', 'cat-title', cat));
        const grid = el('div', 'furn-grid');
        for (const [type, def] of Object.entries(CATALOG)) {
          if (def.cat !== cat) continue;
          const b = el('button', 'furn-item' + (this.build.tool === 'furn:' + type ? ' active' : ''),
            `<span class="f-ico">${def.ico}</span><span class="f-name">${def.name}</span>`);
          b.addEventListener('click', () => { this.build.setTool('furn:' + type); this.renderLeftPanel(); });
          grid.appendChild(b);
        }
        body.appendChild(grid);
      }
    } else {
      this.renderPathPanelInto(body);
    }
  }

  renderPathPanel() { if (this.leftTab === 'path' && this.mode === 'build') this.renderLeftPanel(); }

  renderPathPanelInto(body) {
    body.appendChild(el('div', 'cat-title', `记忆路径 · ${this.palace.path.length} 个桩点`));
    if (!this.palace.path.length) {
      body.appendChild(el('div', '', `<div style="font-size:12.5px;color:var(--muted);line-height:1.8;padding:6px 2px">
        还没有记忆点。<br>选中一件家具，在右侧面板点「＋添加记忆点」，它会自动加入路径。</div>`));
      return;
    }
    const wrap = el('div', 'loci-list');
    this.palace.path.forEach((id, i) => {
      const locus = this.palace.loci.find(l => l.id === id);
      if (!locus) return;
      const furn = this.palace.furniture.find(f => f.id === locus.furnitureId);
      const st = locusStatus(locus);
      const row = el('div', 'locus-row');
      row.innerHTML = `
        <span class="locus-num st-${st}">${i + 1}</span>
        <span class="l-title">${esc(locus.title || '（未命名）')}<br><span class="l-sub">${furn ? CATALOG[furn.type].name : '?'}</span></span>
        <span class="l-ops">
          <button class="btn ghost icon small" data-op="up" title="上移">↑</button>
          <button class="btn ghost icon small" data-op="down" title="下移">↓</button>
        </span>`;
      row.addEventListener('click', e => {
        const op = e.target.dataset && e.target.dataset.op;
        if (op === 'up' || op === 'down') { e.stopPropagation(); this.movePathItem(i, op === 'up' ? -1 : 1); return; }
        this.focusLocus(id);
      });
      wrap.appendChild(row);
    });
    body.appendChild(wrap);
  }

  movePathItem(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this.palace.path.length) return;
    this.snapshot();
    const arr = this.palace.path;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.sm.rebuildMarkers();
    this.sm.setViewMode(this.mode === 'build' ? 'build' : 'tour', this.activeLevel);
    this.renderLeftPanel();
    this.save();
  }

  focusLocus(id) {
    const g = this.sm.markerGroups.get(id);
    if (!g) return;
    if (g.userData.level !== this.activeLevel) this.setActiveLevel(g.userData.level);
    this.build.flyTo(g.position.x, this.sm.floorY(g.userData.level), g.position.z, 7);
  }

  // ================= 右侧属性面板 =================
  onToolChange() { if (this.mode === 'build') this.renderLeftPanel(); }
  setHint(html) { $('#hintbar').innerHTML = html; }

  renderRightPanel() {
    const sel = this.build.selection;
    const panel = $('#right-panel');
    if (!sel || this.mode !== 'build') { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const body = $('#rp-body');
    body.innerHTML = '';

    if (sel.kind === 'furniture') {
      const item = this.palace.furniture.find(f => f.id === sel.id);
      if (!item) { panel.classList.add('hidden'); return; }
      const def = CATALOG[item.type];
      $('#rp-title').textContent = `${def.ico} ${def.name}`;

      body.appendChild(el('div', 'field', '<label>操作</label>'));
      const ops = el('div', 'row-btns');
      const mk = (label, fn) => { const b = el('button', 'btn small', label); b.addEventListener('click', fn); ops.appendChild(b); };
      mk('↺ 左转', () => this.rotateSelected(Math.PI / 4));
      mk('↻ 右转', () => this.rotateSelected(-Math.PI / 4));
      mk('⧉ 复制', () => this.duplicateSelected());
      const db = el('button', 'btn small danger', '🗑 删除');
      db.addEventListener('click', () => this.build.deleteByHit({ kind: 'furniture', id: item.id }));
      ops.appendChild(db);
      body.appendChild(ops);

      body.appendChild(el('div', 'field', '<label style="margin-top:14px">配色</label>'));
      const sw = el('div', 'swatches');
      PALETTE.forEach((hex, i) => {
        const s = el('button', 'swatch' + (i === item.colorIndex ? ' active' : ''));
        s.style.background = hex;
        s.addEventListener('click', () => {
          this.snapshot();
          item.colorIndex = i; this.lastColorIndex = i;
          this.sm.removeFurnitureMesh(item.id);
          this.sm.addFurnitureMesh(item);
          this.sm.setViewMode('build', this.activeLevel);
          this.save(); this.renderRightPanel();
        });
        sw.appendChild(s);
      });
      body.appendChild(sw);

      // 记忆点
      const loci = this.palace.loci.filter(l => l.furnitureId === item.id);
      body.appendChild(el('div', 'cat-title', `记忆点 · ${loci.length} 个`));
      const list = el('div', 'loci-list');
      for (const locus of loci) {
        const order = this.palace.path.indexOf(locus.id);
        const st = locusStatus(locus);
        const row = el('div', 'locus-row',
          `<span class="locus-num st-${st}">${order + 1}</span>
           <span class="l-title">${esc(locus.title || '（空白，点击编辑）')}</span>`);
        row.addEventListener('click', () => this.openLocusEditor(locus.id));
        list.appendChild(row);
      }
      body.appendChild(list);
      const add = el('button', 'btn amber', '＋ 添加记忆点');
      add.style.cssText = 'width:100%;margin-top:10px';
      add.addEventListener('click', () => this.addLocus(item));
      body.appendChild(add);
    } else if (sel.kind === 'room') {
      const floor = this.palace.floors.find(f => f.level === this.activeLevel);
      const room = floor.rooms.find(r => r.id === sel.id);
      if (!room) { panel.classList.add('hidden'); return; }
      $('#rp-title').textContent = '🚪 房间';
      const nameField = el('div', 'field', `<label>房间名称</label><input type="text" value="${esc(room.name)}">`);
      nameField.querySelector('input').addEventListener('change', e => {
        this.snapshot();
        room.name = e.target.value.trim() || '房间';
        this.commitStructure();
        this.build.refreshSelection();
      });
      body.appendChild(nameField);
      body.appendChild(el('div', 'field', `<label>尺寸</label><div style="font-size:13px">${room.w.toFixed(1)} × ${room.d.toFixed(1)} 米</div>`));
      body.appendChild(el('div', 'field', '<label>地板颜色</label>'));
      const sw = el('div', 'swatches');
      FLOOR_PALETTE.forEach((hex, i) => {
        const s = el('button', 'swatch' + (i === room.floorColor ? ' active' : ''));
        s.style.background = hex;
        s.addEventListener('click', () => {
          this.snapshot(); room.floorColor = i; this.commitStructure(); this.renderRightPanel();
        });
        sw.appendChild(s);
      });
      body.appendChild(sw);
      const db = el('button', 'btn danger', '🗑 删除房间');
      db.style.cssText = 'width:100%;margin-top:18px';
      db.addEventListener('click', () => this.build.deleteByHit({ kind: 'room', id: room.id }));
      body.appendChild(db);
    }
  }

  rotateSelected(delta) {
    const sel = this.build.selection;
    if (!sel || sel.kind !== 'furniture') return;
    const item = this.palace.furniture.find(f => f.id === sel.id);
    this.snapshot();
    item.rot = (item.rot + delta) % (Math.PI * 2);
    this.sm.updateFurnitureTransform(item);
    this.build.refreshSelection();
    this.save();
  }

  duplicateSelected() {
    const sel = this.build.selection;
    const item = this.palace.furniture.find(f => f.id === sel.id);
    if (!item) return;
    this.snapshot();
    const copy = { ...item, id: uid(), x: item.x + 0.75, z: item.z + 0.75 };
    this.palace.furniture.push(copy);
    this.sm.addFurnitureMesh(copy);
    this.sm.setViewMode('build', this.activeLevel);
    this.build.setSelection({ kind: 'furniture', id: copy.id });
    this.save();
  }

  // ================= 记忆点 =================
  addLocus(item) {
    this.snapshot();
    const slots = this.palace.loci.filter(l => l.furnitureId === item.id).map(l => l.slot);
    let slot = 0; while (slots.includes(slot)) slot++;
    const locus = makeLocus(item.id, slot);
    this.palace.loci.push(locus);
    this.palace.path.push(locus.id);
    this.sm.rebuildMarkers();
    this.sm.setViewMode('build', this.activeLevel);
    this.save();
    this.renderRightPanel(); this.renderPathPanel();
    this.openLocusEditor(locus.id);
  }

  deleteLocus(id, ask) {
    const doDel = () => {
      this.snapshot();
      this.palace.loci = this.palace.loci.filter(l => l.id !== id);
      this.palace.path = this.palace.path.filter(x => x !== id);
      this.sm.rebuildMarkers();
      this.sm.setViewMode(this.mode === 'build' ? 'build' : 'tour', this.activeLevel);
      this.save();
      this.renderRightPanel(); this.renderPathPanel();
      this.closeModal();
    };
    if (ask) this.confirm('删除这个记忆点？', '挂载的内容会一并删除。', doDel);
    else doDel();
  }

  openLocusEditor(id) {
    const locus = this.palace.loci.find(l => l.id === id);
    if (!locus) return;
    const order = this.palace.path.indexOf(id);
    const furn = this.palace.furniture.find(f => f.id === locus.furnitureId);
    const box = $('#modal-box');
    box.innerHTML = `
      <div class="modal-head">
        <h3><span class="locus-num st-${locusStatus(locus)}" style="display:inline-flex;margin-right:8px">${order + 1}</span>记忆点 · ${furn ? CATALOG[furn.type].name : ''}</h3>
        <button class="btn ghost icon" data-x>✕</button>
      </div>
      <div class="modal-body">
        <div class="field"><label>标题（要记的核心内容）</label><input type="text" id="le-title" value="${esc(locus.title)}" placeholder="如：秦朝 · 前221–前207"></div>
        <div class="field"><label>详细内容</label><textarea id="le-body" placeholder="展开的知识点、释义、例句…">${esc(locus.body)}</textarea></div>
        <div class="field"><label>💭 夸张联想（记忆法核心：画面越荒诞越好记）</label><textarea id="le-mnemonic" placeholder="如：想象沙发上坐着巨大的秦始皇在数竹简…">${esc(locus.mnemonic)}</textarea></div>
        <div class="field"><label>联想图片</label>
          <div class="img-drop" id="le-drop">${locus.image ? `<img src="${locus.image}"><button class="img-x" data-imgx>✕</button>` : '点击上传图片（自动压缩存储）'}</div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn danger" data-del>删除记忆点</button>
        <span style="flex:1"></span>
        <button class="btn" data-x>取消</button>
        <button class="btn primary" data-save>保存</button>
      </div>`;
    let pendingImage = locus.image;
    box.querySelector('#le-drop').addEventListener('click', e => {
      if (e.target.dataset.imgx !== undefined) {
        pendingImage = null;
        box.querySelector('#le-drop').innerHTML = '点击上传图片（自动压缩存储）';
        return;
      }
      const fi = $('#file-image');
      fi.onchange = () => {
        const f = fi.files[0]; fi.value = '';
        if (!f) return;
        this.compressImage(f, url => {
          pendingImage = url;
          box.querySelector('#le-drop').innerHTML = `<img src="${url}"><button class="img-x" data-imgx>✕</button>`;
        });
      };
      fi.click();
    });
    box.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => this.closeModal()));
    box.querySelector('[data-del]').addEventListener('click', () => this.deleteLocus(id, true));
    box.querySelector('[data-save]').addEventListener('click', () => {
      this.snapshot();
      locus.title = box.querySelector('#le-title').value.trim();
      locus.body = box.querySelector('#le-body').value.trim();
      locus.mnemonic = box.querySelector('#le-mnemonic').value.trim();
      locus.image = pendingImage;
      if (locus.status === 'empty' && (locus.title || locus.body || locus.image)) locus.status = 'filled';
      this.sm.rebuildMarkers();
      this.sm.setViewMode(this.mode === 'build' ? 'build' : 'tour', this.activeLevel);
      this.save();
      this.renderRightPanel(); this.renderPathPanel();
      this.closeModal();
      this.toast('记忆点已保存');
    });
    this.openModal();
    box.querySelector('#le-title').focus();
  }

  compressImage(file, cb) {
    const img = new Image();
    img.onload = () => {
      const max = 900;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      cb(cv.toDataURL('image/jpeg', 0.72));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => this.toast('图片读取失败', 'warn');
    img.src = URL.createObjectURL(file);
  }

  // ================= 内容卡片（巡游/自测） =================
  showCard(locus, opts = {}) {
    this.cardOpen = true; this.cardLocus = locus; this.cardOpts = opts;
    const order = this.palace.path.indexOf(locus.id);
    $('#cc-num').textContent = order + 1;
    $('#cc-num').className = 'locus-num st-' + locusStatus(locus);
    $('#cc-title').textContent = locus.title || '（未填写标题）';
    const img = $('#cc-img');
    if (locus.image) { img.src = locus.image; img.classList.remove('hidden'); } else img.classList.add('hidden');
    $('#cc-text').textContent = locus.body || '';
    const mn = $('#cc-mnemonic');
    if (locus.mnemonic) { $('#cc-mnemonic-text').textContent = locus.mnemonic; mn.classList.remove('hidden'); } else mn.classList.add('hidden');

    const quiz = opts.mode === 'quiz';
    $('#quiz-veil').classList.toggle('hidden', !quiz);
    $('#quiz-grade').classList.add('hidden');
    $('#cc-body').classList.toggle('hidden', quiz);
    $('#cc-title').style.visibility = quiz ? 'hidden' : 'visible';
    $('#qv-num').textContent = order + 1;
    $('#cc-foot').classList.toggle('hidden', quiz);
    $('#cc-edit').classList.toggle('hidden', this.mode !== 'build' && opts.mode !== 'view');
    $('#content-card').classList.remove('hidden');
    if (quiz) this.updateSeqUI();
  }

  revealQuiz() {
    $('#quiz-veil').classList.add('hidden');
    $('#cc-body').classList.remove('hidden');
    $('#cc-title').style.visibility = 'visible';
    $('#quiz-grade').classList.remove('hidden');
  }

  hideCard() {
    this.cardOpen = false;
    $('#content-card').classList.add('hidden');
  }

  closeCard() {
    this.hideCard();
    if (this.mode === 'walk') this.tour.beginWalk();
    else if (this.mode === 'auto' && this.tour.playing) this.tour.next();
  }

  // ================= 巡游 HUD =================
  showTourOverlay(v) { $('#tour-start-overlay').classList.toggle('hidden', !v); }
  setTouchHud(v) { $('#touch-hud').classList.toggle('hidden', !v); if (!v) $('#touch-action').classList.add('hidden'); }
  setTouchAction(icon) {
    const b = $('#touch-action');
    if (!icon) { b.classList.add('hidden'); return; }
    b.textContent = icon; b.classList.remove('hidden');
  }
  setTourPrompt(html) {
    const p = $('#tour-prompt');
    if (!html) { p.classList.add('hidden'); return; }
    p.innerHTML = html; p.classList.remove('hidden');
  }

  updateSeqUI() {
    if (this.mode === 'quiz' && this.tour.quizStats) {
      const s = this.tour.quizStats;
      $('#quiz-progress').classList.remove('hidden');
      $('#quiz-progress').innerHTML = `自测进度 <b>${Math.min(s.done + 1, s.total)}</b> / ${s.total} · ✅${s.known} 🟡${s.fuzzy} ❌${s.forgot}`;
    }
    $('#seq-play').textContent = this.tour.playing ? '⏸' : '▶';
  }

  onSeqEnd() { $('#seq-play').textContent = '▶'; }

  showQuizSummary(s) {
    const rate = s.total ? Math.round((s.known / s.total) * 100) : 0;
    const box = $('#modal-box');
    box.innerHTML = `
      <div class="modal-head"><h3>🎯 自测完成</h3><button class="btn ghost icon" data-x>✕</button></div>
      <div class="modal-body" style="text-align:center">
        <div style="font-size:44px;font-weight:700;color:var(--accent);margin:8px 0">${rate}%</div>
        <p style="color:var(--muted);margin-bottom:16px">掌握率 · 共 ${s.total} 个桩点</p>
        <div style="display:flex;justify-content:center;gap:18px;font-size:14px">
          <span>✅ 记住 ${s.known}</span><span>🟡 模糊 ${s.fuzzy}</span><span>❌ 忘记 ${s.forgot}</span>
        </div>
        <p style="color:var(--muted);font-size:12.5px;margin-top:18px">桩点颜色已更新：绿色=已掌握，黄色=模糊，橙色=待复习<br>对模糊和忘记的桩点，建议回到「漫游」模式再走一遍加深印象</p>
      </div>
      <div class="modal-foot">
        <button class="btn" data-again>再测一轮</button>
        <button class="btn primary" data-x2>回到建造</button>
      </div>`;
    box.querySelector('[data-x]').addEventListener('click', () => { this.closeModal(); this.setMode('build'); });
    box.querySelector('[data-x2]').addEventListener('click', () => { this.closeModal(); this.setMode('build'); });
    box.querySelector('[data-again]').addEventListener('click', () => { this.closeModal(); this.setMode('quiz'); });
    this.openModal();
  }

  // ================= 模态 / Toast =================
  openModal() { $('#modal-mask').classList.remove('hidden'); }
  closeModal() { $('#modal-mask').classList.add('hidden'); }

  confirm(title, desc, onOk) {
    const box = $('#modal-box');
    box.innerHTML = `
      <div class="modal-head"><h3>${title}</h3><button class="btn ghost icon" data-x>✕</button></div>
      <div class="modal-body"><p style="color:var(--muted)">${desc}</p></div>
      <div class="modal-foot"><button class="btn" data-x>取消</button><button class="btn danger" data-ok style="border-color:var(--danger)">确定</button></div>`;
    box.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => this.closeModal()));
    box.querySelector('[data-ok]').addEventListener('click', () => { this.closeModal(); onOk(); });
    this.openModal();
  }

  prompt(title, value, onOk) {
    const box = $('#modal-box');
    box.innerHTML = `
      <div class="modal-head"><h3>${title}</h3><button class="btn ghost icon" data-x>✕</button></div>
      <div class="modal-body"><div class="field"><input type="text" id="pm-input" value="${esc(value)}"></div></div>
      <div class="modal-foot"><button class="btn" data-x>取消</button><button class="btn primary" data-ok>确定</button></div>`;
    box.querySelector('[data-x]').addEventListener('click', () => this.closeModal());
    const ok = () => { this.closeModal(); onOk(box.querySelector('#pm-input').value); };
    box.querySelector('[data-ok]').addEventListener('click', ok);
    box.querySelector('#pm-input').addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    this.openModal();
    box.querySelector('#pm-input').select();
  }

  toast(msg, type = '') {
    const t = el('div', 'toast ' + type, msg);
    $('#toast-wrap').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 2400);
    setTimeout(() => t.remove(), 2900);
  }

  showHelp() {
    const box = $('#modal-box');
    box.innerHTML = `
      <div class="modal-head"><h3>🏛️ 使用指南</h3><button class="btn ghost icon" data-x>✕</button></div>
      <div class="modal-body" style="font-size:13.5px;line-height:2">
        <b>① 搭建宫殿</b><br>
        「画房间」拖拽绘制轮廓 → 自动生成墙体，相邻房间自动开门；左侧「＋」可加楼层（记得在下层放<b>楼梯</b>）。<br>
        <b>② 摆放家具</b><br>
        从家具库挑选点击放置；选中后可移动、旋转（R）、换色、复制。<br>
        <b>③ 挂载记忆</b><br>
        选中家具 →「＋添加记忆点」，一件家具可挂多个；填写标题、内容和<b>夸张联想</b>，可配图。记忆点自动串成路径（可在「路径」页调序）。<br>
        <b>④ 巡游与记忆</b><br>
        「漫游」第一人称行走（WASD+鼠标，E 查看/上下楼）；「导览」沿路径自动飞行播放；「自测」遮住内容回忆后自评，桩点颜色反映掌握度。<br>
        <b>数据安全</b><br>
        数据存于浏览器本地，请定期用 ⤓ 导出 JSON 备份。
      </div>
      <div class="modal-foot"><button class="btn primary" data-x>知道了</button></div>`;
    box.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => this.closeModal()));
    this.openModal();
  }

  // ================= 全局绑定 =================
  bindGlobal() {
    $('#btn-new').addEventListener('click', () => {
      this.prompt('给新宫殿起个名字', '我的宫殿', name => {
        const p = makePalace(name.trim() || '我的宫殿');
        this.store.palaces.unshift(p);
        this.persist();
        this.openPalace(p.id);
        this.toast('从「画房间」开始搭建你的第一层吧！');
        this.showHelp();
      });
    });
    $('#btn-sample').addEventListener('click', () => {
      const p = makeSamplePalace();
      this.store.palaces.unshift(p);
      this.persist(); this.renderHome();
      this.toast('已生成示例宫殿，点击打开看看');
    });
    $('#btn-import').addEventListener('click', () => {
      const fi = $('#file-import');
      fi.onchange = () => { if (fi.files[0]) this.importFile(fi.files[0]); fi.value = ''; };
      fi.click();
    });
    $('#btn-home').addEventListener('click', () => this.backHome());
    $('#btn-help').addEventListener('click', () => this.showHelp());
    $('#btn-export').addEventListener('click', () => this.palace && this.exportPalace(this.palace));
    $('#btn-undo').addEventListener('click', () => this.undo());
    $('#btn-redo').addEventListener('click', () => this.redo());
    document.querySelectorAll('#mode-seg button').forEach(b =>
      b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    document.querySelectorAll('.panel-tabs button').forEach(b =>
      b.addEventListener('click', () => { this.leftTab = b.dataset.tab; this.renderLeftPanel(); }));
    $('#floor-add').addEventListener('click', () => this.addFloor());
    $('#rp-close').addEventListener('click', () => this.build.setSelection(null));
    $('#btn-walk-start').addEventListener('click', () => this.tour.beginWalk());
    $('#cc-close').addEventListener('click', () => this.closeCard());
    $('#cc-ok').addEventListener('click', () => this.closeCard());
    $('#cc-edit').addEventListener('click', () => {
      const id = this.cardLocus && this.cardLocus.id;
      this.hideCard();
      if (this.mode !== 'build') this.setMode('build');
      if (id) this.openLocusEditor(id);
    });
    $('#qv-reveal').addEventListener('click', () => this.revealQuiz());
    document.querySelectorAll('#quiz-grade button').forEach(b =>
      b.addEventListener('click', () => { this.tour.grade(b.dataset.grade); this.updateSeqUI(); }));
    $('#seq-play').addEventListener('click', () => {
      if (this.tour.phase === 'idle' && !this.tour.playing) { this.tour.startSequence(false); }
      else this.tour.playing = !this.tour.playing;
      this.updateSeqUI();
    });
    $('#seq-prev').addEventListener('click', () => this.tour.prev());
    $('#seq-next').addEventListener('click', () => { if (this.tour.seq.length) this.tour.next(); });
    $('#seq-speed').addEventListener('change', e => { this.tour.dwellSec = Number(e.target.value); });
    $('#seq-loop').addEventListener('change', e => { this.tourLoop = e.target.checked; });
    $('#modal-mask').addEventListener('click', e => { if (e.target.id === 'modal-mask') this.closeModal(); });
    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.cardOpen && this.cardOpts.mode !== 'quiz') this.hideCard();
    });
  }

  handleResize() {
    if (!this.sm) return;
    this.sm.resize();
    for (const cam of [this.build.camera, this.tour.camera]) {
      cam.aspect = this.sm.canvas.clientWidth / this.sm.canvas.clientHeight;
      cam.updateProjectionMatrix();
    }
  }

  // ================= 渲染循环 =================
  startLoop() {
    this.handleResize();
    let last = performance.now();
    const loop = now => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!this.palace || $('#studio').classList.contains('hidden')) return;
      let camera;
      if (this.mode === 'build') {
        this.build.updateCamera();
        camera = this.build.camera;
      } else {
        this.tour.update(dt);
        camera = this.tour.camera;
      }
      this.sm.update(camera);
    };
    requestAnimationFrame(loop);
  }
}

new App();
