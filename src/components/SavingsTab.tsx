import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { AssetLiability, SavingsStrategy, Transaction, Frequency } from '../types';
import { PiggyBank, Plus, Save, Trash2, ShieldCheck, Scale, Percent, Calendar, TrendingUp, History, CalendarClock, Settings2 } from 'lucide-react';
import { handleFirestoreError, OperationType } from '../lib/firebase';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, addMonths, addDays, startOfDay, isAfter, getDate, isBefore, getDaysInMonth } from 'date-fns';
import { isStrategyExecutionDay, toLocalDate } from '../utils/date';
import { generateLedger } from '../utils/transactions';

import { ConfirmDialog } from './ConfirmDialog';
export const SavingsTab: React.FC = () => {
  const { user, profile } = useAuth();
  const [strategies, setStrategies] = useState<SavingsStrategy[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [assets, setAssets] = useState<AssetLiability[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const formRef = React.useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState('6m');
  const [showConfirmDelete, setShowConfirmDelete] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const ranges = [
    { id: '1m', label: '1M' },
    { id: '3m', label: '3M' },
    { id: '6m', label: '6M' },
    { id: '1y', label: '1Y' },
  ];

  useEffect(() => {
    if (!user) return;
    
    const stratQ = query(
      collection(db, 'savings_strategies'),
      where('userId', '==', user.uid)
    );
    const unsubStrat = onSnapshot(stratQ, (snapshot) => {
      setStrategies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SavingsStrategy)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'savings_strategies');
    });

    const transQ = query(
      collection(db, 'transactions'),
      where('userId', '==', user.uid),
      orderBy('date', 'asc')
    );
    const unsubTrans = onSnapshot(transQ, (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
    });

    const assetsQ = query(collection(db, 'assets'), where('userId', '==', user.uid), where('isActive', '==', true));
    const unsubAssets = onSnapshot(assetsQ, (snapshot) => {
      setAssets(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AssetLiability)));
    });

    return () => {
      unsubStrat();
      unsubTrans();
      unsubAssets();
    };
  }, [user]);

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

  const savingsForecast = useMemo(() => {
    if (transactions.length === 0) return [];
    
    const today = startOfDay(new Date());
    
    let rangeDays = 180;
    switch (range) {
      case '1m': rangeDays = 30; break;
      case '3m': rangeDays = 90; break;
      case '6m': rangeDays = 180; break;
      case '1y': rangeDays = 365; break;
    }
    const nextDays = Array.from({ length: rangeDays }, (_, i) => addDays(today, i));
    const endDate = nextDays[nextDays.length - 1];
    
    const validTransactions = transactions.filter(t => t.date && !isNaN(toLocalDate(t.date).getTime()));
    const oldestDate = validTransactions.length > 0 
      ? Math.min(...validTransactions.map(t => toLocalDate(t.date).getTime())) 
      : today.getTime();
    const startDate = new Date(oldestDate);

    const ledger = generateLedger(validTransactions, strategies, assets, startDate, endDate);

    return nextDays.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const ledgerDay = ledger.find(ld => ld.dateStr === dateStr);
      const prevDay = [...ledger].reverse().find(ld => isBefore(ld.date, date));

      const drawdownsTotal = ledgerDay?.savingsDrawdowns?.reduce((sum, sd) => sum + sd.amount, 0) || 0;

      return {
        date: format(date, 'MMM dd'),
        fullDate: format(date, 'dd MMMM yyyy'),
        savings: ledgerDay ? ledgerDay.historicalSavings : (prevDay?.historicalSavings || 0),
        amount: ledgerDay ? ledgerDay.savingsDeduction : 0,
        strategy: ledgerDay?.savingsStrategiesSwept?.[0]?.name || '', // Simplified for tooltip
        drawdowns: ledgerDay?.savingsDrawdowns || [],
        drawdownsTotal
      };
    });
  }, [transactions, strategies, range]);

  // Form state
  const [name, setName] = useState('Monthly Reserve');
  const [calculationType, setCalculationType] = useState<'percentage' | 'fixed' | 'sweep'>('percentage');
  const [percentage, setPercentage] = useState(10);
  const [fixedAmount, setFixedAmount] = useState(1000);
  const [leaveAmount, setLeaveAmount] = useState(500);
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [dayOfMonth, setDayOfMonth] = useState(28);
  const [minAmount, setMinAmount] = useState(100);
  const [maxAmount, setMaxAmount] = useState(5000);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const parsedPercentage = Number(percentage);
    const parsedFixed = Number(fixedAmount);
    const parsedLeave = Number(leaveAmount);
    const parsedMin = Number(minAmount || 0);
    const parsedMax = Number(maxAmount || 0);

    if ((calculationType === 'percentage' && isNaN(parsedPercentage)) || 
        (calculationType === 'fixed' && isNaN(parsedFixed)) ||
        (calculationType === 'sweep' && isNaN(parsedLeave))) {
      setErrorMessage('Please enter valid numeric values for amounts');
      return;
    }
    
    setErrorMessage(null);

    setLoading(true);
    try {
      const data: any = {
        userId: user.uid,
        name: name.trim(),
        calculationType,
        percentage: calculationType === 'percentage' ? parsedPercentage : null,
        fixedAmount: calculationType === 'fixed' ? parsedFixed : null,
        leaveAmount: calculationType === 'sweep' ? parsedLeave : null,
        frequency,
        dayOfMonth: frequency === 'monthly' || frequency === 'yearly' ? dayOfMonth : 1,
        dayOfWeek: frequency === 'weekly' ? dayOfWeek : 0,
        minAmount: parsedMin,
        maxAmount: parsedMax,
        isActive: true,
        updatedAt: serverTimestamp()
      };

      if (editingId) {
        await updateDoc(doc(db, 'savings_strategies', editingId), data);
      } else {
        await addDoc(collection(db, 'savings_strategies'), data);
      }
      
      setIsAdding(false);
      setEditingId(null);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (s: SavingsStrategy) => {
    setName(s.name);
    setCalculationType(s.calculationType || 'percentage');
    setPercentage(s.percentage || 10);
    setFixedAmount(s.fixedAmount || 1000);
    setLeaveAmount(s.leaveAmount || 500);
    setFrequency(s.frequency || 'monthly');
    setDayOfWeek(s.dayOfWeek || 0);
    setDayOfMonth(s.dayOfMonth || 28);
    setMinAmount(s.minAmount || 0);
    setMaxAmount(s.maxAmount || 0);
    setEditingId(s.id || null);
    setIsAdding(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const resetForm = () => {
    setName('Monthly Reserve');
    setCalculationType('percentage');
    setPercentage(10);
    setFixedAmount(1000);
    setLeaveAmount(500);
    setDayOfMonth(28);
    setMinAmount(100);
    setMaxAmount(5000);
    setEditingId(null);
    setIsAdding(false);
  };

  const toggleActive = async (id: string, current: boolean) => {
    try {
      await updateDoc(doc(db, 'savings_strategies', id), {
        isActive: !current,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error(error);
    }
  };

  const deleteStrategy = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'savings_strategies', id));
      setShowConfirmDelete(null);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Savings Lab</h2>
          <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">Architecting capital preservation models</p>
        </div>
        <button
          onClick={() => {
            if (isAdding) {
              resetForm();
            } else {
              resetForm();
              setIsAdding(true);
            }
          }}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
        >
          {isAdding ? 'Cancel' : <><Plus className="w-4 h-4" /> New Strategy</>}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {isAdding && (
            <div ref={formRef} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="mb-4">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest">
                  {editingId ? 'Edit Configuration' : 'Strategy Definition'}
                </h3>
                {errorMessage && (
                  <p className="text-xs text-rose-500 font-bold mt-2">{errorMessage}</p>
                )}
              </div>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Strategy Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                      required
                    />
                  </div>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sweep Frequency</label>
                      <select
                        value={frequency}
                        onChange={(e) => setFrequency(e.target.value as Frequency)}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>

                    {frequency === 'weekly' && (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Day of Week</label>
                        <select
                          value={dayOfWeek}
                          onChange={(e) => setDayOfWeek(parseInt(e.target.value))}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                        >
                          <option value={0}>Sunday</option>
                          <option value={1}>Monday</option>
                          <option value={2}>Tuesday</option>
                          <option value={3}>Wednesday</option>
                          <option value={4}>Thursday</option>
                          <option value={5}>Friday</option>
                          <option value={6}>Saturday</option>
                        </select>
                      </div>
                    )}

                    {(frequency === 'monthly' || frequency === 'yearly') && (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Execution Day</label>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          value={dayOfMonth}
                          onChange={(e) => setDayOfMonth(parseInt(e.target.value))}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                          required
                        />
                      </div>
                    )}
                  </div>
                  
                  <div className="md:col-span-2 space-y-4 pt-4 border-t border-slate-100">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Deduction Model</label>
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <button
                          type="button"
                          onClick={() => setCalculationType('percentage')}
                          className={`p-4 rounded-xl text-left transition-all border ${calculationType === 'percentage' ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-2 h-2 rounded-full ${calculationType === 'percentage' ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                            <span className={`text-xs font-bold ${calculationType === 'percentage' ? 'text-indigo-900' : 'text-slate-700'}`}>Percentage</span>
                          </div>
                          <p className="text-[9px] text-slate-500 pl-4">Deduct % of available balance</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setCalculationType('fixed')}
                          className={`p-4 rounded-xl text-left transition-all border ${calculationType === 'fixed' ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-2 h-2 rounded-full ${calculationType === 'fixed' ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                            <span className={`text-xs font-bold ${calculationType === 'fixed' ? 'text-indigo-900' : 'text-slate-700'}`}>Fixed Amount</span>
                          </div>
                          <p className="text-[9px] text-slate-500 pl-4">Deduct a strict amount</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setCalculationType('sweep')}
                          className={`p-4 rounded-xl text-left transition-all border ${calculationType === 'sweep' ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'}`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-2 h-2 rounded-full ${calculationType === 'sweep' ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                            <span className={`text-xs font-bold ${calculationType === 'sweep' ? 'text-indigo-900' : 'text-slate-700'}`}>Sweep / Retain</span>
                          </div>
                          <p className="text-[9px] text-slate-500 pl-4">Sweep all but X amount</p>
                        </button>
                     </div>
                  </div>

                  {calculationType === 'percentage' && (
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-top-2">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Percentage Sweep (%)</label>
                      <div className="relative">
                        <Percent className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={percentage}
                          onChange={(e) => setPercentage(parseFloat(e.target.value))}
                          className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Lower Bound</label>
                       <input
                         type="number"
                         value={minAmount}
                         onChange={(e) => setMinAmount(parseFloat(e.target.value))}
                         className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                       />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Upper Bound</label>
                       <input
                         type="number"
                         value={maxAmount}
                         onChange={(e) => setMaxAmount(parseFloat(e.target.value))}
                         className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                       />
                    </div>
                  </div>
                  )}

                  {calculationType === 'fixed' && (
                    <div className="md:col-span-2 space-y-2 animate-in fade-in slide-in-from-top-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fixed Amount to Deduct</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-sm">{currencySymbol}</span>
                        <input
                          type="number"
                          min="0"
                          value={fixedAmount}
                          onChange={(e) => setFixedAmount(parseFloat(e.target.value))}
                          className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all font-mono font-bold"
                          required
                        />
                      </div>
                    </div>
                  )}

                  {calculationType === 'sweep' && (
                    <div className="md:col-span-2 space-y-2 animate-in fade-in slide-in-from-top-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Retain/Leave Amount in Ledger</label>
                       <div className="relative">
                         <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-sm">{currencySymbol}</span>
                         <input
                           type="number"
                           min="0"
                           value={leaveAmount}
                           onChange={(e) => setLeaveAmount(parseFloat(e.target.value))}
                           className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all font-mono font-bold"
                           required
                         />
                       </div>
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full py-4 rounded-lg text-xs font-bold uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-3 ${editingId ? 'bg-indigo-600 shadow-indigo-100 hover:bg-indigo-700' : 'bg-slate-900 shadow-slate-200 hover:bg-slate-800'} text-white`}
                >
                  <Save className="w-4 h-4" />
                  {loading ? 'Executing...' : editingId ? 'Update Policy' : 'Commit Strategy'}
                </button>
              </form>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 overflow-hidden">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Reserve Accretion</h3>
              </div>
              <div className="flex bg-slate-100 p-1 rounded-lg">
                {ranges.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRange(r.id)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-md transition-all ${
                      range === r.id
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={savingsForecast}>
                  <defs>
                    <linearGradient id="colorSavings" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                    tickFormatter={(value) => `${currencySymbol}${value >= 1000 ? (value/1000).toFixed(1) + 'k' : value}`}
                  />
                  <Tooltip 
                    cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-white/95 backdrop-blur-md border border-slate-200 p-4 rounded-xl shadow-2xl shadow-slate-200/50">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 border-b border-slate-100 pb-1.5">{data.fullDate}</p>
                            <div className="space-y-2">
                              <div>
                                <p className="text-[9px] text-slate-400 font-bold uppercase mb-0.5">Projected Reserve</p>
                                <p className="text-sm font-mono font-bold text-slate-900">{currencySymbol}{data.savings.toLocaleString()}</p>
                              </div>
                              <div className="pt-2 border-t border-slate-50 space-y-2">
                                {data.amount > 0 && (
                                  <div>
                                    <p className="text-[9px] text-indigo-500 font-bold uppercase mb-0.5">Increment ({data.strategy})</p>
                                    <p className="text-xs font-mono font-bold text-indigo-600">+{currencySymbol}{data.amount.toLocaleString()}</p>
                                  </div>
                                )}
                                {data.drawdownsTotal > 0 && (
                                  <div>
                                    <p className="text-[9px] text-rose-500 font-bold uppercase mb-0.5">Drawdown (Funding)</p>
                                    <p className="text-xs font-mono font-bold text-rose-600">-{currencySymbol}{data.drawdownsTotal.toLocaleString()}</p>
                                  </div>
                                )}
                                {data.amount === 0 && data.drawdownsTotal === 0 && (
                                  <p className="text-[9px] text-slate-400 font-bold uppercase">No activity today</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="savings" 
                    stroke="#6366f1" 
                    strokeWidth={3} 
                    fill="url(#colorSavings)" 
                    animationDuration={1500}
                    dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 6, fill: '#6366f1', strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <History className="w-4 h-4 text-slate-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-900">Savings Statement</h3>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase font-mono">Future snapshots</p>
            </div>
            <div className="divide-y divide-slate-50 max-h-[400px] overflow-auto">
              {savingsForecast.slice().reverse().filter(entry => (entry.amount > 0) || (entry.drawdownsTotal > 0)).map((entry, idx) => (
                <div key={idx} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors group">
                  <div className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-lg ${entry.amount > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'} flex items-center justify-center`}>
                      <CalendarClock className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800">
                        {entry.amount > 0 ? entry.strategy : 'Asset Funding Drawdown'}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono uppercase">{entry.date}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {entry.amount > 0 && (
                      <p className="text-sm font-mono font-bold text-emerald-600">+{currencySymbol}{entry.amount.toLocaleString()}</p>
                    )}
                    {entry.drawdownsTotal > 0 && (
                      <p className="text-sm font-mono font-bold text-rose-600">-{currencySymbol}{entry.drawdownsTotal.toLocaleString()}</p>
                    )}
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight">Cumulative: {currencySymbol}{entry.savings.toLocaleString()}</p>
                  </div>
                </div>
              ))}
              {savingsForecast.filter(e => e.amount > 0 || e.drawdownsTotal > 0).length === 0 && (
                <div className="py-20 text-center">
                  <p className="text-[10px] font-bold text-slate-300 uppercase">No projected sweeps detected</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 rounded-xl p-6 text-white shadow-xl shadow-slate-200">
             <div className="flex items-center gap-3 mb-6">
              <PiggyBank className="w-5 h-5 text-indigo-400" />
              <h3 className="text-sm font-bold uppercase tracking-widest">Reserve Status</h3>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Strategies Active</p>
                <p className="text-3xl font-bold font-mono text-white">{strategies.filter(s => s.isActive).length}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Projected 6M Growth</p>
                <p className="text-2xl font-bold font-mono text-emerald-400">
                   +{currencySymbol}{savingsForecast.length > 0 ? (savingsForecast[savingsForecast.length - 1].savings).toLocaleString() : '0'}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1">Policy Management</h3>
            {strategies.map((strategy) => (
              <div key={strategy.id} className={`bg-white rounded-xl border ${strategy.isActive ? 'border-indigo-100 shadow-indigo-50' : 'border-slate-200 opacity-75'} shadow-sm p-5 space-y-4 transition-all relative overflow-hidden group`}>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{strategy.name}</h3>
                    <p className="text-[10px] text-slate-400 font-mono uppercase mt-1">
                      {strategy.calculationType === 'fixed' 
                        ? `${currencySymbol}${strategy.fixedAmount} Deducted` 
                        : strategy.calculationType === 'sweep'
                          ? `Leave ${currencySymbol}${strategy.leaveAmount}`
                          : `${strategy.percentage}% Sweep`}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => strategy.id && toggleActive(strategy.id, strategy.isActive)}
                      className={`p-2 rounded-lg transition-colors ${strategy.isActive ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}
                    >
                      <ShieldCheck className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => startEdit(strategy)}
                      className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
                    >
                      <Settings2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => strategy.id && setShowConfirmDelete(strategy.id)}
                      className="p-2 bg-rose-50 text-rose-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 py-2 border-y border-slate-50">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    <p className="text-[10px] text-slate-400 font-bold capitalize">
                      {strategy.frequency === 'daily' ? 'Daily' : 
                       strategy.frequency === 'weekly' ? `Weekly (Day ${strategy.dayOfWeek})` : 
                       `${strategy.dayOfMonth}th Day (${strategy.frequency || 'Monthly'})`}
                    </p>
                  </div>
                  {(!strategy.calculationType || strategy.calculationType === 'percentage') && (
                  <div className="flex items-center gap-2">
                    <Scale className="w-3 h-3 text-slate-400" />
                    <p className="text-[10px] text-slate-400 font-bold">{currencySymbol}{strategy.minAmount}-{strategy.maxAmount}</p>
                  </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {strategies.length === 0 && !isAdding && (
            <div className="py-12 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
              <PiggyBank className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-[10px] text-slate-400 font-bold uppercase">No Active Policies</p>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        isOpen={!!showConfirmDelete}
        title="Delete Strategy"
        message="Are you sure you want to delete this savings strategy? This will affect projected balances, but not historical balances."
        onConfirm={() => showConfirmDelete && deleteStrategy(showConfirmDelete)}
        onCancel={() => setShowConfirmDelete(null)}
        confirmText="Delete"
        isDestructive={true}
      />
    </div>
  );
};
