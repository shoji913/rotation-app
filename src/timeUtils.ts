// ===== 時刻の計算 =====

// 設定
export const CONFIG = {
  NIGHT_START: 44,      // 深夜帯開始（22:00 = 44スロット目）
  NIGHT_END: 58,        // 深夜帯終了（翌05:00 = 58スロット目）
  BREAK_MIN_HOURS: 6,   // 休憩発生の閾値
  BREAK_LONG_HOURS: 8,  // 長時間休憩の閾値
  DISPLAY_SLOTS: 48     // 描画マス数
};

export const SLOTS = 48; // データ処理は24時間（48マス）を維持

// スロット番号 → 時刻文字列
// 例: 16 → "08:00"
export function slotToTime(s: number): string {
  return `${String(Math.floor(s / 2)).padStart(2, '0')}:${s % 2 === 0 ? '00' : '30'}`;
}

// 時刻文字列 → スロット番号
// 例: "08:00" → 16
export function timeStrToSlot(t: string): number {
  if (!t) return 0;
  const parts = t.split(':').map(Number);
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  return h * 2 + (m >= 30 ? 1 : 0);
}

// 今週の月曜日を取得
export function getMonday(weekOff: number): Date {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day + weekOff * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

// 日付にn日加算
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// Date → "2024-01-15" 形式の文字列
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 今日かどうか判定
export function isToday(d: Date): boolean {
  return fmtDate(d) === fmtDate(new Date());
}

// シフトキーを生成
// 例: "s123_2024-01-15"
export function shiftKey(sid: string, ds: string): string {
  return sid + '_' + ds;
}