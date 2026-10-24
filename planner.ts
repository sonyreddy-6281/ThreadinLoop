export interface PlannerDay {
  key: string;
  date: Date;
  isToday: boolean;
  offset: number;
}
export interface CalendarCell {
  key: string;
  date: Date;
  day: PlannerDay | null;
  inMonth: boolean;
}
export interface PlanEntry { note: string; completed: boolean; }
export const STORAGE_KEY = 'next30.plan.v1';

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Calendar arithmetic at midday keeps dates stable across daylight saving.
export function buildDays(start: Date, count = 30): PlannerDay[] {
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, 12);
    return { key: dateKey(date), date, isToday: offset === 0, offset };
  });
}

export function buildMonthCells(month: Date, days: PlannerDay[]): CalendarCell[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const weekday = (first.getDay() + 6) % 7;
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
  const size = Math.ceil((weekday + last.getDate()) / 7) * 7;
  const lookup = new Map(days.map(day => [day.key, day]));
  return Array.from({ length: size }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), index - weekday + 1, 12);
    const key = dateKey(date);
    return { key, date, day: lookup.get(key) ?? null, inMonth: date.getMonth() === month.getMonth() };
  });
}

function validDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  return dateKey(date) === key;
}

export function sanitizeSavedPlan(value: unknown): Record<string, PlanEntry> {
  const result: Record<string, PlanEntry> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    if (!validDateKey(key) || !item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as Partial<PlanEntry>;
    const note = typeof entry.note === 'string' ? entry.note.slice(0, 2000) : '';
    const completed = entry.completed === true;
    if (note || completed) result[key] = { note, completed };
  }
  return result;
}

export function serializePlanCsv(days: PlannerDay[], entries: Record<string, PlanEntry>): string {
  const quote = (value: string): string => {
    const safe = /^[\s]*[=+\-@]/.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return ['Date,Note,Completed', ...days.map(day => {
    const entry = entries[day.key];
    return `${day.key},${quote(entry?.note ?? '')},${entry?.completed ? 'Yes' : 'No'}`;
  })].join('\r\n');
}
