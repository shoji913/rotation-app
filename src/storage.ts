// ===== 保存・読み込み（localStorage操作）=====

import type { Staff, ShiftsMap, Zone, ZoneAssignMap, AllowanceSetting } from './types';

// ゾーンのデフォルト設定
export const ZONE_DEFAULTS: Zone[] = [
  { name: '早朝', start: '06:00', end: '09:00', slots: 2 },
  { name: '朝勤', start: '09:00', end: '13:00', slots: 2 },
  { name: '昼勤', start: '13:00', end: '17:00', slots: 2 },
  { name: '夕勤', start: '17:00', end: '21:00', slots: 2 },
  { name: '準夜', start: '21:00', end: '25:00', slots: 1 },
  { name: '夜勤', start: '21:00', end: '30:00', slots: 1 },
];

// 安全にlocalStorageから読み込む関数
function safeLoad<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    const parsed = JSON.parse(v);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

// 全データを読み込む
export function loadAllData() {
  const staff = safeLoad<Staff[]>('rv3_staff', []);
  const shifts = safeLoad<ShiftsMap>('rv3_shifts', {});
  const zones = safeLoad<Zone[]>('rv3_zones', ZONE_DEFAULTS.map(z => ({ ...z })));
  const zoneAssign = safeLoad<ZoneAssignMap>('rv3_zassign', {});
  const allowanceSetting = safeLoad<AllowanceSetting>('rv3_allowance', { flat: 0, pct: 0 });
  return { staff, shifts, zones, zoneAssign, allowanceSetting };
}

// 全データを保存する
export function saveAllData(
  staff: Staff[],
  shifts: ShiftsMap,
  zones: Zone[],
  zoneAssign: ZoneAssignMap,
  allowanceSetting: AllowanceSetting
) {
  localStorage.setItem('rv3_staff', JSON.stringify(staff));
  localStorage.setItem('rv3_shifts', JSON.stringify(shifts));
  localStorage.setItem('rv3_zones', JSON.stringify(zones));
  localStorage.setItem('rv3_zassign', JSON.stringify(zoneAssign));
  localStorage.setItem('rv3_allowance', JSON.stringify(allowanceSetting));
}

// バックアップ用：全データをまとめて取得
export function getAllDataForBackup(
  staff: Staff[],
  shifts: ShiftsMap,
  zones: Zone[],
  zoneAssign: ZoneAssignMap,
  allowanceSetting: AllowanceSetting
) {
  return { staff, shifts, zones, zoneAssign, allowanceSetting, exportedAt: new Date().toISOString() };
}