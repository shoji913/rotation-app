// ===== メイン =====
import './style.css';
import type { Staff, Zone } from './types';
import { loadAllData, saveAllData, getAllDataForBackup } from './storage';
import { CONFIG, SLOTS, slotToTime, timeStrToSlot, getMonday, addDays, fmtDate, isToday, shiftKey } from './timeUtils';
import { calcCostForDays, getZoneEntry } from './costCalc';

// ===== 定数 =====
const DAYS_JP = ['日', '月', '火', '水', '木', '金', '土'];
const COLORS = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
const COLOR_HEX = ['#2d5a3d', '#1a3a6a', '#6a3c10', '#6a1a1a', '#3a1a6a', '#1a4a4a', '#5a4010', '#6a1a50', '#2a4a1a'];
const ZONE_COLORS = ['#e07b3a', '#e0a23a', '#3a8be0', '#3ab8e0', '#7b3ae0', '#1a5a3a'];

// ===== 状態管理 =====
let weekOff = 0;
let { staff, shifts, zones, zoneAssign, allowanceSetting } = loadAllData();
let modalMode: 'add' | 'edit' = 'add';
let modalCtx: any = null;
let ctxCtx: any = null;
let staffEditIdx = -1;
let pickerKey: string | null = null;
let _isPrinting = false;
let currentConflicts: { shifts: Set<string>; zones: Set<string> } = { shifts: new Set(), zones: new Set() };

function getCW(): number { return _isPrinting ? 21 : 36; }

function save() {
  saveAllData(staff, shifts, zones, zoneAssign, allowanceSetting);
}

// ===== 競合チェック =====
function getConflicts(dateStr: string) {
  const conflicts = { shifts: new Set<string>(), zones: new Set<string>() };
  staff.forEach(st => {
    const intervals: { type: string; id: string; start: number; end: number }[] = [];
    (shifts[shiftKey(st.id, dateStr)] || []).forEach((sh, idx) => {
      intervals.push({ type: 'shift', id: st.id + '_' + idx, start: sh.start, end: sh.end });
    });
    zones.forEach((zone, zi) => {
      const rawStart = timeStrToSlot(zone.start);
      const rawEnd = timeStrToSlot(zone.end);
      if (rawEnd <= rawStart) return;
      const zoneSlots = zone.slots || 1;
      for (let si = 0; si < zoneSlots; si++) {
        const zaKey = `${zi}_${dateStr}_${si}`;
        const entry = getZoneEntry(zoneAssign, zaKey);
        if (entry && entry.staffId === st.id) {
          intervals.push({ type: 'zone', id: zaKey, start: rawStart, end: rawEnd });
        }
      }
    });
    intervals.sort((a, b) => a.start - b.start);
    for (let i = 0; i < intervals.length - 1; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        if (intervals[j].start < intervals[i].end) {
          if (intervals[i].type === 'shift') conflicts.shifts.add(intervals[i].id);
          if (intervals[i].type === 'zone') conflicts.zones.add(intervals[i].id);
          if (intervals[j].type === 'shift') conflicts.shifts.add(intervals[j].id);
          if (intervals[j].type === 'zone') conflicts.zones.add(intervals[j].id);
        }
      }
    }
  });
  return conflicts;
}

function checkWeekConflicts() {
  const mon = getMonday(weekOff);
  let hasConflict = false;
  for (let di = 0; di < 7; di++) {
    const ds = fmtDate(addDays(mon, di));
    const c = getConflicts(ds);
    if (c.shifts.size > 0 || c.zones.size > 0) hasConflict = true;
  }
  let banner = document.getElementById('conflictBanner');
  if (hasConflict) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'conflictBanner';
      banner.style.cssText = 'background:#ffebee;color:#c62828;padding:8px 16px;font-size:13px;font-weight:bold;text-align:center;border-bottom:1px solid #ef9a9a;z-index:200;position:sticky;top:0;';
      banner.innerHTML = '⚠️ 【警告】同じ時間帯にシフトが重複しているスタッフがいます！赤く点滅している箇所を修正してください。';
      document.body.insertBefore(banner, document.body.firstChild);
    }
  } else {
    if (banner) banner.remove();
  }
}

// ===== レーンパッキング =====
function getLanePacking(dateStr: string, numLanes: number) {
  const lanes: { staffId: string; shiftIdx: number; start: number; end: number }[][] =
    Array.from({ length: numLanes }, () => []);
  const all: { staffId: string; shiftIdx: number; start: number; end: number }[] = [];
  staff.forEach(st => {
    (shifts[shiftKey(st.id, dateStr)] || []).forEach((sh, idx) => {
      all.push({ staffId: st.id, shiftIdx: idx, start: sh.start, end: sh.end });
    });
  });
  all.sort((a, b) => a.start - b.start);
  all.forEach(item => {
    for (let l = 0; l < numLanes; l++) {
      const last = lanes[l][lanes[l].length - 1];
      if (!last || last.end <= item.start) { lanes[l].push(item); break; }
    }
  });
  return lanes;
}

// ===== 描画 =====
function render() {
  renderTimeHeader();
  renderDayRows();
  const flatEl = document.getElementById('allowanceFlat') as HTMLInputElement;
  const pctEl = document.getElementById('allowancePct') as HTMLInputElement;
  if (flatEl) flatEl.value = String(allowanceSetting.flat || 0);
  if (pctEl) pctEl.value = String(allowanceSetting.pct || 0);
  renderSidebar();
  renderCosts();
  renderZoneSettings();
  const mon = getMonday(weekOff);
  const sun = addDays(mon, 6);
  const lbl = document.getElementById('weekLbl');
  if (lbl) lbl.textContent = `${mon.getMonth() + 1}/${mon.getDate()}（日）〜 ${sun.getMonth() + 1}/${sun.getDate()}（土）`;
  checkWeekConflicts();
}

function renderTimeHeader() {
  const tc = document.getElementById('timeSlots');
  if (!tc) return;
  const cw = getCW();
  tc.innerHTML = '';
  tc.style.cssText = `position:relative;width:${CONFIG.DISPLAY_SLOTS * cw}px;height:36px;flex-shrink:0;display:block;`;
  for (let s = 0; s < CONFIG.DISPLAY_SLOTS; s++) {
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${s * cw}px;width:${cw}px;height:36px;border-right:1px solid ${s % 2 === 0 ? 'var(--border2)' : 'var(--border)'};display:flex;align-items:flex-end;padding-bottom:4px;padding-left:3px;box-sizing:border-box;`;
    if (s % 2 === 0) d.innerHTML = `<span style="font-size:11px;font-weight:600;color:var(--text2);">${s / 2}</span>`;
    else d.innerHTML = `<span style="font-size:8px;color:var(--text3);">30</span>`;
    tc.appendChild(d);
  }
}

function renderDayRows() {
  const container = document.getElementById('dayRows');
  if (!container) return;
  container.innerHTML = '';
  const mon = getMonday(weekOff);
  for (let di = 0; di < 7; di++) {
    const date = addDays(mon, di);
    const ds = fmtDate(date);
    currentConflicts = getConflicts(ds);
    const block = document.createElement('div');
    block.className = 'day-block';
    const headRow = document.createElement('div');
    headRow.className = 'day-head-row';
    const headLbl = document.createElement('div');
    headLbl.className = 'day-head-lbl' + (di === 6 ? ' sat' : di === 0 ? ' sun' : '') + (isToday(date) ? ' today' : '');
    headLbl.innerHTML = `<span class="day-num">${date.getDate()}</span><span class="day-wday">（${DAYS_JP[di]}）</span>`;
    headRow.appendChild(headLbl);
    const cwH = getCW();
    const headBg = document.createElement('div');
headBg.style.cssText = `position:relative;width:${CONFIG.DISPLAY_SLOTS * cwH}px;min-width:${CONFIG.DISPLAY_SLOTS * cwH}px;flex-shrink:0;height:var(--day-head-h);overflow:hidden;`;

for (let s = 0; s < CONFIG.DISPLAY_SLOTS; s++) {
  const line = document.createElement('div');
  line.style.cssText = `position:absolute;left:${s * cwH}px;width:${cwH}px;top:0;bottom:0;border-right:1px solid ${s % 2 === 0 ? 'var(--border2)' : 'var(--border)'};box-sizing:border-box;`;
  if (s % 2 === 0) {
    const timeLabel = document.createElement('span');
    timeLabel.style.cssText = 'position:absolute;bottom:2px;left:2px;font-size:9px;font-weight:600;color:var(--text3);';
    timeLabel.textContent = String(s / 2);
    line.appendChild(timeLabel);
  }
  headBg.appendChild(line);
}
    headRow.appendChild(headBg);
    block.appendChild(headRow);
    const allLanes = getLanePacking(ds, 3);
    const lanes = [[], [], allLanes[0].concat(allLanes[1]).concat(allLanes[2])] as typeof allLanes;
    for (let lane = 0; lane < 3; lane++) {
      block.appendChild(buildLaneRow(lane, lanes[lane], ds));
    }
    container.appendChild(block);
  }
}

function buildLaneRow(lane: number, laneItems: { staffId: string; shiftIdx: number; start: number; end: number }[], dateStr: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'lane-row';
  const lbl = document.createElement('div');
  lbl.className = 'lane-label';
  row.appendChild(lbl);
  const cw = getCW();
  const tl = document.createElement('div');
  tl.className = 'lane-tl';
  tl.style.width = `${CONFIG.DISPLAY_SLOTS * cw}px`;
  tl.style.minWidth = `${CONFIG.DISPLAY_SLOTS * cw}px`;
  const grid = document.createElement('div');
  grid.className = 'lane-grid';
  for (let s = 0; s < CONFIG.DISPLAY_SLOTS; s++) {
    const line = document.createElement('div');
    line.style.cssText = `position:absolute;left:${s * cw}px;width:${cw}px;top:0;bottom:0;border-right:1px solid ${s % 2 === 0 ? 'var(--border2)' : 'var(--border)'};box-sizing:border-box;`;
    grid.appendChild(line);
  }
  tl.appendChild(grid);

  function getZoneDisplay(zone: Zone) {
    const rawStart = timeStrToSlot(zone.start);
    const rawEnd = timeStrToSlot(zone.end);
    let cs: number, ce: number;
    if (rawStart >= SLOTS) { cs = rawStart - SLOTS; ce = rawEnd - SLOTS; }
    else if (rawEnd > SLOTS) { cs = rawStart; ce = SLOTS; }
    else { cs = rawStart; ce = rawEnd; }
    if (ce <= cs || cs >= CONFIG.DISPLAY_SLOTS || ce <= 0) return null;
    return { cs: Math.max(0, cs), ce: Math.min(CONFIG.DISPLAY_SLOTS, ce) };
  }

  const zoneDisplays = zones.map(z => getZoneDisplay(z));
  const laneOffsets = zones.map((_zone, zi) => {
    const d = zoneDisplays[zi];
    if (!d) return 0;
    let offset = 0;
    for (let pi = 0; pi < zi; pi++) {
      const pd = zoneDisplays[pi];
      if (!pd) continue;
      if (pd.cs < d.ce && pd.ce > d.cs) offset += zones[pi].slots || 1;
    }
    return offset;
  });

  zones.forEach((zone, zi) => {
    const d = zoneDisplays[zi];
    if (!d) return;
    const zoneSlots = zone.slots || 1;
    const offset = laneOffsets[zi];
    if (lane < offset || lane >= offset + zoneSlots) return;
    const color = ZONE_COLORS[zi % ZONE_COLORS.length];
    const { cs, ce } = d;
    const slotInZone = lane - offset;
    const zaKey = `${zi}_${dateStr}_${slotInZone}`;
    const zoneEntry = getZoneEntry(zoneAssign, zaKey);
    const assignedStaff = zoneEntry ? staff.find(s => s.id === zoneEntry.staffId) : null;
    const hasAllowance = zoneEntry ? zoneEntry.allowance : false;
    const isConflict = currentConflicts.zones.has(zaKey);
    const hl = document.createElement('div');
    hl.style.cssText = `position:absolute;top:0;bottom:0;left:${cs * cw}px;width:${(ce - cs) * cw}px;background:${color};opacity:0.05;pointer-events:none;`;
    tl.appendChild(hl);
    const cellLeft = cs * cw + 2;
    const cellW = Math.max((ce - cs) * cw - 4, 20);
    const cell = document.createElement('div');
    if (assignedStaff) {
      const sc = COLOR_HEX[COLORS.indexOf(assignedStaff.color) % COLOR_HEX.length];
      cell.style.cssText = `position:absolute;top:4px;bottom:4px;left:${cellLeft}px;width:${cellW}px;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:3;box-sizing:border-box;overflow:hidden;white-space:nowrap;padding:0 4px;font-weight:600;font-size:11px;background:${sc}28;border:1.5px solid ${sc}88;color:${sc};`;
      cell.innerHTML = (hasAllowance ? '<span style="font-size:9px;margin-right:2px;">★</span>' : '') + assignedStaff.name;
      if (isConflict) cell.classList.add('conflict-anim');
    } else {
      cell.style.cssText = `position:absolute;top:4px;bottom:4px;left:${cellLeft}px;width:${cellW}px;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:3;box-sizing:border-box;overflow:hidden;white-space:nowrap;padding:0 4px;font-size:10px;border:1.5px dashed ${color}55;color:${color};opacity:0.6;`;
      cell.textContent = '+';
    }
    cell.addEventListener('mouseenter', () => {
      cell.style.opacity = '1';
      if (!assignedStaff) cell.style.background = color + '18';
    });
    cell.addEventListener('mouseleave', () => {
      if (assignedStaff) {
        if (!isConflict) cell.style.background = COLOR_HEX[COLORS.indexOf(assignedStaff.color) % COLOR_HEX.length] + '28';
      } else {
        cell.style.opacity = '0.6';
        cell.style.background = '';
      }
    });
    cell.addEventListener('click', e => { e.stopPropagation(); openStaffPicker(e, zaKey, color); });
    tl.appendChild(cell);
  });

  // 前日の深夜ゾーン描画
  const prevDate = addDays(new Date(dateStr.replace(/-/g, '/')), -1);
  const prevDs = fmtDate(prevDate);
  zones.forEach((zone, zi) => {
    const rawEnd = timeStrToSlot(zone.end);
    if (rawEnd <= SLOTS) return;
    const zoneSlots = zone.slots || 1;
    const offset = laneOffsets[zi];
    if (lane < offset || lane >= offset + zoneSlots) return;
    const slotInZone = lane - offset;
    const ce = Math.min(rawEnd - SLOTS, CONFIG.DISPLAY_SLOTS);
    if (ce <= 0) return;
    const color = ZONE_COLORS[zi % ZONE_COLORS.length];
    const zaKey = `${zi}_${prevDs}_${slotInZone}`;
    const zoneEntry = getZoneEntry(zoneAssign, zaKey);
    const assignedStaff = zoneEntry ? staff.find(s => s.id === zoneEntry.staffId) : null;
    const isConflict = currentConflicts.zones.has(zaKey);
    const hl = document.createElement('div');
    hl.style.cssText = `position:absolute;top:0;bottom:0;left:0px;width:${ce * cw}px;background:${color};opacity:0.05;pointer-events:none;`;
    tl.appendChild(hl);
    const cellW = Math.max(ce * cw - 4, 4);
    const cell = document.createElement('div');
    if (assignedStaff) {
      const sc = COLOR_HEX[COLORS.indexOf(assignedStaff.color) % COLOR_HEX.length];
      cell.style.cssText = `position:absolute;top:4px;bottom:4px;left:2px;width:${cellW}px;border-radius:4px;display:flex;align-items:center;justify-content:center;z-index:3;box-sizing:border-box;overflow:hidden;white-space:nowrap;padding:0 4px;font-weight:600;font-size:11px;cursor:default;background:${sc}28;border:1.5px solid ${sc}88;color:${sc};`;
      cell.textContent = assignedStaff.name;
      if (isConflict) cell.classList.add('conflict-anim');
    } else {
      cell.style.cssText = `position:absolute;top:4px;bottom:4px;left:2px;width:${cellW}px;border-radius:4px;z-index:3;box-sizing:border-box;border:1.5px dashed ${color}22;opacity:0.3;cursor:default;`;
    }
    tl.appendChild(cell);
  });

  const dz = document.createElement('div');
  dz.className = 'lane-drop';
  dz.addEventListener('click', e => {
    if (e.target !== dz) return;
    if (lane !== 2) return;
    const slot = Math.floor((e as MouseEvent).offsetX / getCW());
    openModal('add', { dateStr, lane, slot });
  });
  tl.appendChild(dz);

  if (lane === 2) {
    laneItems.forEach(item => {
      const st = staff.find(s => s.id === item.staffId);
      if (!st) return;
      tl.appendChild(buildShiftBlock(item, st, dateStr));
    });
  }

  row.appendChild(tl);
  return row;
}

function buildShiftBlock(item: { staffId: string; shiftIdx: number; start: number; end: number }, st: Staff, dateStr: string): HTMLElement {
  const sh = (shifts[shiftKey(st.id, dateStr)] || [])[item.shiftIdx];
  if (!sh) return document.createElement('div');
  if (sh.start >= CONFIG.DISPLAY_SLOTS) return document.createElement('div');
  const cws = getCW();
  const left = sh.start * cws;
  const endSlot = Math.min(sh.end, CONFIG.DISPLAY_SLOTS);
  const width = Math.max((endSlot - sh.start) * cws, cws);
  const block = document.createElement('div');
  block.className = 'shift-block ' + st.color;
  block.style.left = left + 'px';
  block.style.width = width + 'px';
  const isConflict = currentConflicts.shifts.has(st.id + '_' + item.shiftIdx);
  if (isConflict) block.classList.add('conflict-anim');
  const nameSpan = document.createElement('span');
  nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
  nameSpan.textContent = st.name;
  block.appendChild(nameSpan);
  if (width >= 90) {
    const timeSpan = document.createElement('span');
    timeSpan.style.cssText = 'font-size:9px;opacity:0.65;font-weight:400;flex-shrink:0;';
    timeSpan.textContent = `${slotToTime(sh.start)}–${slotToTime(sh.end)}`;
    block.appendChild(timeSpan);
  }
  const rL = document.createElement('div');
  rL.className = 'rh L';
  setupResize(rL, 'L', st.id, dateStr, item.shiftIdx);
  block.appendChild(rL);
  const rR = document.createElement('div');
  rR.className = 'rh R';
  setupResize(rR, 'R', st.id, dateStr, item.shiftIdx);
  block.appendChild(rR);
  block.addEventListener('click', e => {
    if (e.target === rL || e.target === rR) return;
    openModal('edit', { staffId: st.id, dateStr, shiftIdx: item.shiftIdx });
  });
  block.addEventListener('contextmenu', e => {
    e.preventDefault();
    showCtx(e as MouseEvent, st.id, dateStr, item.shiftIdx);
  });
  return block;
}

function setupResize(handle: HTMLElement, side: 'L' | 'R', staffId: string, dateStr: string, idx: number) {
  handle.addEventListener('mousedown', e => {
    e.stopPropagation(); e.preventDefault();
    const startX = (e as MouseEvent).clientX;
    const key = shiftKey(staffId, dateStr);
    const orig = { ...shifts[key][idx] };
    const onMove = (ev: MouseEvent) => {
      const dSlots = Math.round((ev.clientX - startX) / getCW());
      if (side === 'R') shifts[key][idx].end = Math.max(orig.start + 1, Math.min(SLOTS, orig.end + dSlots));
      else shifts[key][idx].start = Math.max(0, Math.min(orig.end - 1, orig.start + dSlots));
      save(); renderDayRows(); renderCosts(); checkWeekConflicts();
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove as EventListener);
    document.addEventListener('mouseup', onUp);
  });
}

// ===== サイドバー =====
function renderSidebar() {
  const list = document.getElementById('staffList');
  if (!list) return;
  list.innerHTML = '';
  staff.forEach((st, i) => {
    const hex = COLOR_HEX[COLORS.indexOf(st.color) % COLOR_HEX.length];
    const div = document.createElement('div');
    div.className = 'staff-item';
    div.innerHTML = `
      <div class="sdot" style="background:${hex}"></div>
      <span class="sname">${st.name}</span>
      <span class="swage">${st.wage ? '¥' + st.wage + '/h' : '-'}</span>
      <button class="sedit" data-idx="${i}">✏</button>
      <button class="sdel" data-idx="${i}">✕</button>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll('.sedit').forEach(btn => {
    btn.addEventListener('click', () => editStaff(parseInt((btn as HTMLElement).dataset.idx || '0')));
  });
  list.querySelectorAll('.sdel').forEach(btn => {
    btn.addEventListener('click', () => removeStaff(parseInt((btn as HTMLElement).dataset.idx || '0')));
  });
  const sel = document.getElementById('mStaff') as HTMLSelectElement;
  if (sel) sel.innerHTML = staff.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

function renderCosts() {
  const mon = getMonday(weekOff);
  const weekDays = Array.from({ length: 7 }, (_, i) => fmtDate(addDays(mon, i)));
  const monthYear = mon.getFullYear();
  const monthMonth = mon.getMonth();
  const daysInMonth = new Date(monthYear, monthMonth + 1, 0).getDate();
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => fmtDate(new Date(monthYear, monthMonth, i + 1)));
  let total = 0, monthTotal = 0;
  const items = staff.map(st => {
    const w = calcCostForDays(st, weekDays, shifts, zones, zoneAssign, allowanceSetting);
    const m = calcCostForDays(st, monthDays, shifts, zones, zoneAssign, allowanceSetting);
    total += w.cost;
    monthTotal += m.cost;
    return { st, ...w, monthCost: m.cost };
  });
  const panel = document.getElementById('costPanel');
  if (!panel) return;
  const monthLabel = `${mon.getMonth() + 1}月`;
  panel.innerHTML = `
    <div class="cost-total">¥${monthTotal.toLocaleString()}<small> / ${monthLabel}</small></div>
    <div style="text-align:center;font-size:13px;color:var(--text3);margin-bottom:8px;">¥${total.toLocaleString()} <small>/ 週</small></div>
  `;
  items.forEach(({ st, totalH, nightH, breakH, cost }) => {
    if (totalH === 0 && cost === 0) return;
    const hex = COLOR_HEX[COLORS.indexOf(st.color) % COLOR_HEX.length];
    const breakStr = breakH > 0 ? `<span class="ci-break">-${Math.round(breakH * 10) / 10}h休憩</span>` : '';
    const nightStr = nightH > 0 ? `<span class="ci-break" style="color:#1a3a6a;">深夜${Math.round(nightH * 10) / 10}h</span>` : '';
    const div = document.createElement('div');
    div.className = 'cost-item';
    div.innerHTML = `
      <div class="sdot" style="background:${hex}"></div>
      <span class="ci-name">${st.name}</span>
      <span class="ci-h">${Math.round(totalH * 10) / 10}h${breakStr}${nightStr}</span>
      <span class="ci-yen">¥${cost.toLocaleString()}</span>
    `;
    panel.appendChild(div);
  });
}

function renderZoneSettings() {
  const panel = document.getElementById('zoneSettingPanel');
  if (!panel) return;
  panel.innerHTML = '';
  zones.forEach((zone, zi) => {
    const color = ZONE_COLORS[zi % ZONE_COLORS.length];
    const item = document.createElement('div');
    item.className = 'zone-setting-item';
    item.innerHTML = `
      <div class="zone-setting-head">
        <div class="zone-cdot" style="background:${color}"></div>
        <input class="zfi" style="flex:1;" type="text" value="${zone.name}" placeholder="時間帯名" data-zi="${zi}" data-field="name" />
      </div>
      <div class="zone-setting-row">
        <span>開始</span>
        <input class="zfi" type="text" placeholder="例:21:00" value="${zone.start}" data-zi="${zi}" data-field="start" />
        <span>終了</span>
        <input class="zfi" type="text" placeholder="例:30:00" value="${zone.end}" data-zi="${zi}" data-field="end" />
      </div>
      <div class="zone-setting-row">
        <span>枠数</span>
        <input class="zfi zfi-slots" type="number" min="1" max="10" value="${zone.slots || 1}" data-zi="${zi}" data-field="slots" />
        <span>枠</span>
      </div>
    `;
    item.querySelectorAll('input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.zi || '0');
        const field = input.dataset.field as keyof Zone;
        if (field === 'slots') (zones[idx] as any)[field] = parseInt(input.value) || 1;
        else (zones[idx] as any)[field] = input.value;
        save(); render();
      });
    });
    panel.appendChild(item);
  });
}

// ===== モーダル =====
function buildTimeOpts(): string {
  return Array.from({ length: SLOTS + 1 }, (_, s) => `<option value="${s}">${slotToTime(s)}</option>`).join('');
}

function openModal(mode: 'add' | 'edit', ctx: any) {
  modalMode = mode; modalCtx = ctx;
  const title = document.getElementById('modalTitle');
  const delBtn = document.getElementById('mDelBtn');
  const startSel = document.getElementById('mStart') as HTMLSelectElement;
  const endSel = document.getElementById('mEnd') as HTMLSelectElement;
  const staffSel = document.getElementById('mStaff') as HTMLSelectElement;
  if (title) title.textContent = mode === 'add' ? 'シフトを追加' : 'シフトを編集';
  if (delBtn) delBtn.style.display = mode === 'edit' ? '' : 'none';
  if (startSel) startSel.innerHTML = buildTimeOpts();
  if (endSel) endSel.innerHTML = buildTimeOpts();
  if (mode === 'add') {
    if (staffSel) staffSel.disabled = false;
    const slot = Math.min(ctx.slot || 16, SLOTS - 4);
    if (startSel) startSel.value = String(slot);
    if (endSel) endSel.value = String(Math.min(slot + 8, SLOTS));
  } else {
    if (staffSel) { staffSel.value = ctx.staffId; staffSel.disabled = true; }
    const sh = (shifts[shiftKey(ctx.staffId, ctx.dateStr)] || [])[ctx.shiftIdx];
    if (sh) { if (startSel) startSel.value = String(sh.start); if (endSel) endSel.value = String(sh.end); }
  }
  document.getElementById('overlay')?.classList.add('open');
}

function closeModal() { document.getElementById('overlay')?.classList.remove('open'); }

function modalSave() {
  const staffSel = document.getElementById('mStaff') as HTMLSelectElement;
  const startSel = document.getElementById('mStart') as HTMLSelectElement;
  const endSel = document.getElementById('mEnd') as HTMLSelectElement;
  const staffId = modalMode === 'add' ? staffSel.value : modalCtx.staffId;
  const ds = modalCtx.dateStr;
  const start = parseInt(startSel.value);
  const end = parseInt(endSel.value);
  if (end <= start) { alert('終了時刻は開始時刻より後にしてください'); return; }
  const key = shiftKey(staffId, ds);
  if (!shifts[key]) shifts[key] = [];
  if (modalMode === 'add') shifts[key].push({ start, end });
  else shifts[key][modalCtx.shiftIdx] = { start, end };
  save(); render(); closeModal();
}

function modalDel() {
  const key = shiftKey(modalCtx.staffId, modalCtx.dateStr);
  shifts[key].splice(modalCtx.shiftIdx, 1);
  save(); render(); closeModal();
}

// ===== 右クリックメニュー =====
function showCtx(e: MouseEvent, staffId: string, dateStr: string, shiftIdx: number) {
  ctxCtx = { staffId, dateStr, shiftIdx };
  const m = document.getElementById('ctxmenu');
  if (!m) return;
  m.style.display = 'block';
  m.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  m.style.top = Math.min(e.clientY, window.innerHeight - 80) + 'px';
}
function hideCtx() { const m = document.getElementById('ctxmenu'); if (m) m.style.display = 'none'; }

// ===== スタッフ操作 =====
function addStaff() {
  const nameEl = document.getElementById('newName') as HTMLInputElement;
  const wageEl = document.getElementById('newWage') as HTMLInputElement;
  const name = nameEl.value.trim();
  const wage = parseInt(wageEl.value) || 0;
  if (!name) return;
  const id = 's' + Date.now();
  const color = COLORS[staff.length % COLORS.length];
  staff.push({ id, name, wage, color });
  nameEl.value = ''; wageEl.value = '';
  save(); render();
}

function removeStaff(i: number) {
  if (!confirm(`「${staff[i].name}」を削除しますか？`)) return;
  const sid = staff[i].id;
  staff.splice(i, 1);
  Object.keys(shifts).forEach(k => { if (k.startsWith(sid + '_')) delete shifts[k]; });
  save(); render();
}

function editStaff(i: number) {
  staffEditIdx = i;
  const st = staff[i];
  (document.getElementById('seNameInput') as HTMLInputElement).value = st.name;
  (document.getElementById('seWageInput') as HTMLInputElement).value = String(st.wage || '');
  document.getElementById('staffEditOverlay')?.classList.add('open');
  setTimeout(() => (document.getElementById('seNameInput') as HTMLInputElement).focus(), 50);
}

function closeStaffEdit() { document.getElementById('staffEditOverlay')?.classList.remove('open'); }

function saveStaffEdit() {
  const name = (document.getElementById('seNameInput') as HTMLInputElement).value.trim();
  const wage = parseInt((document.getElementById('seWageInput') as HTMLInputElement).value) || 0;
  if (!name) { alert('名前を入力してください'); return; }
  staff[staffEditIdx].name = name;
  staff[staffEditIdx].wage = wage;
  save(); render(); closeStaffEdit();
}

// ===== スタッフピッカー =====
function openStaffPicker(e: Event, zaKey: string, _color: string) {
  pickerKey = zaKey;
  const picker = document.getElementById('staffPicker');
  const list = document.getElementById('pickerList');
  if (!picker || !list) return;
  list.innerHTML = '';
  const cur = getZoneEntry(zoneAssign, zaKey);
  staff.forEach(st => {
    const hex = COLOR_HEX[COLORS.indexOf(st.color) % COLOR_HEX.length];
    const isSelected = cur && cur.staffId === st.id;
    const item = document.createElement('div');
    item.style.cssText = `padding:7px 12px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:8px;${isSelected ? 'background:var(--surface2);' : ''}`;
    item.innerHTML = `<div style="width:8px;height:8px;border-radius:50%;background:${hex};flex-shrink:0;"></div><span style="flex:1;">${st.name}</span>${isSelected ? '<span style="font-size:10px;color:var(--text3);">✓</span>' : ''}`;
    item.addEventListener('mouseenter', () => item.style.background = 'var(--surface2)');
    item.addEventListener('mouseleave', () => item.style.background = isSelected ? 'var(--surface2)' : '');
    item.addEventListener('click', ev => {
      ev.stopPropagation();
      const curEntry = getZoneEntry(zoneAssign, zaKey);
      const curAllowance = curEntry ? curEntry.allowance : false;
      if (!zoneAssign[zaKey]) zoneAssign[zaKey] = { staffId: st.id, allowance: curAllowance };
      else zoneAssign[zaKey] = { staffId: st.id, allowance: curAllowance };
      closeStaffPicker(); save(); render();
    });
    list.appendChild(item);
  });

  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:var(--border);margin:2px 0;';
  list.appendChild(sep);

  const allowanceRow = document.createElement('div');
  const hasAllowance = cur ? cur.allowance : false;
  allowanceRow.style.cssText = 'padding:7px 12px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:8px;';
  allowanceRow.innerHTML = `<span style="font-size:14px;">${hasAllowance ? '★' : '☆'}</span><span style="flex:1;">手当あり</span><span style="font-size:10px;color:var(--text3);">${allowanceSetting.flat > 0 || allowanceSetting.pct > 0 ? '+¥' + allowanceSetting.flat + (allowanceSetting.pct > 0 ? '/+' + allowanceSetting.pct + '%' : '') : '未設定'}</span>`;
  allowanceRow.addEventListener('mouseenter', () => allowanceRow.style.background = 'var(--surface2)');
  allowanceRow.addEventListener('mouseleave', () => allowanceRow.style.background = '');
  allowanceRow.addEventListener('click', ev => {
    ev.stopPropagation();
    const curEntry = getZoneEntry(zoneAssign, zaKey);
    if (!curEntry) return;
    zoneAssign[zaKey] = { staffId: curEntry.staffId, allowance: !curEntry.allowance };
    save(); render();
    const newAllowance = getZoneEntry(zoneAssign, zaKey)?.allowance;
    allowanceRow.innerHTML = `<span style="font-size:14px;">${newAllowance ? '★' : '☆'}</span><span style="flex:1;">手当あり</span>`;
  });
  list.appendChild(allowanceRow);

  const clearBtn = document.getElementById('pickerClear');
  if (clearBtn) {
    clearBtn.onclick = ev => {
      (ev as Event).stopPropagation();
      delete zoneAssign[zaKey];
      closeStaffPicker(); save(); render();
    };
  }

  picker.style.display = 'block';
  const target = e.target as HTMLElement;
  const rect = target.getBoundingClientRect();
  const pw = 180;
  const left = Math.min(rect.left, window.innerWidth - pw - 8);
  picker.style.left = left + 'px';
  picker.style.top = (rect.bottom + 4) + 'px';
}

function closeStaffPicker() {
  const picker = document.getElementById('staffPicker');
  if (picker) picker.style.display = 'none';
  pickerKey = null;
}

// ===== パネル開閉 =====
function togglePanel(headEl: HTMLElement) {
  const body = headEl.nextElementSibling as HTMLElement;
  const toggle = headEl.querySelector('.panel-toggle') as HTMLElement;
  if (!body) return;
  body.classList.toggle('collapsed');
  if (toggle) toggle.classList.toggle('open');
}

// ===== バックアップ =====
function downloadJSON(fname: string, data: object) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fname; a.click();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  downloadJSON(`rotation_${ts}.json`, getAllDataForBackup(staff, shifts, zones, zoneAssign, allowanceSetting));
}

function resetAllData() {
  if (!confirm('全データをリセットしますか？この操作は元に戻せません。')) return;
  ['rv3_staff', 'rv3_shifts', 'rv3_zones', 'rv3_zassign', 'rv3_allowance', 'rv3_lastBackup'].forEach(k => localStorage.removeItem(k));
  const loaded = loadAllData();
  staff = loaded.staff; shifts = loaded.shifts; zones = loaded.zones;
  zoneAssign = loaded.zoneAssign; allowanceSetting = loaded.allowanceSetting;
  save(); render();
}

function importBackup(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse((e.target as FileReader).result as string);
      if (data.staff) staff = data.staff;
      if (data.shifts) shifts = data.shifts;
      if (data.zones) zones = data.zones;
      if (data.zoneAssign) zoneAssign = data.zoneAssign;
      if (data.allowanceSetting) allowanceSetting = data.allowanceSetting;
      save(); render(); alert('読み込みました！');
    } catch { alert('ファイルの読み込みに失敗しました'); }
  };
  reader.readAsText(file);
  (event.target as HTMLInputElement).value = '';
}

// ===== サイレントバックアップ =====
function runSilentBackup() {
  const now = Date.now();
  const last = parseInt(localStorage.getItem('rv3_lastBackup') || '0');
  if (now - last > 60 * 60 * 1000) {
    localStorage.setItem('rv3_snapshot', JSON.stringify(getAllDataForBackup(staff, shifts, zones, zoneAssign, allowanceSetting)));
    localStorage.setItem('rv3_lastBackup', now.toString());
  }
}

// ===== 印刷 =====
window.addEventListener('beforeprint', () => {
  _isPrinting = true;
  const sidebar = document.getElementById('sidebar');
  const topbar = document.querySelector('.topbar') as HTMLElement;
  if (sidebar) sidebar.style.display = 'none';
  if (topbar) topbar.style.display = 'none';
  renderTimeHeader(); renderDayRows();
});
window.addEventListener('afterprint', () => {
  _isPrinting = false;
  const sidebar = document.getElementById('sidebar');
  const topbar = document.querySelector('.topbar') as HTMLElement;
  if (sidebar) sidebar.style.display = 'flex';
  if (topbar) topbar.style.display = 'flex';
  renderTimeHeader(); renderDayRows();
});

// ===== イベント登録 =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('prevWeek')?.addEventListener('click', () => { weekOff--; render(); });
  document.getElementById('nextWeek')?.addEventListener('click', () => { weekOff++; render(); });
  document.getElementById('todayBtn')?.addEventListener('click', () => { weekOff = 0; render(); });
  document.getElementById('printBtn')?.addEventListener('click', () => window.print());
  document.getElementById('addStaffBtn')?.addEventListener('click', addStaff);
  document.getElementById('bulkWageBtn')?.addEventListener('click', () => {
    (document.getElementById('bulkWageInput') as HTMLInputElement).value = '';
    document.getElementById('bulkOverlay')?.classList.add('open');
    setTimeout(() => (document.getElementById('bulkWageInput') as HTMLInputElement).focus(), 50);
  });
  document.getElementById('bulkCancel')?.addEventListener('click', () => document.getElementById('bulkOverlay')?.classList.remove('open'));
  document.getElementById('bulkSave')?.addEventListener('click', () => {
    const val = parseInt((document.getElementById('bulkWageInput') as HTMLInputElement).value);
    if (!val || val <= 0) { alert('正しい金額を入力してください'); return; }
    staff.forEach(st => st.wage = val);
    save(); render();
    document.getElementById('bulkOverlay')?.classList.remove('open');
  });
  document.getElementById('staffEditCancel')?.addEventListener('click', closeStaffEdit);
  document.getElementById('staffEditSave')?.addEventListener('click', saveStaffEdit);
  document.getElementById('modalCancel')?.addEventListener('click', closeModal);
  document.getElementById('modalSave')?.addEventListener('click', modalSave);
  document.getElementById('mDelBtn')?.addEventListener('click', modalDel);
  document.getElementById('ctxEdit')?.addEventListener('click', () => { hideCtx(); openModal('edit', ctxCtx); });
  document.getElementById('ctxDel')?.addEventListener('click', () => { hideCtx(); const key = shiftKey(ctxCtx.staffId, ctxCtx.dateStr); shifts[key].splice(ctxCtx.shiftIdx, 1); save(); render(); });
  document.getElementById('resetBtn')?.addEventListener('click', resetAllData);
  document.getElementById('exportBtn')?.addEventListener('click', exportBackup);
  document.getElementById('importFile')?.addEventListener('change', importBackup);
  document.getElementById('allowanceFlat')?.addEventListener('input', e => {
    allowanceSetting.flat = parseInt((e.target as HTMLInputElement).value) || 0;
    save(); renderCosts();
  });
  document.getElementById('allowancePct')?.addEventListener('input', e => {
    allowanceSetting.pct = parseInt((e.target as HTMLInputElement).value) || 0;
    save(); renderCosts();
  });

  // パネル開閉
  ['staffPanelHead', 'costPanelHead', 'zonePanelHead', 'allowancePanelHead', 'backupPanelHead'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      togglePanel(document.getElementById(id) as HTMLElement);
    });
  });

  // クリックで閉じる
  document.addEventListener('click', e => {
    hideCtx();
    if (!document.getElementById('staffPicker')?.contains(e.target as Node)) closeStaffPicker();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideCtx(); closeModal(); closeStaffEdit(); closeStaffPicker(); document.getElementById('bulkOverlay')?.classList.remove('open'); }
  });

  // サイドバードラッグ
  const sidebar = document.getElementById('sidebar');
  if (sidebar) initSidebarDrag(sidebar);

  runSilentBackup();
  render();
});

function initSidebarDrag(sidebar: HTMLElement) {
  let dragEl: HTMLElement | null = null;
  let placeholder: HTMLElement | null = null;
  function getPanels() { return [...sidebar.querySelectorAll('.panel')] as HTMLElement[]; }
  getPanels().forEach(panel => {
    const head = panel.querySelector('.panel-head') as HTMLElement;
    if (!head || (head as any)._dragBound) return;
    (head as any)._dragBound = true;
    head.addEventListener('mousedown', e => {
      if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'INPUT') return;
      e.preventDefault();
      dragEl = panel;
      dragEl.classList.add('dragging');
      placeholder = document.createElement('div');
      placeholder.style.cssText = `height:${dragEl.offsetHeight}px;margin-bottom:8px;border:2px dashed var(--border2);border-radius:8px;background:var(--surface2);`;
      dragEl.parentNode?.insertBefore(placeholder, dragEl.nextSibling);
      const startY = (e as MouseEvent).clientY;
      dragEl.style.cssText += `;position:relative;z-index:100;margin-bottom:8px;`;
      function onMove(ev: MouseEvent) {
        if (!dragEl) return;
        const dy = ev.clientY - startY;
        dragEl.style.transform = `translateY(${dy}px)`;
        const panels = getPanels().filter(p => p !== dragEl);
        let insertBefore: HTMLElement | null = null;
        for (const p of panels) { const r = p.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { insertBefore = p; break; } }
        if (insertBefore) sidebar.insertBefore(placeholder!, insertBefore);
        else sidebar.appendChild(placeholder!);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove as EventListener);
        document.removeEventListener('mouseup', onUp);
        if (!dragEl || !placeholder) return;
        dragEl.style.transform = ''; dragEl.style.position = ''; dragEl.style.zIndex = '';
        dragEl.classList.remove('dragging');
        sidebar.insertBefore(dragEl, placeholder);
        placeholder.remove(); placeholder = null; dragEl = null;
        initSidebarDrag(sidebar);
      }
      document.addEventListener('mousemove', onMove as EventListener);
      document.addEventListener('mouseup', onUp);
    });
  });
}