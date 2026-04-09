// ===== 人件費の計算 =====

import type { Staff, ShiftsMap, Zone, ZoneAssignMap, AllowanceSetting, ZoneEntry, CostResult } from './types';
import { CONFIG, timeStrToSlot, shiftKey } from './timeUtils';

// 休憩時間を計算
// 6時間超 → 45分、8時間超 → 1時間
function breakHours(slots: number): number {
  const h = slots / 2;
  if (h > CONFIG.BREAK_LONG_HOURS) return 1;
  if (h > CONFIG.BREAK_MIN_HOURS) return 0.75;
  return 0;
}

// 通常時間と深夜時間に分割
function splitNight(startSlot: number, endSlot: number) {
  const nightS = Math.max(startSlot, CONFIG.NIGHT_START);
  const nightE = Math.min(endSlot, CONFIG.NIGHT_END);
  const nightSlots = Math.max(0, nightE - nightS);
  const normalSlots = (endSlot - startSlot) - nightSlots;
  return { normalSlots, nightSlots };
}

// 1シフト分の人件費を計算
export function calcShiftCost(wage: number, startSlot: number, endSlot: number): CostResult {
  const totalSlots = endSlot - startSlot;
  if (totalSlots <= 0) return { normalH: 0, nightH: 0, breakH: 0, cost: 0, totalH: 0 };

  const { normalSlots, nightSlots } = splitNight(startSlot, endSlot);
  const breakH = breakHours(totalSlots);
  const breakFromNight = Math.min(breakH, nightSlots / 2);
  const breakFromNormal = breakH - breakFromNight;
  const paidNightH = Math.max(0, nightSlots / 2 - breakFromNight);
  const paidNormalH = Math.max(0, normalSlots / 2 - breakFromNormal);
  const cost = wage ? Math.round(paidNormalH * wage + paidNightH * wage * 1.25) : 0;

  return {
    normalH: paidNormalH,
    nightH: paidNightH,
    breakH,
    cost,
    totalH: paidNormalH + paidNightH
  };
}

// ゾーンエントリを取得
export function getZoneEntry(zoneAssign: ZoneAssignMap, key: string): ZoneEntry | null {
  const v = zoneAssign[key];
  if (!v) return null;
  if (typeof v === 'string') return { staffId: v as string, allowance: false };
  return v;
}

// 指定した日付リストのスタッフ1人分の人件費を計算
export function calcCostForDays(
  st: Staff,
  dateList: string[],
  shifts: ShiftsMap,
  zones: Zone[],
  zoneAssign: ZoneAssignMap,
  allowanceSetting: AllowanceSetting
): CostResult {
  let normalH = 0, nightH = 0, breakH = 0, cost = 0;

  for (const ds of dateList) {
    const entries: { start: number; end: number; allowance: boolean }[] = [];

    // シフトから追加
    const key = shiftKey(st.id, ds);
    (shifts[key] || []).forEach(sh => {
      entries.push({ start: sh.start, end: sh.end, allowance: false });
    });

    // ゾーンから追加
    zones.forEach((zone, zi) => {
      const rawStart = timeStrToSlot(zone.start);
      const rawEnd = timeStrToSlot(zone.end);
      if (rawEnd <= rawStart) return;
      const zoneSlots = zone.slots || 1;
      for (let si = 0; si < zoneSlots; si++) {
        const zaKey = `${zi}_${ds}_${si}`;
        const entry = getZoneEntry(zoneAssign, zaKey);
        if (entry && entry.staffId === st.id) {
          entries.push({ start: rawStart, end: rawEnd, allowance: entry.allowance });
        }
      }
    });

    if (entries.length === 0) continue;

    entries.sort((a, b) => a.start - b.start);

    // 重複する時間帯をマージ
    const merged = [{ ...entries[0] }];
    for (let i = 1; i < entries.length; i++) {
      const last = merged[merged.length - 1];
      if (entries[i].start <= last.end) {
        last.end = Math.max(last.end, entries[i].end);
        if (entries[i].allowance) last.allowance = true;
      } else {
        merged.push({ ...entries[i] });
      }
    }

    // 各マージ済みエントリの費用を計算
    merged.forEach(({ start, end, allowance }) => {
      const r = calcShiftCost(st.wage, start, end);
      normalH += r.normalH;
      nightH += r.nightH;
      breakH += r.breakH;
      cost += r.cost;

      // 手当がある場合
      if (allowance) {
        const flat = allowanceSetting.flat || 0;
        const pct = allowanceSetting.pct || 0;
        const allowanceR = calcShiftCost(st.wage, start, end);
        const allowancePaidH = allowanceR.normalH + allowanceR.nightH;
        const add = flat + Math.round(allowancePaidH * (st.wage || 0) * pct / 100);
        cost += add;
      }
    });
  }

  return { normalH, nightH, breakH, cost, totalH: normalH + nightH };
}