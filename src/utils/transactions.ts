import { Transaction, SavingsStrategy, AssetLiability } from '../types';
import { format, addDays, addWeeks, addMonths, addYears, isAfter, isBefore, startOfDay } from 'date-fns';
import { isStrategyExecutionDay, toLocalDate } from './date';

export interface ProcessedDay {
  date: Date;
  dateStr: string;
  transactions: Transaction[];
  transactionsWithBalance: { transaction: Transaction, balance: number }[];
  income: number;
  expense: number;
  savingsDeduction: number;
  savingsStrategiesSwept: { name: string; amount: number; balanceAfter: number }[];
  savingsDrawdowns: { transactionId: string; amount: number; savingsBalanceAfter: number }[];
  assetDrawdowns: { assetId: string; amount: number; assetBalanceAfter: number; transactionId: string }[];
  runningBalance: number;
  historicalSavings: number;
  assetBalances: Record<string, number>;
}

export function generateLedger(
  transactions: Transaction[],
  strategies: SavingsStrategy[],
  assets: AssetLiability[],
  startDate: Date,
  endDate: Date
): ProcessedDay[] {
  // 1. Expand all recurring transactions
  const expanded: Transaction[] = [];
  transactions.forEach(t => {
    const tDate = toLocalDate(t.date);
    expanded.push({ ...t });

    if (t.isRecurring && t.frequency && t.frequency !== 'none') {
      let nextDate = tDate;
      const excluded = new Set((t.excludedDates || []).map(d => format(toLocalDate(d), 'yyyy-MM-dd')));
      
      while (true) {
        switch (t.frequency) {
          case 'daily': nextDate = addDays(nextDate, 1); break;
          case 'weekly': {
            nextDate = addWeeks(nextDate, 1);
            if (t.dayOfWeek !== undefined && t.dayOfWeek !== null) {
              const currentDow = nextDate.getDay();
              nextDate = addDays(nextDate, t.dayOfWeek - currentDow);
            }
            break;
          }
          case 'monthly': {
            nextDate = addMonths(nextDate, 1);
            if (t.dayOfMonth !== undefined && t.dayOfMonth !== null) {
              // Ensure we don't go beyond days in month
              const daysInMonth = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
              const targetDay = Math.min(t.dayOfMonth, daysInMonth);
              nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth(), targetDay);
            }
            break;
          }
          case 'yearly': {
            nextDate = addYears(nextDate, 1);
            if (t.dayOfMonth !== undefined && t.dayOfMonth !== null) {
              const daysInMonth = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
              const targetDay = Math.min(t.dayOfMonth, daysInMonth);
              nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth(), targetDay);
            }
            break;
          }
          default: break;
        }
        if (isAfter(nextDate, endDate)) break;
        
        // Also check if this transaction has a specific endDate set
        if (t.endDate && isAfter(nextDate, toLocalDate(t.endDate))) break;
        
        // Safety break if we get stuck in infinite loop or logic error
        if (nextDate.getTime() <= tDate.getTime() && expanded.length > 0) break; 
        
        const dateStr = format(nextDate, 'yyyy-MM-dd');
        if (isAfter(nextDate, tDate) && !excluded.has(dateStr)) {
          expanded.push({
            ...t,
            date: nextDate.toISOString()
          });
        }
      }
    }
  });

  // 2. Sort chronologically
  const sorted = [...expanded].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // 3. Process day by day
  let runningBalance = 0;
  let historicalSavings = 0;
  const processedSavingsPoints = new Set<string>();
  
  // Track asset balances separately
  const currentAssetBalances: Record<string, number> = {};
  assets.forEach(a => {
    if (a.id) currentAssetBalances[a.id] = a.currentBalance;
  });
  
  // Find the true oldest date from the sorted array, or fallback to startDate
  const trueStartDate = sorted.length > 0 ? startOfDay(toLocalDate(sorted[0].date)) : startDate;
  // We need to iterate from trueStartDate up to endDate to build correct balances
  const iterationStart = isBefore(trueStartDate, startDate) ? trueStartDate : startDate;

  let iter = startOfDay(iterationStart);
  const result: ProcessedDay[] = [];

  while (!isAfter(iter, endDate)) {
    const dStr = format(iter, 'yyyy-MM-dd');
    const dayTxs = sorted.filter(t => format(toLocalDate(t.date), 'yyyy-MM-dd') === dStr);
    
    // Process standard transactions
    let dayIncome = 0;
    let dayExpense = 0;
    const transactionsWithBalance: { transaction: Transaction, balance: number }[] = [];
    const savingsDrawdowns: { transactionId: string; amount: number; savingsBalanceAfter: number }[] = [];
    const assetDrawdowns: { assetId: string; amount: number; assetBalanceAfter: number; transactionId: string }[] = [];
    
    dayTxs.forEach(t => {
      const tAmount = Number(t.amount) || 0;
      if (t.fundedBySavings && t.type === 'expense') {
        let maxFromSavings = historicalSavings;
        if (t.savingsCap !== undefined && t.savingsCap !== null && t.savingsCap >= 0) {
          maxFromSavings = Math.min(historicalSavings, Number(t.savingsCap) || 0);
        }
        
        const fromSavings = Math.min(tAmount, maxFromSavings);
        const remainder = tAmount - fromSavings;
        
        historicalSavings -= fromSavings;
        if (fromSavings > 0) {
          savingsDrawdowns.push({ 
            transactionId: t.id || `funded-${t.description}`, 
            amount: fromSavings, 
            savingsBalanceAfter: historicalSavings 
          });
        }
        if (remainder > 0) {
          runningBalance -= remainder;
          dayExpense += remainder;
        }
      } else if (t.fundedByAssetId && t.type === 'expense') {
        const assetId = t.fundedByAssetId;
        const availableInAsset = currentAssetBalances[assetId] || 0;
        const fromAsset = Math.min(tAmount, availableInAsset);
        const remainder = tAmount - fromAsset;
        
        if (fromAsset > 0) {
          currentAssetBalances[assetId] -= fromAsset;
          assetDrawdowns.push({
            assetId,
            amount: fromAsset,
            assetBalanceAfter: currentAssetBalances[assetId],
            transactionId: t.id || `asset-funded-${t.description}`
          });
        }
        
        if (remainder > 0) {
          runningBalance -= remainder;
          dayExpense += remainder;
        }
      } else {
        if (t.type === 'income') {
          dayIncome += tAmount;
          runningBalance += tAmount;
          
          // If this income is linked to a receivable, reduce the outstanding balance
          if (t.linkedAssetId && currentAssetBalances[t.linkedAssetId] !== undefined) {
            currentAssetBalances[t.linkedAssetId] -= tAmount;
          }
        } else {
          dayExpense += tAmount;
          runningBalance -= tAmount;

          // If this expense is linked to a payable/liability, reduce the outstanding balance
          if (t.linkedAssetId && currentAssetBalances[t.linkedAssetId] !== undefined) {
            currentAssetBalances[t.linkedAssetId] -= tAmount;
          }
        }
      }
      transactionsWithBalance.push({ transaction: t, balance: runningBalance });
    });

    // Process savings strategies
    let savingsDeduction = 0;
    const savingsStrategiesSwept: { name: string; amount: number; balanceAfter: number }[] = [];
    
    strategies.forEach(s => {
      if (!s.isActive) return;
      if (isStrategyExecutionDay(s, iter)) {
        const key = `${s.id}-${dStr}`;
        if (!processedSavingsPoints.has(key)) {
          let amt: number = 0;
          
          if (!s.calculationType || s.calculationType === 'percentage') {
             const sMinAmount = Number(s.minAmount) || 0;
             const sMaxAmount = Number(s.maxAmount) || 0;
             const sPercentage = Number(s.percentage) || 0;
             
             if (runningBalance > sMinAmount) {
               amt = (runningBalance * sPercentage) / 100;
               if (sMinAmount > 0) amt = Math.max(sMinAmount, amt);
               if (sMaxAmount > 0) amt = Math.min(sMaxAmount, amt);
             } else {
               amt = sMinAmount;
             }
          } else if (s.calculationType === 'fixed') {
             amt = Number(s.fixedAmount) || 0;
          } else if (s.calculationType === 'sweep') {
             const lAmount = Number(s.leaveAmount) || 0;
             if (runningBalance > lAmount) {
                amt = runningBalance - lAmount;
             }
          }
          
          if (amt > 0 && runningBalance >= amt) { // Prevent sweeping more than available
            runningBalance -= amt;
            historicalSavings += amt;
            savingsDeduction += amt;
            savingsStrategiesSwept.push({ name: s.name, amount: amt, balanceAfter: runningBalance });
          } else if (amt > 0 && runningBalance > 0) { // Sweep whatever is left
            amt = runningBalance;
            runningBalance -= amt;
            historicalSavings += amt;
            savingsDeduction += amt;
            savingsStrategiesSwept.push({ name: s.name, amount: amt, balanceAfter: runningBalance });
          }
          processedSavingsPoints.add(key);
        }
      }
    });

    // Normalize comparison to start of day to avoid skipping the first day if startDate has a time component
    if (!isBefore(iter, startOfDay(startDate))) {
      result.push({
        date: new Date(iter),
        dateStr: dStr,
        transactions: dayTxs,
        transactionsWithBalance,
        income: dayIncome,
        expense: dayExpense,
        savingsDeduction,
        savingsStrategiesSwept,
        savingsDrawdowns,
        assetDrawdowns,
        runningBalance,
        historicalSavings,
        assetBalances: { ...currentAssetBalances }
      });
    }

    iter = addDays(iter, 1);
  }

  return result;
}
