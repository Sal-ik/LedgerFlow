import React, { useEffect, useState, useMemo } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot, orderBy, Timestamp, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { Transaction, SavingsStrategy } from '../types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Calendar, Calculator, Sparkles, PlusCircle, PiggyBank, Trash2, AlertTriangle, Activity, Bell, X, Scale } from 'lucide-react';
import { format, startOfDay, endOfDay, addMonths, isAfter, startOfMonth, endOfMonth, isWithinInterval, addDays, addWeeks, addYears, getDate, isBefore, getDaysInMonth } from 'date-fns';
import { handleFirestoreError, OperationType } from '../lib/firebase';
import { isStrategyExecutionDay, toLocalDate } from '../utils/date';
import { generateLedger } from '../utils/transactions';
import { ConfirmDialog } from './ConfirmDialog';

const calculateMonthlyAmount = (amount: number, frequency: string) => {
  switch (frequency) {
    case 'daily': return amount * 30;
    case 'weekly': return amount * 4.33;
    case 'monthly': return amount;
    case 'yearly': return amount / 12;
    default: return 0;
  }
};

export const Dashboard: React.FC<{ onShowAdd?: () => void, onEdit?: (t: Transaction) => void }> = ({ onShowAdd, onEdit }) => {
  const { user, profile } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [strategies, setStrategies] = useState<SavingsStrategy[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [timeRange, setTimeRange] = useState<'1w' | '30d' | '60d' | '3m' | '6m' | '1y'>('30d');
  const [showSavingsLine, setShowSavingsLine] = useState(false);
  const [deleteSeriesId, setDeleteSeriesId] = useState<string | null>(null);
  const [selectedInsight, setSelectedInsight] = useState<{ title: string; transactions: Transaction[]; date?: Date; amount: number } | null>(null);
  
  const currencySymbol = useMemo(() => {
    const currencies = [
      { code: 'USD', symbol: '$' },
      { code: 'EUR', symbol: '€' },
      { code: 'GBP', symbol: '£' },
      { code: 'JPY', symbol: '¥' },
      { code: 'INR', symbol: '₹' },
      { code: 'PKR', symbol: '₨' },
    ];
    return currencies.find(c => c.code === profile?.currency)?.symbol || '$';
  }, [profile?.currency]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', user.uid),
      orderBy('date', 'desc')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Transaction[];
      setTransactions(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    const strategiesQ = query(
      collection(db, 'savings_strategies'),
      where('userId', '==', user.uid),
      where('isActive', '==', true)
    );

    const unsubStrategies = onSnapshot(strategiesQ, (snapshot) => {
      setStrategies(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as SavingsStrategy[]);
    });

    const assetsQ = query(collection(db, 'assets'), where('userId', '==', user.uid), where('isActive', '==', true));
    const unsubAssets = onSnapshot(assetsQ, (snapshot) => {
      setAssets(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsub();
      unsubStrategies();
      unsubAssets();
    };
  }, [user]);

  // Forecast data generation
  const { forecastData, stats } = useMemo(() => {
    if (transactions.length === 0) {
      return { 
        forecastData: [], 
        stats: { 
          balanceToday: 0, 
          monthlyRecIncome: 0, 
          monthlyRecExpense: 0, 
          recurringCount: 0, 
          netRecurring: 0,
          expensesToday: 0,
          nextInflow: null,
          nextExpense: null,
          liquidityFloor: null,
          firstNegative: null
        }
      };
    }

    const today = startOfDay(new Date());
    
    let rangeLength = 30;
    switch (timeRange) {
      case '1w': rangeLength = 7; break;
      case '30d': rangeLength = 30; break;
      case '60d': rangeLength = 60; break;
      case '3m': rangeLength = 90; break;
      case '6m': rangeLength = 180; break;
      case '1y': rangeLength = 365; break;
    }

    const nextDays = Array.from({ length: rangeLength }, (_, i) => addDays(today, i));
    const endDate = nextDays[nextDays.length - 1];
    
    const validTransactions = transactions.filter(t => t.date && !isNaN(toLocalDate(t.date).getTime()));
    const oldestDate = validTransactions.length > 0 
      ? Math.min(...validTransactions.map(t => toLocalDate(t.date).getTime())) 
      : today.getTime();
    const startDate = new Date(oldestDate);

    // generateLedger expands everything and simulates the wallet up to endDate
    const ledger = generateLedger(validTransactions, strategies, assets, startDate, endDate);

    // 1. Calculate stats up to 'today'
    let currentBal = 0;
    const ledgerDayToday = ledger.find(ld => ld.dateStr === format(today, 'yyyy-MM-dd'));
    
    for (const day of ledger) {
      if (isAfter(day.date, today)) break;
      currentBal = day.runningBalance;
    }

    // 2. Extra Dashboard Insights
    const expensesToday = ledgerDayToday ? ledgerDayToday.expense : 0;
    
    // Future visibility
    const futureLedger = ledger.filter(ld => isAfter(ld.date, today));
    
    // Upcoming Inflow: Next day where balance INCREASES
    const nextInflowDay = futureLedger.find(ld => ld.income > 0);
    const nextInflow = nextInflowDay ? {
      amount: nextInflowDay.income,
      date: nextInflowDay.date,
      transactions: nextInflowDay.transactions.filter(t => t.type === 'income')
    } : null;

    const nextExpenseDay = futureLedger.find(ld => ld.expense > 0);
    const nextExpense = nextExpenseDay ? {
      amount: nextExpenseDay.expense,
      date: nextExpenseDay.date,
      transactions: nextExpenseDay.transactions.filter(t => t.type === 'expense')
    } : null;

    // Liquidity Floor (Min projected balance this month)
    const monthEnd = endOfMonth(today);
    const monthLedger = ledger.filter(ld => isWithinInterval(ld.date, { start: today, end: monthEnd }));
    const liquidityFloor = monthLedger.length > 0 
      ? monthLedger.reduce((min, curr) => curr.runningBalance < min.amount ? { amount: curr.runningBalance, date: curr.date, transactions: curr.transactions } : min, { amount: Infinity, date: today, transactions: [] as Transaction[] })
      : null;

    // First Negative Spike
    const firstNegativeDay = monthLedger.find(ld => ld.runningBalance < 0);
    const firstNegative = firstNegativeDay ? {
      amount: firstNegativeDay.runningBalance,
      date: firstNegativeDay.date,
      transactions: firstNegativeDay.transactions
    } : null;

    // Monthly Savings (Projected Savings for current month)
    const currentMonthInterval = { start: startOfMonth(today), end: endOfMonth(today) };
    const currentMonthLedger = ledger.filter(ld => isWithinInterval(ld.date, currentMonthInterval));
    const totalMonthlySavings = currentMonthLedger.reduce((sum, ld) => sum + ld.savingsDeduction, 0);

    // 3. Monthly Recurring Stats (independent of forecast, just static)
    const recurring = transactions.filter(t => t.isRecurring && !isNaN(t.amount));
    let monthlyRecIncome = 0;
    let monthlyRecExpense = 0;

    recurring.forEach(t => {
      const amt = Number(t.amount) || 0;
      const monthlyAmount = calculateMonthlyAmount(amt, t.frequency);
      if (t.type === 'income') monthlyRecIncome += monthlyAmount;
      else monthlyRecExpense += monthlyAmount; // include all payables even if fundedBySavings (consolidated view)
    });

    let estimatedMonthlySavings = 0;
    const currentSimBalance = Number(currentBal) || 0;
    strategies.forEach(s => {
      if (s.isActive) {
        const percentage = Number(s.percentage) || 0;
        const minAmount = Number(s.minAmount) || 0;
        const maxAmount = Number(s.maxAmount) || 0;
        
        let amt = (currentSimBalance * percentage) / 100;
        if (currentSimBalance <= minAmount) amt = minAmount;
        else amt = Math.min(maxAmount, Math.max(minAmount, amt));
        
        if (amt > currentSimBalance) amt = 0;
        if (amt > 0) estimatedMonthlySavings += amt;
      }
    });

    const totalExpense = monthlyRecExpense + estimatedMonthlySavings;

    const calculatedStats = {
      balanceToday: currentBal || 0,
      monthlyRecIncome: monthlyRecIncome || 0,
      monthlyRecExpense: monthlyRecExpense || 0,
      recurringCount: recurring.length,
      netRecurring: (monthlyRecIncome || 0) - (monthlyRecExpense || 0),
      expensesToday: expensesToday || 0,
      nextInflow,
      nextExpense,
      liquidityFloor,
      firstNegative,
      totalMonthlySavings: totalMonthlySavings || 0,
      monthlySavingsEntries: currentMonthLedger
        .filter(ld => (ld.savingsDeduction || 0) > 0)
        .flatMap(ld => (ld.savingsStrategiesSwept || []).map(s => ({
          id: `savings-${ld.dateStr}-${s.name}`,
          amount: Number(s.amount) || 0,
          category: 'Savings',
          description: `Strategy: ${s.name}`,
          type: 'expense' as const,
          date: ld.date.toISOString(),
          userId: user?.uid || ''
        })))
    };

    const ledgerMap = new Map(ledger.map(ld => [ld.dateStr, ld]));
    
    // 3. Map forecast Data
    let lastKnownBalance = currentBal;
    let lastKnownSavings = 0;
    const mappedForecast = nextDays.map(d => {
      const dStr = format(d, 'yyyy-MM-dd');
      const ledgerDay = ledgerMap.get(dStr);
      
      if (ledgerDay) {
        lastKnownBalance = ledgerDay.runningBalance;
        lastKnownSavings = ledgerDay.historicalSavings;
      }

      const dayEntries: any[] = [];
      if (ledgerDay) {
        ledgerDay.transactions.forEach((t: any) => {
          dayEntries.push({
            category: t.category,
            amount: t.amount,
            type: t.type,
            fundedBySavings: t.fundedBySavings
          });
        });

        if (ledgerDay.savingsStrategiesSwept && ledgerDay.savingsStrategiesSwept.length > 0) {
          ledgerDay.savingsStrategiesSwept.forEach((sw: any) => {
            dayEntries.push({
              category: `Savings: ${sw.name}`,
              amount: sw.amount,
              type: 'expense',
              isSavingsSweep: true
            });
          });
        }

        if (ledgerDay.savingsDrawdowns && ledgerDay.savingsDrawdowns.length > 0) {
          ledgerDay.savingsDrawdowns.forEach((sd: any) => {
            dayEntries.push({
              category: 'Savings Drawdown',
              amount: sd.amount,
              type: 'income',
              isSavingsRelated: true
            });
          });
        }

        if (ledgerDay.assetDrawdowns && ledgerDay.assetDrawdowns.length > 0) {
          ledgerDay.assetDrawdowns.forEach((ad: any) => {
            const assetName = assets.find(a => a.id === ad.assetId)?.name || 'Asset';
            dayEntries.push({
              category: `Asset Funding: ${assetName}`,
              amount: ad.amount,
              type: 'income',
              isAssetFunding: true
            });
          });
        }
      }

      return {
        date: format(d, 'MMM dd'),
        formattedDate: format(d, 'dd MMMM yyyy'),
        balance: lastKnownBalance || 0,
        historicalSavings: lastKnownSavings || 0,
        dayIncome: (ledgerDay ? ledgerDay.income : 0) || 0,
        dayExpense: (ledgerDay ? ledgerDay.expense : 0) || 0,
        savingsDeduction: (ledgerDay ? ledgerDay.savingsDeduction : 0) || 0,
        events: dayEntries,
        rawDate: d
      };
    });

    return { forecastData: mappedForecast, stats: calculatedStats };
  }, [transactions, strategies, timeRange]);

  const confirmDeleteSeries = async () => {
    if (!deleteSeriesId) return;
    try {
      const qAsset = query(collection(db, 'assets'), where('userId', '==', user?.uid), where('linkedTransactionIds', 'array-contains', deleteSeriesId));
      const assetSnap = await getDocs(qAsset);
      for (const a of assetSnap.docs) {
        await deleteDoc(doc(db, 'assets', a.id));
      }
      await deleteDoc(doc(db, 'transactions', deleteSeriesId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `transactions/${deleteSeriesId}`);
    }
    setDeleteSeriesId(null);
  };

  const handleDeleteSeries = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteSeriesId(id);
  };

  const ranges = [
    { id: '1w', label: '1 Week' },
    { id: '30d', label: '30 Days' },
    { id: '60d', label: '60 Days' },
    { id: '3m', label: '3 Months' },
    { id: '6m', label: '6 Months' },
    { id: '1y', label: '1 Year' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Portfolio Overview</h1>
          <p className="text-xs text-slate-400 font-mono tracking-wider uppercase">Projected Liquidity Tracking</p>
        </div>
        <button 
          onClick={onShowAdd}
          className="hidden md:flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <PlusCircle className="w-4 h-4" />
          Add Entry
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard title="Balance Today" value={stats.balanceToday} subtitle="Current Liquidity" currencySymbol={currencySymbol} />
        <KPICard title="Monthly Income" value={stats.monthlyRecIncome} subtitle="Recurring Yield" isPositive currencySymbol={currencySymbol} />
        <KPICard title="Monthly Expense" value={stats.monthlyRecExpense} subtitle="Recurring Commitments" isNegative currencySymbol={currencySymbol} />
        <KPICard title="Recurring Net" value={stats.netRecurring} subtitle={`${stats.recurringCount} Active Items`} isPositive={stats.netRecurring > 0} isNegative={stats.netRecurring < 0} currencySymbol={currencySymbol} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.firstNegative && stats.liquidityFloor && stats.firstNegative.date.getTime() !== stats.liquidityFloor.date.getTime() && (
          <InsightCard 
            title="Liquidity Alert" 
            amount={stats.firstNegative.amount} 
            date={format(stats.firstNegative.date, 'MMM dd, yyyy')}
            icon={<AlertTriangle className="w-4 h-4" />}
            color="rose"
            currencySymbol={currencySymbol}
            onClick={() => setSelectedInsight({
              title: "Liquidity Alert: First Deficit",
              transactions: stats.firstNegative?.transactions || [],
              date: stats.firstNegative?.date,
              amount: stats.firstNegative?.amount || 0
            })}
          />
        )}

        {stats.expensesToday > 0 ? (
          <InsightCard 
            title="Expenses Today" 
            amount={stats.expensesToday} 
            date="Processing Today"
            icon={<Activity className="w-4 h-4" />}
            color="rose"
            currencySymbol={currencySymbol}
            onClick={() => setSelectedInsight({
               title: "Daily Commitments",
               transactions: transactions.filter(t => format(toLocalDate(t.date), 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')),
               date: new Date(),
               amount: stats.expensesToday
            })}
          />
        ) : stats.nextExpense ? (
          <InsightCard 
            title="Next Commitment" 
            amount={stats.nextExpense.amount} 
            date={format(stats.nextExpense.date, 'MMM dd, yyyy')}
            category={stats.nextExpense.transactions[0]?.category}
            icon={<Bell className="w-4 h-4" />}
            color="slate"
            currencySymbol={currencySymbol}
            onClick={() => setSelectedInsight({
              title: "Upcoming Commitment",
              transactions: stats.nextExpense?.transactions || [],
              date: stats.nextExpense?.date,
              amount: stats.nextExpense?.amount || 0
            })}
          />
        ) : null}

        {stats.nextInflow && (
          <InsightCard 
            title="Upcoming Inflow" 
            amount={stats.nextInflow.amount} 
            date={format(stats.nextInflow.date, 'MMM dd, yyyy')}
            category={stats.nextInflow.transactions[0]?.category}
            icon={<TrendingUp className="w-4 h-4" />}
            color="emerald"
            currencySymbol={currencySymbol}
            onClick={() => setSelectedInsight({
              title: "Expected Settlement",
              transactions: stats.nextInflow?.transactions || [],
              date: stats.nextInflow?.date,
              amount: stats.nextInflow?.amount || 0
            })}
          />
        )}

        {stats.liquidityFloor && (
          <InsightCard 
            title="Monthly Floor" 
            amount={stats.liquidityFloor.amount} 
            date={format(stats.liquidityFloor.date, 'MMM dd')}
            isFloor
            icon={<Scale className="w-4 h-4" />}
            color={stats.liquidityFloor.amount < 0 ? 'rose' : 'indigo'}
            currencySymbol={currencySymbol}
            onClick={() => setSelectedInsight({
              title: "Monthly Liquidity Floor",
              transactions: stats.liquidityFloor?.transactions || [],
              date: stats.liquidityFloor?.date,
              amount: stats.liquidityFloor?.amount || 0
            })}
          />
        )}

        <InsightCard 
          title="Monthly Savings" 
          amount={stats.totalMonthlySavings} 
          date={format(endOfMonth(new Date()), 'MMMM yyyy')}
          icon={<PiggyBank className="w-4 h-4" />}
          color="emerald"
          currencySymbol={currencySymbol}
          onClick={() => {
            setSelectedInsight({
              title: "Projected Monthly Savings",
              transactions: stats.monthlySavingsEntries,
              date: endOfMonth(new Date()),
              amount: stats.totalMonthlySavings
            });
          }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Liquidity Forecast</h3>
              <div className="flex gap-4 text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></div> Balance Level</span>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-100">
               {ranges.map(r => (
                <button
                  key={r.id}
                  onClick={() => setTimeRange(r.id as any)}
                  className={`px-2 py-1 rounded text-[9px] font-bold uppercase transition-all ${
                    timeRange === r.id 
                      ? 'bg-slate-900 text-white shadow-sm' 
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            
            <button
               onClick={() => setShowSavingsLine(!showSavingsLine)}
               className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase transition-all ${
                 showSavingsLine
                   ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm'
                   : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:bg-slate-50'
               }`}
             >
               <PiggyBank className="w-3 h-3" />
               Savings Curve {showSavingsLine ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecastData} margin={{ top: 10, right: 30, left: 0, bottom: 20 }}>
                <defs>
                  <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorSavings" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="date" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                  label={{ value: 'Forecast Timeline', position: 'bottom', offset: 0, fontSize: 10, fontWeight: 700, fill: '#cbd5e1', style: { textTransform: 'uppercase', letterSpacing: '0.1em' } }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                  label={{ value: `Balance (${currencySymbol})`, angle: -90, position: 'insideLeft', offset: 20, fontSize: 10, fontWeight: 700, fill: '#cbd5e1', style: { textTransform: 'uppercase', letterSpacing: '0.1em' } }}
                />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 border border-slate-800 p-3 rounded shadow-xl min-w-[160px]">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{data.formattedDate}</p>
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center gap-4">
                              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tight">Projected</span>
                              <span className="text-xs font-mono font-bold text-white">{currencySymbol}{data.balance.toLocaleString()}</span>
                            </div>
                            {showSavingsLine && (
                              <div className="flex justify-between items-center gap-4">
                                <span className="text-[10px] text-emerald-500/80 font-bold uppercase tracking-tight">Savings</span>
                                <span className="text-xs font-mono font-bold text-emerald-400">{currencySymbol}{data.historicalSavings.toLocaleString()}</span>
                              </div>
                            )}
                            {(data.dayIncome > 0 || data.dayExpense > 0 || data.savingsDeduction > 0) && (
                              <div className="pt-1.5 border-t border-slate-800 mt-1.5 space-y-1">
                                {data.events.slice(0, 4).map((e: any, i: number) => (
                                  <div key={i} className="flex justify-between items-center gap-4">
                                    <span className="text-[9px] text-slate-500 font-medium truncate max-w-[80px]">{e.category}</span>
                                    <span className={`text-[10px] font-mono font-bold ${e.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {e.type === 'income' ? '+' : '-'}{currencySymbol}{e.amount.toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                                {data.events.length > 4 && <p className="text-[8px] text-slate-600 text-center">+{data.events.length - 4} more</p>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area type="monotone" dataKey="balance" stroke="#4f46e5" strokeWidth={3} fill="url(#colorBalance)" animationDuration={1000} />
                {showSavingsLine && (
                  <Area type="monotone" dataKey="historicalSavings" stroke="#10b981" strokeWidth={2} strokeDasharray="4 4" fill="url(#colorSavings)" animationDuration={1000} />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-widest">Recurring Items</h3>
            <Sparkles className="w-3 h-3 text-indigo-400" />
          </div>
          <div className="p-4 space-y-2 overflow-auto max-h-[400px] divide-y divide-slate-100">
            {transactions.filter(t => t.isRecurring).map(t => ({
              id: t.id,
              category: t.category,
              type: t.type,
              amount: t.amount,
              frequency: t.frequency,
              monthlyAmount: calculateMonthlyAmount(t.amount, t.frequency),
              date: t.date,
              raw: t
            })).sort((a, b) => b.monthlyAmount - a.monthlyAmount).map(item => (
              <div 
                key={item.id} 
                className="flex items-center justify-between py-3 hover:bg-slate-50 -mx-4 px-4 transition-colors cursor-pointer group"
                onClick={() => onEdit?.(item.raw as Transaction)}
              >
                <div className="min-w-0 pr-2">
                  <p className="text-[10px] font-black text-slate-800 group-hover:text-indigo-600 transition-colors uppercase tracking-tighter truncate">
                    {item.category}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[8px] text-slate-400 bg-slate-100 px-1 rounded font-bold uppercase tracking-widest">{item.frequency}</span>
                    {item.frequency !== 'monthly' && (
                      <span className="text-[9px] text-indigo-500 font-mono font-bold">
                        ≈ {currencySymbol}{Math.round(item.monthlyAmount).toLocaleString()}/mo
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 flex items-center gap-3">
                  <div>
                    <p className={`text-xs font-mono font-bold ${item.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {item.type === 'income' ? '+' : '-'}{currencySymbol}{item.amount.toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => item.id && handleDeleteSeries(item.id, e)}
                    className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors rounded hover:bg-rose-50"
                    title="Delete Series"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {transactions.filter(t => t.isRecurring).length === 0 && (
              <div className="py-12 text-center text-slate-300">
                <p className="text-[10px] font-bold uppercase">No active commitments</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {selectedInsight && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">{selectedInsight.title}</h3>
                {selectedInsight.date && <p className="text-[10px] text-slate-400 font-mono font-bold mt-1">{format(selectedInsight.date, 'EEEE, dd MMMM yyyy')}</p>}
              </div>
              <button onClick={() => setSelectedInsight(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4 no-scrollbar">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Impact Amount</span>
                <span className={`text-lg font-mono font-black ${selectedInsight.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {currencySymbol}{Math.abs(selectedInsight.amount).toLocaleString()}
                </span>
              </div>
              
              <div className="space-y-3">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-1">Atomic Entries</p>
                {selectedInsight.transactions.length > 0 ? selectedInsight.transactions.map((t, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 border border-slate-100 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${t.type === 'income' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                        {t.type === 'income' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900">{t.category}</p>
                        <p className="text-[10px] text-slate-400 truncate max-w-[150px]">{t.description}</p>
                      </div>
                    </div>
                    <span className={`text-xs font-mono font-bold ${t.type === 'income' ? 'text-emerald-600' : 'text-slate-900'}`}>
                      {t.type === 'income' ? '+' : '-'}{currencySymbol}{t.amount.toLocaleString()}
                    </span>
                  </div>
                )) : (
                  <p className="text-xs text-slate-400 bg-slate-50 p-4 rounded-lg text-center italic">No individual entries detected for this projection point.</p>
                )}
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100">
              <button 
                onClick={() => setSelectedInsight(null)}
                className="w-full py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
              >
                Dismiss Protocol Brief
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteSeriesId !== null}
        title="Delete Recurring Series"
        message="Are you sure you want to delete this entire recurring sequence of transactions? This action cannot be undone."
        onConfirm={confirmDeleteSeries}
        onCancel={() => setDeleteSeriesId(null)}
        confirmText="Delete Series"
      />
    </div>
  );
};

function KPICard({ title, value, subtitle, isPositive, isNegative, currencySymbol = '$' }: { title: string, value: string | number, subtitle: string, isPositive?: boolean, isNegative?: boolean, currencySymbol?: string }) {
  const formattedValue = typeof value === 'number' ? `${currencySymbol}${value.toLocaleString()}` : value;
  return (
    <div className="bg-white p-4 md:p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-1">
      <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">{title}</p>
      <p className={`text-xl md:text-2xl font-bold tracking-tight ${isPositive ? 'text-emerald-600' : isNegative ? 'text-rose-600' : 'text-indigo-600'}`}>
        {formattedValue}
      </p>
      <p className="text-[9px] md:text-[10px] text-slate-400 font-medium truncate">{subtitle}</p>
    </div>
  );
}

function InsightCard({ title, amount, date, category, icon, color, isFloor, currencySymbol, onClick }: { title: string, amount: number, date: string, category?: string, icon: React.ReactNode, color: 'rose' | 'emerald' | 'indigo' | 'slate', isFloor?: boolean, currencySymbol: string, onClick?: () => void }) {
  const colorClasses = {
    rose: 'bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100/50',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100/50',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100/50',
    slate: 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
  };

  return (
    <button 
      onClick={onClick}
      className={`p-4 rounded-xl border ${colorClasses[color]} flex flex-col gap-3 relative overflow-hidden group text-left transition-all duration-300 transform hover:-translate-y-1 active:scale-95`}
    >
      <div className="flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${color === 'rose' ? 'bg-rose-100' : color === 'emerald' ? 'bg-emerald-100' : color === 'indigo' ? 'bg-indigo-100' : 'bg-slate-200'}`}>
            {icon}
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest opacity-80">{title}</span>
        </div>
        {isFloor && (
          <div className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[8px] font-bold uppercase tracking-widest">
            Min Points
          </div>
        )}
      </div>

      <div className="z-10">
        <p className="text-xl font-mono font-black tracking-tighter">
          {amount < 0 ? '-' : ''}{currencySymbol}{Math.abs(amount).toLocaleString()}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <Calendar className="w-2.5 h-2.5 opacity-50" />
          <span className="text-[10px] font-bold opacity-60">{date}</span>
          {category && (
            <>
              <span className="w-1 h-1 rounded-full bg-current opacity-20" />
              <span className="text-[10px] font-bold uppercase tracking-tight opacity-60 truncate">{category}</span>
            </>
          )}
        </div>
      </div>

      {/* Decorative Background Element */}
      <div className="absolute -right-4 -bottom-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity">
        {React.cloneElement(icon as React.ReactElement, { size: 80 })}
      </div>
    </button>
  );
}
