import React, { useEffect, useState, useMemo } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot, orderBy, deleteDoc, doc, setDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { Transaction, SavingsStrategy, AssetLiability } from '../types';
import { Trash2, ArrowUpRight, ArrowDownRight, Search, Filter, RotateCcw, ChevronUp, ChevronDown, CalendarClock, PiggyBank, Briefcase, PlusCircle } from 'lucide-react';
import { format, parseISO, addDays, addWeeks, addMonths, addYears, isAfter, isBefore, startOfDay, endOfDay, getDate, setDate, getDaysInMonth } from 'date-fns';
import { handleFirestoreError, OperationType } from '../lib/firebase';
import { isStrategyExecutionDay } from '../utils/date';
import { generateLedger } from '../utils/transactions';
import { ConfirmDialog } from './ConfirmDialog';
import { ActionDialog } from './ActionDialog';

export const BalanceSheet: React.FC<{ onEdit?: (t: Transaction) => void, onShowAdd?: () => void }> = ({ onEdit, onShowAdd }) => {
  const { user, profile } = useAuth();
  const [baseTransactions, setBaseTransactions] = useState<Transaction[]>([]);
  const [strategies, setStrategies] = useState<SavingsStrategy[]>([]);
  const [assets, setAssets] = useState<AssetLiability[]>([]);
  const [processedTransactions, setProcessedTransactions] = useState<(Transaction & { runningBalance?: number; isProjected?: boolean; strategyName?: string })[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'date', direction: 'asc' });

  // Dialog States
  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; transaction: (Transaction & { isProjected?: boolean; strategyName?: string }) | null }>({ isOpen: false, transaction: null });
  const [actionDialog, setActionDialog] = useState<{ isOpen: boolean; transaction: (Transaction & { isProjected?: boolean; strategyName?: string }) | null }>({ isOpen: false, transaction: null });

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
      orderBy('date', 'asc')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Transaction[];
      setBaseTransactions(data);
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
      setAssets(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AssetLiability)));
    });

    return () => {
      unsub();
      unsubStrategies();
      unsubAssets();
    };
  }, [user]);

  useEffect(() => {
    if (baseTransactions.length === 0) {
      setProcessedTransactions([]);
      return;
    }

    const today = startOfDay(new Date());
    const projectionEnd = addYears(today, 1);
    
    const oldestDate = baseTransactions.length > 0 
      ? Math.min(...baseTransactions.map(t => parseISO(t.date).getTime())) 
      : today.getTime();
    
    // Use true oldest date as start, or fallback
    const startDate = new Date(oldestDate);

    const ledger = generateLedger(baseTransactions, strategies, assets, startDate, projectionEnd);

    // Flat map the ledger into a list of transactions for the table
    const final: (Transaction & { runningBalance?: number; isProjected?: boolean; strategyName?: string; occurrenceId?: string; isSavingsRelated?: boolean; isAssetRelated?: boolean })[] = [];
    
    ledger.forEach(day => {
      // Calculate start balance for the day to show intermediate steps if needed
      let currentIterBalance = (final.length > 0 ? final[final.length - 1].runningBalance : 0) || 0;

      day.transactions.forEach(t => {
        const isProjected = isAfter(day.date, today) || (t.isRecurring && parseISO(t.date).getTime() < parseISO(day.dateStr).getTime());
        const dStr = day.dateStr;

        if (t.fundedBySavings && t.type === 'expense') {
          const drawdown = day.savingsDrawdowns.find(sd => sd.transactionId === (t.id || `funded-${t.description}`));
          if (drawdown) {
            currentIterBalance += drawdown.amount;
            final.push({
              userId: user?.uid || '',
              type: 'income',
              category: 'Savings Drawdown',
              amount: drawdown.amount,
              description: `Funding for ${t.category}: ${t.description}`,
              date: day.date.toISOString(),
              isRecurring: false,
              frequency: 'none',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              isProjected,
              isSavingsRelated: true,
              occurrenceId: `drawdown-${drawdown.transactionId}-${dStr}`,
              runningBalance: currentIterBalance
            });
          }
        }

        if (t.fundedByAssetId && t.type === 'expense') {
          const drawdown = day.assetDrawdowns.find(ad => ad.transactionId === (t.id || `asset-funded-${t.description}`));
          if (drawdown) {
            const assetName = assets.find(a => a.id === drawdown.assetId)?.name || 'Asset';
            currentIterBalance += drawdown.amount;
            final.push({
              userId: user?.uid || '',
              type: 'income',
              category: 'Asset Funding',
              amount: drawdown.amount,
              description: `Funding for ${t.category}: ${t.description} (from ${assetName})`,
              date: day.date.toISOString(),
              isRecurring: false,
              frequency: 'none',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              isProjected,
              isAssetRelated: true,
              occurrenceId: `asset-drawdown-${drawdown.transactionId}-${dStr}`,
              runningBalance: currentIterBalance
            });
          }
        }

        if (t.type === 'income') currentIterBalance += t.amount;
        else {
          // If funded, we already added the savings portion to main balance, now we subtract the full amount
          currentIterBalance -= t.amount;
        }

        final.push({
          ...t,
          date: day.date.toISOString(),
          runningBalance: currentIterBalance,
          isProjected,
          occurrenceId: t.id ? `${t.id}-${dStr}` : `tx-${dStr}-${Math.random()}`
        });
      });

      if (day.savingsStrategiesSwept && day.savingsStrategiesSwept.length > 0) {
        day.savingsStrategiesSwept.forEach(sw => {
          currentIterBalance -= sw.amount;
          final.push({
            userId: user?.uid || '',
            type: 'expense',
            category: 'Savings',
            amount: sw.amount,
            description: `Automated Policy: ${sw.name}`,
            date: day.date.toISOString(),
            isRecurring: true,
            frequency: 'monthly',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isProjected: true,
            strategyName: sw.name,
            isSavingsRelated: true,
            occurrenceId: `savings-${sw.name}-${day.dateStr}`,
            runningBalance: currentIterBalance
          });
        });
      }
    });

    setProcessedTransactions(final);
  }, [baseTransactions, strategies, user]);

  const filteredAndSorted = useMemo(() => {
    const result = processedTransactions.filter(t => {
      const matchesSearch = t.category.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           t.description.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesFilter = filter === 'all' || t.type === filter;
      return matchesSearch && matchesFilter;
    });

    return [...result].sort((a, b) => {
      let aValue: any = a[sortConfig.key as keyof typeof a];
      let bValue: any = b[sortConfig.key as keyof typeof b];

      if (sortConfig.key === 'date') {
        const valA = new Date(aValue).getTime();
        const valB = new Date(bValue).getTime();
        return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
      }

      if (typeof aValue === 'string') {
        const comp = aValue.localeCompare(bValue);
        return sortConfig.direction === 'asc' ? comp : -comp;
      }

      if (typeof aValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      return 0;
    });
  }, [processedTransactions, searchTerm, filter, sortConfig]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: string) => {
    if (sortConfig.key !== key) return null;
    return sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3 ml-1 inline-block" /> : <ChevronDown className="w-3 h-3 ml-1 inline-block" />;
  };

  const handleDelete = async (t: Transaction & { isProjected?: boolean; strategyName?: string }) => {
    if (!t.id) return;

    if (t.strategyName) {
      alert('This is a virtual transaction generated by your Savings Policy. Policy entries are automated based on your active Lab policies. To modify them, adjust your strategies in the Savings tab.');
      return;
    }

    if (t.isRecurring) {
      setActionDialog({ isOpen: true, transaction: t });
      return;
    }

    setDeleteDialog({ isOpen: true, transaction: t });
  };

  const confirmDeleteSeries = async () => {
    const t = actionDialog.transaction;
    if (!t?.id) return;
    try {
      const qAsset = query(collection(db, 'assets'), where('userId', '==', user?.uid), where('linkedTransactionIds', 'array-contains', t.id));
      const assetSnap = await getDocs(qAsset);
      for (const a of assetSnap.docs) {
        await deleteDoc(doc(db, 'assets', a.id));
      }
      await deleteDoc(doc(db, 'transactions', t.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `transactions/${t.id}`);
    }
    setActionDialog({ isOpen: false, transaction: null });
  };

  const confirmDeleteOccurrence = async () => {
    const t = actionDialog.transaction;
    if (!t?.id) return;
    try {
      const originalRef = doc(db, 'transactions', t.id);
      const currentExcluded = t.excludedDates || [];
      const occurrenceDate = t.date; // Use the specific occurrence date
      await setDoc(originalRef, {
        excludedDates: [...currentExcluded, occurrenceDate],
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `transactions/${t.id}`);
    }
    setActionDialog({ isOpen: false, transaction: null });
  };

  const confirmDeleteSpot = async () => {
    const t = deleteDialog.transaction;
    if (!t?.id) return;
    try {
      const qAsset = query(collection(db, 'assets'), where('userId', '==', user?.uid), where('linkedTransactionIds', 'array-contains', t.id));
      const assetSnap = await getDocs(qAsset);
      for (const a of assetSnap.docs) {
        await deleteDoc(doc(db, 'assets', a.id));
      }
      await deleteDoc(doc(db, 'transactions', t.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `transactions/${t.id}`);
    }
    setDeleteDialog({ isOpen: false, transaction: null });
  };

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const desktopTodayRef = React.useRef<HTMLTableRowElement>(null);
  const mobileTodayRef = React.useRef<HTMLDivElement>(null);
  const [hasScrolled, setHasScrolled] = useState(false);

  useEffect(() => {
    if (!hasScrolled && filteredAndSorted.length > 0) {
      if (desktopTodayRef.current || mobileTodayRef.current) {
        setTimeout(() => {
          const isMobile = window.innerWidth < 768;
          const refToScroll = isMobile ? mobileTodayRef.current : desktopTodayRef.current;
          refToScroll?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
          setHasScrolled(true);
        }, 100);
      }
    }
  }, [filteredAndSorted, hasScrolled]);

  const closestToTodayId = useMemo(() => {
    const todayNum = startOfDay(new Date()).getTime();
    let closestId = null;
    let minDiff = Infinity;
    
    for (const t of filteredAndSorted) {
      const d = parseISO(t.date).getTime();
      const diff = d - todayNum;
      if (diff >= 0 && diff < minDiff) {
        minDiff = diff;
        closestId = t.occurrenceId || t.id;
      }
    }
    return closestId;
  }, [filteredAndSorted]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Financial Ledger</h2>
          <p className="text-xs text-slate-400 font-mono uppercase tracking-wider">Detailed transaction record</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onShowAdd}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
          >
            <PlusCircle className="w-4 h-4" /> New Entry
          </button>
          <div className="flex items-center gap-2 p-1 bg-white border border-slate-200 rounded-lg shadow-sm overflow-x-auto no-scrollbar whitespace-nowrap">
             <FilterButton label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
             <FilterButton label="Receivables" active={filter === 'income'} onClick={() => setFilter('income')} />
             <FilterButton label="Payables" active={filter === 'expense'} onClick={() => setFilter('expense')} />
          </div>
        </div>
      </div>

      <div className="bg-white flex flex-col rounded-xl border border-slate-200 shadow-sm overflow-hidden h-[calc(100vh-14rem)] min-h-[500px]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-4 bg-slate-50/30 shrink-0">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search entries..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-medium text-slate-600 placeholder:text-slate-300 outline-none"
          />
        </div>

        <div className="overflow-y-auto overflow-x-auto flex-1 custom-scrollbar relative" ref={scrollContainerRef}>
          {/* Desktop Table View */}
          <table className="w-full text-left border-collapse hidden md:table">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50/95 backdrop-blur text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-200 shadow-sm">
                <th className="px-6 py-4 font-bold cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('date')}>
                  <div className="flex items-center">
                    Date {getSortIcon('date')}
                  </div>
                </th>
                <th className="px-6 py-4 font-bold cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('category')}>
                  <div className="flex items-center">
                    Category {getSortIcon('category')}
                  </div>
                </th>
                <th className="px-6 py-4 font-bold cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('frequency')}>
                  <div className="flex items-center">
                    Strategy {getSortIcon('frequency')}
                  </div>
                </th>
                <th className="px-6 py-4 text-right font-bold cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('amount')}>
                  <div className="flex items-center justify-end">
                    Amount {getSortIcon('amount')}
                  </div>
                </th>
                <th className="px-6 py-4 text-right font-bold cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort('runningBalance')}>
                  <div className="flex items-center justify-end">
                    Balance {getSortIcon('runningBalance')}
                  </div>
                </th>
                <th className="px-6 py-4 text-center font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAndSorted.map((t) => {
                const isClosest = closestToTodayId === (t.occurrenceId || t.id);
                const isTodayTx = t.date.startsWith(format(new Date(), 'yyyy-MM-dd'));
                
                return (
                <tr 
                  key={t.occurrenceId || t.id} 
                  ref={isClosest ? desktopTodayRef : null}
                  className={`transition-colors group cursor-pointer ${
                    t.isProjected 
                      ? isTodayTx ? 'bg-amber-50/80 hover:bg-amber-100 font-italic text-slate-500' : 'bg-slate-50/50 hover:bg-slate-100 font-italic text-slate-500' 
                      : isTodayTx ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-slate-50'
                  }`}
                  onClick={() => onEdit?.(t)}
                >
                  <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-mono font-bold text-slate-900">
                    {format(parseISO(t.date), 'dd MMM yyyy')}
                  </p>
                  {t.isProjected && (
                    <span className={`flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-widest ${t.strategyName ? 'bg-emerald-100 text-emerald-700' : (t.isSavingsRelated || t.isAssetRelated) ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'}`}>
                      {t.strategyName ? <PiggyBank className="w-2 h-2" /> : (t.isSavingsRelated || t.isAssetRelated) ? <Briefcase className="w-2 h-2" /> : <CalendarClock className="w-2 h-2" />}
                      {t.strategyName ? 'Snapshot' : (t.isSavingsRelated || t.isAssetRelated) ? 'Internal' : 'Projected'}
                    </span>
                  )}
                </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${t.isProjected ? 'text-slate-500' : 'text-slate-800'}`}>
                          {t.category}
                        </span>
                        {(t.fundedBySavings || t.isSavingsRelated) && (
                           <span className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-widest bg-emerald-100 text-emerald-700">
                             <PiggyBank className="w-2 h-2" />
                             Savings
                           </span>
                        )}
                        {(t.linkedAssetId) && (
                           <span className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-widest bg-rose-100 text-rose-700">
                             <ArrowUpRight className="w-2 h-2" />
                             Settles: {assets.find(a => a.id === t.linkedAssetId)?.name?.slice(0,10) || 'Asset'}
                           </span>
                        )}
                        {(t.fundedByAssetId || t.isAssetRelated) && (
                           <span className="flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-widest bg-indigo-100 text-indigo-700">
                             <Briefcase className="w-2 h-2" />
                             {t.fundedByAssetId ? `From: ${assets.find(a => a.id === t.fundedByAssetId)?.name?.slice(0,10) || 'Asset'}` : 'Asset'}
                           </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 truncate max-w-[200px]">
                        {t.description || 'No description provided'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tighter ${
                      t.isRecurring 
                        ? (t.isProjected ? 'bg-slate-200 text-slate-600' : 'bg-indigo-100 text-indigo-700') 
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {t.isRecurring ? t.frequency : 'Spot'}
                    </span>
                  </td>
                  <td className={`px-6 py-4 text-right font-mono font-bold text-sm ${
                    t.isProjected 
                      ? (t.type === 'income' ? 'text-emerald-400' : 'text-rose-400')
                      : (t.type === 'income' ? 'text-emerald-600' : 'text-rose-600')
                  }`}>
                    {t.type === 'income' ? '+' : '-'}{currencySymbol}{t.amount.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <p className={`text-xs font-mono font-bold ${t.isProjected ? 'text-slate-400' : 'text-slate-900'}`}>
                      {currencySymbol}{t.runningBalance?.toLocaleString()}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!t.strategyName && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit?.(t);
                          }}
                          className="p-1.5 text-slate-300 hover:text-indigo-600 transition-colors"
                          title="Edit Transaction"
                        >
                          <ChevronUp className="w-4 h-4 rotate-90" />
                        </button>
                      )}
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(t);
                        }}
                        className="p-1.5 text-slate-300 hover:text-rose-600 transition-colors"
                        title={t.isProjected ? "Exclude instance" : "Delete transaction"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>

          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-slate-100">
            {filteredAndSorted.map((t) => {
              const isClosest = closestToTodayId === (t.occurrenceId || t.id);
              const isTodayTx = t.date.startsWith(format(new Date(), 'yyyy-MM-dd'));
              
              return (
              <div 
                key={t.occurrenceId || t.id} 
                ref={isClosest ? mobileTodayRef : null}
                className={`p-4 space-y-3 cursor-pointer transition-colors ${
                  t.isProjected 
                    ? isTodayTx ? 'bg-amber-50/80 active:bg-amber-100' : 'bg-slate-50/50 active:bg-slate-100' 
                    : isTodayTx ? 'bg-amber-50 active:bg-amber-100' : 'active:bg-slate-50'
                }`}
                onClick={() => onEdit?.(t)}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-[10px] font-mono font-bold text-slate-400 uppercase">
                        {format(parseISO(t.date), 'dd MMM yyyy')}
                      </p>
                      {t.isProjected && (
                        <span className={`text-[7px] px-1 py-0.5 rounded font-bold uppercase ${t.strategyName ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                          {t.strategyName ? 'Snapshot' : 'Projected'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <h4 className={`text-sm font-bold ${t.isProjected ? 'text-slate-500' : 'text-slate-900'}`}>
                        {t.category}
                      </h4>
                      {t.fundedBySavings && (
                         <span className="flex items-center gap-1 text-[7px] px-1 py-0.5 rounded font-bold uppercase bg-emerald-100 text-emerald-700">
                           <PiggyBank className="w-2 h-2" />
                           Savings
                         </span>
                      )}
                      {(t.linkedAssetId) && (
                           <span className="flex items-center gap-1 text-[7px] px-1 py-0.5 rounded-full font-bold uppercase tracking-widest bg-rose-100 text-rose-700">
                             <ArrowUpRight className="w-2 h-2" />
                             Settles: {assets.find(a => a.id === t.linkedAssetId)?.name?.slice(0,10) || 'Asset'}
                           </span>
                      )}
                      {(t.fundedByAssetId || t.isAssetRelated) && (
                         <span className="flex items-center gap-1 text-[7px] px-1 py-0.5 rounded-full font-bold uppercase tracking-widest bg-indigo-100 text-indigo-700">
                           <Briefcase className="w-2 h-2" />
                           {t.fundedByAssetId ? `From: ${assets.find(a => a.id === t.fundedByAssetId)?.name?.slice(0,10) || 'Asset'}` : 'Asset'}
                         </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-mono font-bold ${
                      t.isProjected 
                        ? (t.type === 'income' ? 'text-emerald-400' : 'text-rose-400')
                        : (t.type === 'income' ? 'text-emerald-600' : 'text-rose-600')
                    }`}>
                      {t.type === 'income' ? '+' : '-'}{currencySymbol}{t.amount.toLocaleString()}
                    </p>
                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                      Bal: {currencySymbol}{t.runningBalance?.toLocaleString()}
                    </p>
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-bold uppercase mt-1 ${
                      t.isRecurring 
                        ? (t.isProjected ? 'bg-slate-200 text-slate-600' : 'bg-indigo-100 text-indigo-700') 
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {t.isRecurring ? t.frequency : 'Spot'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[10px] text-slate-400 truncate flex-1">{t.description || 'No description'}</p>
                  <div className="flex items-center gap-1">
                    {!t.strategyName && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit?.(t);
                        }}
                        className="p-2 text-slate-300 active:text-indigo-600 font-bold"
                      >
                        <ChevronUp className="w-4 h-4 rotate-90" />
                      </button>
                    )}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(t);
                      }}
                      className="p-2 text-slate-300 active:text-rose-600 font-bold"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
            })}
          </div>

          {filteredAndSorted.length === 0 && (
            <div className="py-20 text-center">
              <p className="text-xs font-bold text-slate-300 uppercase tracking-widest">No entries found</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction? This action cannot be undone."
        onConfirm={confirmDeleteSpot}
        onCancel={() => setDeleteDialog({ isOpen: false, transaction: null })}
      />

      <ActionDialog
        isOpen={actionDialog.isOpen}
        title="Recurring Transaction"
        message="This is a recurring transaction. Pick how you want to handle the deletion."
        choices={[
          {
            id: 'occurrence',
            label: 'Delete This Occurrence Only',
            description: 'Exclude this specific date from the recurring schedule',
            isDestructive: false,
            onClick: confirmDeleteOccurrence
          },
          {
            id: 'series',
            label: 'Delete Entire Series',
            description: 'Remove all past and future occurrences',
            isDestructive: true,
            onClick: confirmDeleteSeries
          }
        ]}
        onCancel={() => setActionDialog({ isOpen: false, transaction: null })}
      />
    </div>
  );
};

function FilterButton({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
        active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-400 hover:text-slate-900'
      }`}
    >
      {label}
    </button>
  );
}
