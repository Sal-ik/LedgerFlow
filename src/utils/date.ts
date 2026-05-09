import { SavingsStrategy } from '../types';
import { getDate, getDaysInMonth, getDay } from 'date-fns';

export function toLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  
  // If it's a full ISO string, e.g. "2026-05-06T00:00:00.000Z"
  // We want to extract the year, month, day and create a local date.
  // This avoids the shift where May 6th 00:00 UTC becomes May 5th in New York.
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, y, m, d] = match.map(Number);
    return new Date(y, m - 1, d);
  }
  
  return new Date(dateStr);
}

export function isStrategyExecutionDay(strategy: SavingsStrategy, date: Date): boolean {
  if (!strategy.frequency) {
    // Default to monthly if older DB entry
    const daysInMonth = getDaysInMonth(date);
    const targetDay = Math.min(strategy.dayOfMonth || 28, daysInMonth);
    return getDate(date) === targetDay;
  }

  switch (strategy.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      // strategy.dayOfWeek is 0-6 (Sun-Sat)
      return getDay(date) === (strategy.dayOfWeek || 0);
    case 'yearly':
      // Assuming dayOfMonth goes up to 31.
      // A full yearly strategy should also specify a month, but since we don't have it, 
      // let's do it on the last day of the year.
      return date.getMonth() === 11 && getDate(date) === 31;
    case 'monthly':
    default: {
      const daysInMonth = getDaysInMonth(date);
      const targetDay = Math.min(strategy.dayOfMonth || 28, daysInMonth);
      return getDate(date) === targetDay;
    }
  }
}
