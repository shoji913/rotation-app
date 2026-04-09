// ===== データの設計図（型定義）=====

// スタッフ1人分のデータ
export interface Staff {
  id: string;        // 例: "s1234567890"
  name: string;      // 例: "田中"
  wage: number;      // 例: 1050（時給）
  color: string;     // 例: "c0"（色の番号）
}

// シフト1件分のデータ
export interface Shift {
  start: number;     // 例: 16（8:00 = 16スロット目）
  end: number;       // 例: 24（12:00 = 24スロット目）
}

// 時間帯ゾーン1件分のデータ
export interface Zone {
  name: string;      // 例: "早朝"
  start: string;     // 例: "06:00"
  end: string;       // 例: "09:00"
  slots: number;     // 例: 2（枠数）
}

// ゾーンへのスタッフ割り当て
export interface ZoneEntry {
  staffId: string;   // どのスタッフか
  allowance: boolean; // 手当ありかどうか
}

// 手当の設定
export interface AllowanceSetting {
  flat: number;      // 定額（円）
  pct: number;       // 時給UP（%）
}

// シフトデータ全体（日付ごとにまとめたもの）
// 例: { "s123_2024-01-15": [{start:16, end:24}] }
export type ShiftsMap = Record<string, Shift[]>;

// ゾーン割り当て全体
// 例: { "0_2024-01-15_0": {staffId:"s123", allowance:false} }
export type ZoneAssignMap = Record<string, ZoneEntry>;

// 人件費計算の結果
export interface CostResult {
  normalH: number;   // 通常時間（時間）
  nightH: number;    // 深夜時間（時間）
  breakH: number;    // 休憩時間（時間）
  cost: number;      // 合計金額（円）
  totalH: number;    // 合計時間
}