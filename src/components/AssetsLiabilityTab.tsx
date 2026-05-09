import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy, getDocs, getDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { AssetLiability, Transaction } from '../types';
import { Briefcase, Plus, Save, Trash2, Landmark, TrendingUp, History, Info, ArrowDownLeft, ArrowUpRight, Scale, CalendarClock, CheckCircle2, ChevronRight, X, Calendar } from 'lucide-react';
import { handleFirestoreError, OperationType } from '../lib/firebase';
import { format, addMonths, addWeeks, addDays, isBefore, startOfTomorrow } from 'date-fns';
import { toLocalDate } from '../utils/date';
import { TransactionForm } from './TransactionForm';
import { ConfirmDialog } from './ConfirmDialog';

export const AssetsLiabilityTab: React.FC = () => {
  const { user, profile } = useAuth();
  const [assets, setAssets] = useState<AssetLiability[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [linkedTransactions, setLinkedTransactions] = useState<Record<string, Transaction[]>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [schedulingAsset, setSchedulingAsset] = useState<AssetLiability | null>(null);
  const [schedulePlan, setSchedulePlan] = useState<'whole' | 'installments' | 'custom' | 'freedom' | null>(null);
  const [installmentCount, setInstallmentCount] = useState<number>(6);
  const [settlementDate, setSettlementDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [freedomEntries, setFreedomEntries] = useState<{ amount: number; date: string }[]>([
    { amount: 0, date: new Date().toISOString().split('T')[0] }
  ]);
  const [showConfirmDelete, setShowConfirmDelete] = useState<string | null>(null);
  const [viewTransactionsForAsset, setViewTransactionsForAsset] = useState<AssetLiability | null>(null);

  const formRef = useRef<HTMLDivElement>(null);

  // Form State
  const [name, setName] = useState('');
  const [type, setType] = useState<'receivable' | 'payable' | 'asset' | 'liability'>('receivable');
  const [totalAmount, setTotalAmount] = useState('');
  const [currentBalance, setCurrentBalance] = useState('');
  const [description, setDescription] = useState('');

  const [fundedTransactions, setFundedTransactions] = useState<Record<string, Transaction[]>>({});

  useEffect(() => {
    if (!user) return;
    
    const qAssets = query(
      collection(db, 'assets'),
      where('userId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );
    const unsubAssets = onSnapshot(qAssets, (snapshot) => {
      setAssets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AssetLiability)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'assets');
    });

    const qTx = query(collection(db, 'transactions'), where('userId', '==', user.uid));
    const unsubTx = onSnapshot(qTx, (snapshot) => {
      const txs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      const linkedMapping: Record<string, Transaction[]> = {};
      const fundedMapping: Record<string, Transaction[]> = {};
      
      txs.forEach(t => {
        if (t.linkedAssetId) {
          if (!linkedMapping[t.linkedAssetId]) linkedMapping[t.linkedAssetId] = [];
          linkedMapping[t.linkedAssetId].push(t);
        }
        if (t.fundedByAssetId) {
          if (!fundedMapping[t.fundedByAssetId]) fundedMapping[t.fundedByAssetId] = [];
          fundedMapping[t.fundedByAssetId].push(t);
        }
      });
      setLinkedTransactions(linkedMapping);
      setFundedTransactions(fundedMapping);
    });

    return () => {
      unsubAssets();
      unsubTx();
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

  // Compute actual dynamic balances
  const dynamicAssets = useMemo(() => {
    return assets.map(asset => {
      let balanceChange = 0;
      const tDateLimit = startOfTomorrow();

      const linked = linkedTransactions[asset.id || ''] || [];
      const funded = fundedTransactions[asset.id || ''] || [];

      // 1. fundedTransactions (always expenses funded by an asset/receivable)
      // This means we took value OUT of the asset/receivable. Balance goes DOWN.
      const drawdowns = funded.reduce((sum, t) => {
        if (isBefore(toLocalDate(t.date), tDateLimit)) {
          return sum + (Number(t.amount) || 0);
        }
        return sum;
      }, 0);
      balanceChange -= drawdowns;

      // 2. linkedTransactions (transactions settling/funding this item)
      const linkedAmount = linked.reduce((sum, t) => {
        if (isBefore(toLocalDate(t.date), tDateLimit)) {
          if (t.type === 'income') {
             // Income from a receivable or asset -> reduces its balance
             return sum - (Number(t.amount) || 0);
          } else if (t.type === 'expense') {
             if (asset.type === 'asset') {
                // Expense funding an asset -> increases its balance
                return sum + (Number(t.amount) || 0);
             } else {
                // Expense settling a liability/payable -> reduces its balance
                return sum - (Number(t.amount) || 0);
             }
          }
        }
        return sum;
      }, 0);

      balanceChange += linkedAmount;

      return {
        ...asset,
        currentBalance: Math.max(0, asset.currentBalance + balanceChange)
      };
    });
  }, [assets, linkedTransactions, fundedTransactions]);

  const stats = useMemo(() => {
    const receivables = dynamicAssets.filter(a => a.type === 'receivable' && a.isActive).reduce((sum, a) => sum + a.currentBalance, 0);
    const payables = dynamicAssets.filter(a => a.type === 'payable' && a.isActive).reduce((sum, a) => sum + a.currentBalance, 0);
    const nonLiquidAssets = dynamicAssets.filter(a => a.type === 'asset' && a.isActive).reduce((sum, a) => sum + a.currentBalance, 0);
    const liabilities = dynamicAssets.filter(a => a.type === 'liability' && a.isActive).reduce((sum, a) => sum + a.currentBalance, 0);
    
    return {
      netPosition: (receivables + nonLiquidAssets) - (payables + liabilities),
      receivables,
      payables,
      nonLiquidAssets,
      liabilities
    };
  }, [dynamicAssets]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const balanceVal = parseFloat(currentBalance);
    const totalVal = type === 'asset' ? balanceVal : parseFloat(totalAmount);

    if (isNaN(balanceVal) || (type !== 'asset' && isNaN(totalVal))) {
      alert('Please enter valid numeric values for total amount and current balance');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data: any = {
        userId: user.uid,
        name: name.trim(),
        type,
        totalAmount: totalVal,
        currentBalance: balanceVal,
        description: description.trim(),
        isActive: true,
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        await updateDoc(doc(db, 'assets', editingId), data);
        const assetRef = doc(db, 'assets', editingId);
        const snap = await getDoc(assetRef);
        if (snap.exists() && snap.data().linkedTransactionIds && Array.isArray(snap.data().linkedTransactionIds)) {
          for (const txId of snap.data().linkedTransactionIds) {
            await updateDoc(doc(db, 'transactions', txId), {
              amount: balanceVal,
              category: name.trim(),
              updatedAt: serverTimestamp()
            });
          }
        }
      } else {
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, 'assets'), data);
      }
      
      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'assets');
    } finally {
      setLoading(false);
    }
  };

  const handleSchedule = async () => {
    if (!user || !schedulingAsset) return;
    setLoading(true);
    try {
      const type: 'income' | 'expense' = schedulingAsset.type === 'receivable' || schedulingAsset.type === 'asset' ? 'income' : 'expense';
      
      if (schedulePlan === 'whole') {
        await addDoc(collection(db, 'transactions'), {
          userId: user.uid,
          type,
          amount: schedulingAsset.currentBalance,
          category: `Settlement: ${schedulingAsset.name}`,
          description: `Full settlement of ${schedulingAsset.type} position`,
          date: new Date(settlementDate).toISOString(),
          isRecurring: false,
          frequency: 'none',
          linkedAssetId: schedulingAsset.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (schedulePlan === 'installments') {
        const amountPer = schedulingAsset.currentBalance / installmentCount;
        const start = new Date();
        const end = addMonths(start, installmentCount - 1);

        await addDoc(collection(db, 'transactions'), {
          userId: user.uid,
          type,
          amount: amountPer,
          category: `Installment: ${schedulingAsset.name}`,
          description: `Scheduled ${installmentCount}-month installment plan`,
          date: start.toISOString(),
          isRecurring: true,
          frequency: 'monthly',
          dayOfMonth: start.getDate(),
          endDate: end.toISOString(),
          linkedAssetId: schedulingAsset.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (schedulePlan === 'freedom') {
        for (const entry of freedomEntries) {
          if (entry.amount <= 0) continue;
          await addDoc(collection(db, 'transactions'), {
            userId: user.uid,
            type,
            amount: entry.amount,
            category: `Partial: ${schedulingAsset.name}`,
            description: `Manual freedom-plan settlement`,
            date: new Date(entry.date).toISOString(),
            isRecurring: false,
            frequency: 'none',
            linkedAssetId: schedulingAsset.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      
      setSchedulingAsset(null);
      setSchedulePlan(null);
      setFreedomEntries([{ amount: 0, date: new Date().toISOString().split('T')[0] }]);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'transactions');
    } finally {
      setLoading(false);
    }
  };

  const handleNewPosition = () => {
    resetForm();
    setIsAdding(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const startEdit = (a: AssetLiability) => {
    setName(a.name);
    setType(a.type);
    setTotalAmount(a.totalAmount.toString());
    setCurrentBalance(a.currentBalance.toString());
    setDescription(a.description);
    setEditingId(a.id || null);
    setIsAdding(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const resetForm = () => {
    setName('');
    setType('receivable');
    setTotalAmount('');
    setCurrentBalance('');
    setDescription('');
    setEditingId(null);
    setIsAdding(false);
  };

  const toggleActive = async (id: string, current: boolean) => {
    try {
      await updateDoc(doc(db, 'assets', id), {
        isActive: !current,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error(error);
    }
  };

  const displayFilteredAssets = useMemo(() => {
    return dynamicAssets.filter(asset => {
      // 1. Type filter
      if (filterType !== 'all' && asset.type !== filterType) return false;
      
      // 2. Status filter
      const isSettled = asset.type !== 'asset' && asset.currentBalance <= 0;
      let status = 'unscheduled';
      if (isSettled) {
        status = 'settled';
      } else if (asset.id && linkedTransactions[asset.id]?.some(t => {
          const tDateLimit = startOfTomorrow();
          if (t.isRecurring) {
            if (t.endDate) {
              return !isBefore(toLocalDate(t.endDate), tDateLimit);
            }
            return true;
          }
          return !isBefore(toLocalDate(t.date), tDateLimit);
        })) {
        status = 'scheduled';
      }
      
      if (filterStatus !== 'all' && status !== filterStatus) return false;
      
      return true;
    });
  }, [dynamicAssets, filterType, filterStatus, linkedTransactions]);

  const deleteAsset = async (id: string) => {
    setLoading(true);
    try {
      const assetDocRef = doc(db, 'assets', id);
      const assetSnap = await getDoc(assetDocRef);
      if (assetSnap.exists()) {
        const data = assetSnap.data();
        if (data.linkedTransactionIds && Array.isArray(data.linkedTransactionIds)) {
          for (const txId of data.linkedTransactionIds) {
            await deleteDoc(doc(db, 'transactions', txId));
          }
        }
      }
      
      await deleteDoc(assetDocRef);
      
      // Also delete linked or funded transactions to maintain consistency
      const qTx = query(collection(db, 'transactions'), where('userId', '==', user?.uid), where('linkedAssetId', '==', id));
      const txSnap = await getDocs(qTx);
      for (const t of txSnap.docs) {
        await deleteDoc(doc(db, 'transactions', t.id));
      }
      
      const qTxFunded = query(collection(db, 'transactions'), where('userId', '==', user?.uid), where('fundedByAssetId', '==', id));
      const txFundedSnap = await getDocs(qTxFunded);
      for (const t of txFundedSnap.docs) {
        await deleteDoc(doc(db, 'transactions', t.id));
      }
      
      setShowConfirmDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `assets/${id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">External Capital</h2>
          <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">Managing unscheduled receivables & non-liquid positions</p>
        </div>
        <button
          onClick={() => isAdding ? resetForm() : handleNewPosition()}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
        >
          {isAdding ? 'Cancel' : <><Plus className="w-4 h-4" /> Register Position</>}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-slate-900 rounded-xl p-6 text-white shadow-xl shadow-slate-200">
            <div className="flex items-center gap-3 mb-6">
              <Scale className="w-5 h-5 text-indigo-400" />
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">Net Standing</h3>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Total Net Equity</p>
                <p className={`text-3xl font-bold font-mono ${stats.netPosition >= 0 ? 'text-white' : 'text-rose-400'}`}>
                  {stats.netPosition >= 0 ? '+' : ''}{currencySymbol}{stats.netPosition.toLocaleString()}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 pt-3 border-t border-slate-800">
                <div className="flex items-center justify-between">
                   <p className="text-[9px] text-slate-500 font-bold uppercase">Receivables</p>
                   <p className="text-xs font-mono font-bold text-emerald-400">+{currencySymbol}{stats.receivables.toLocaleString()}</p>
                </div>
                <div className="flex items-center justify-between">
                   <p className="text-[9px] text-slate-500 font-bold uppercase">Other Assets</p>
                   <p className="text-xs font-mono font-bold text-indigo-400">+{currencySymbol}{stats.nonLiquidAssets.toLocaleString()}</p>
                </div>
                <div className="flex items-center justify-between">
                   <p className="text-[9px] text-slate-500 font-bold uppercase">Direct Liabilities</p>
                   <p className="text-xs font-mono font-bold text-rose-400">-{currencySymbol}{(stats.payables + stats.liabilities).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-3.5 h-3.5 text-slate-400" />
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Protocol Tip</h4>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500 italic">
              "External capital refers to funds not currently in your liquid ledger. This includes business loans, property equity, or informal receivables. Use the 'Funding' option in the ledger to draw against these for expenses."
            </p>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-6">
          {isAdding && (
            <div ref={formRef} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest">
                  {editingId ? 'Modify Position' : 'Registration Protocol'}
                </h3>
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Landmark className="w-4 h-4" />
                </div>
              </div>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Entity Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-indigo-500/10 outline-none transition-all"
                      placeholder="e.g. Loan to John, MacBook Pro Equity..."
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Position Type</label>
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value as any)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold uppercase tracking-tight focus:ring-2 focus:ring-indigo-500/10 outline-none transition-all"
                    >
                      <option value="receivable">Receivable (Money Owed to You)</option>
                      <option value="payable">Payable (Money You Owe)</option>
                      <option value="asset">Physical/Financial Asset</option>
                      <option value="liability">General Liability</option>
                    </select>
                  </div>
                  {type !== 'asset' && (
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Initial Value</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 font-mono text-sm">{currencySymbol}</span>
                        <input
                          type="number"
                          step="0.01"
                          value={totalAmount}
                          onChange={(e) => setTotalAmount(e.target.value)}
                          className="w-full pl-8 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold font-mono focus:ring-2 focus:ring-indigo-500/10 outline-none transition-all"
                          required
                        />
                      </div>
                    </div>
                  )}
                  <div className={`${type === 'asset' ? 'md:col-span-2' : ''} space-y-2`}>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      {type === 'asset' ? 'Current Valuation' : 'Current Outstanding Balance'}
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 font-mono text-sm">{currencySymbol}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={currentBalance}
                        onChange={(e) => setCurrentBalance(e.target.value)}
                        className="w-full pl-8 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold font-mono focus:ring-2 focus:ring-indigo-500/10 outline-none transition-all"
                        required
                      />
                    </div>
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Context & Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-indigo-500/10 outline-none transition-all h-20 resize-none"
                      placeholder="Specify terms, liquidation constraints, or parties involved..."
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-[2] py-4 bg-slate-900 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-100 flex items-center justify-center gap-3"
                  >
                    <Save className="w-4 h-4" />
                    {loading ? 'Processing...' : editingId ? 'Update Position' : 'Commit Strategy'}
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="flex-1 py-4 bg-slate-100 text-slate-500 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-200 transition-all font-mono"
                  >
                    Discard
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="space-y-4">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
               <div className="flex items-center gap-3 px-1">
                  <History className="w-4 h-4 text-slate-400" />
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Ledger Positions</h3>
               </div>
               
               <div className="flex flex-wrap items-center gap-2 lg:gap-4">
                 <div className="flex bg-slate-100/50 p-1 rounded-lg">
                   {['all', 'payable', 'receivable', 'asset'].map(f => (
                     <button
                       key={f}
                       onClick={() => setFilterType(f)}
                       className={`px-3 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-widest transition-all ${
                         filterType === f 
                           ? 'bg-white text-indigo-600 shadow-sm' 
                           : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                       }`}
                     >
                       {f}
                     </button>
                   ))}
                 </div>
                 
                 <div className="flex bg-slate-100/50 p-1 rounded-lg">
                   {['all', 'settled', 'scheduled', 'unscheduled'].map(f => (
                     <button
                       key={f}
                       onClick={() => setFilterStatus(f)}
                       className={`px-3 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-widest transition-all ${
                         filterStatus === f 
                           ? 'bg-white text-indigo-600 shadow-sm' 
                           : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                       }`}
                     >
                       {f}
                     </button>
                   ))}
                 </div>
               </div>
             </div>
             
             {displayFilteredAssets.length > 0 ? (
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {displayFilteredAssets.map(asset => {
                   const isSettled = asset.type !== 'asset' && asset.currentBalance <= 0;
                   return (
                   <div 
                    key={asset.id} 
                    onClick={() => setViewTransactionsForAsset(asset)}
                    className={`cursor-pointer bg-white border ${asset.isActive ? 'border-slate-200 hover:border-slate-300' : 'border-slate-100 opacity-60'} rounded-xl p-5 shadow-sm hover:shadow-md transition-all group relative`}
                   >
                     <div className="flex justify-between items-start mb-3">
                       <div className="flex items-center gap-3">
                         <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                           asset.type === 'receivable' ? 'bg-emerald-50 text-emerald-600' :
                           asset.type === 'payable' ? 'bg-rose-50 text-rose-600' :
                           asset.type === 'asset' ? 'bg-indigo-50 text-indigo-600' :
                           'bg-slate-50 text-slate-600'
                         }`}>
                           {asset.type === 'receivable' ? <ArrowUpRight className="w-4 h-4" /> : 
                            asset.type === 'payable' ? <ArrowDownLeft className="w-4 h-4" /> : 
                            <Briefcase className="w-4 h-4" />}
                          </div>
                          <div className="flex flex-col">
                            <h4 className="text-xs font-bold text-slate-900 tracking-tight">{asset.name}</h4>
                            <div className="flex items-center gap-2">
                              <p className="text-[9px] text-slate-400 font-mono uppercase">{asset.type}</p>
                              {isSettled ? (
                                <span className="text-[8px] bg-slate-800 text-slate-100 px-1.5 py-0.5 rounded-sm font-bold uppercase flex items-center gap-1">
                                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" /> Settled
                                </span>
                              ) : asset.id && linkedTransactions[asset.id]?.some(t => {
                                const tDateLimit = startOfTomorrow();
                                if (t.isRecurring) {
                                  if (t.endDate) {
                                    return !isBefore(toLocalDate(t.endDate), tDateLimit);
                                  }
                                  return true;
                                }
                                return !isBefore(toLocalDate(t.date), tDateLimit);
                              }) ? (
                                <span className="text-[8px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-sm font-bold uppercase flex items-center gap-1">
                                  <CalendarClock className="w-2.5 h-2.5" /> Scheduled
                                </span>
                              ) : (
                                <span className="text-[8px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded-sm font-bold uppercase">Unscheduled</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(asset);
                            }}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all"
                            title="Edit Position"
                          >
                            <TrendingUp className="w-3.5 h-3.5" />
                          </button>
                          {asset.type !== 'asset' && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setSchedulingAsset(asset);
                              }}
                              className={`p-1.5 rounded-md transition-all ${
                                asset.type === 'receivable' 
                                  ? 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50' 
                                  : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                              }`}
                              title={asset.type === 'receivable' ? "Schedule Collection" : "Schedule Payment"}
                            >
                              <CalendarClock className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (asset.id) setShowConfirmDelete(asset.id);
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all"
                            title="Delete Record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                           <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-400 uppercase">
                                {asset.type === 'asset' ? 'Current Valuation' : asset.type === 'receivable' ? 'Balance to Collect' : 'Balance to Pay'}
                              </span>
                              <span className={`text-sm font-mono font-bold ${asset.currentBalance > 0 ? (asset.type === 'receivable' ? 'text-emerald-600' : 'text-slate-900') : 'text-slate-400'}`}>
                                {currencySymbol}{asset.currentBalance.toLocaleString()}
                              </span>
                           </div>
                           {asset.type !== 'asset' ? (
                             <>
                               <div className="w-full h-1.5 bg-slate-50 rounded-full overflow-hidden">
                                 <div 
                                   className={`h-full rounded-full transition-all duration-1000 ${
                                     asset.type === 'receivable' ? 'bg-emerald-500' :
                                     asset.type === 'payable' ? 'bg-rose-500' :
                                     'bg-slate-400'
                                   }`}
                                   style={{ width: `${Math.min(100, (asset.currentBalance / (asset.totalAmount || 1)) * 100)}%` }}
                                 />
                               </div>
                               <div className="flex justify-between text-[8px] font-bold text-slate-300 uppercase font-mono tracking-tighter">
                                 <span>Base: {currencySymbol}{asset.totalAmount.toLocaleString()}</span>
                                 <span>{Math.round((asset.currentBalance / (asset.totalAmount || 1)) * 100)}% Remaining</span>
                               </div>
                             </>
                           ) : (
                             <div className="pt-2 border-t border-slate-50 flex items-center gap-2">
                                <div className="w-1 h-1 rounded-full bg-indigo-400" />
                                <span className="text-[8px] font-bold text-slate-300 uppercase tracking-widest font-mono">Market Valuation Mode</span>
                             </div>
                           )}
                        </div>

                     {asset.description && (
                       <p className="mt-3 text-[10px] text-slate-500 line-clamp-2 border-t border-slate-50 pt-2 font-medium">
                         {asset.description}
                       </p>
                     )}
                   </div>
                  );
                 })}
               </div>
             ) : (
               <div className="py-24 text-center bg-white rounded-xl border-2 border-dashed border-slate-100">
                  <Landmark className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                  <p className="text-[11px] font-bold text-slate-300 uppercase tracking-[0.2em]">{dynamicAssets.length === 0 ? "No external equity registered" : "No positions match filters"}</p>
                  {dynamicAssets.length === 0 && (
                    <button 
                      onClick={() => setIsAdding(true)}
                      className="mt-4 text-[10px] font-bold text-indigo-500 uppercase hover:text-indigo-600 transition-colors"
                    >
                      + Establish first position
                    </button>
                  )}
               </div>
             )}
          </div>
        </div>
      </div>

      {schedulingAsset && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in slide-in-from-bottom-4 duration-300 border border-slate-200">
             <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-100">
                      <CalendarClock className="w-5 h-5" />
                   </div>
                   <div>
                      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest leading-none mb-1">Scheduling Protocol</h3>
                      <p className="text-[10px] text-indigo-600 font-mono font-bold">LID: {schedulingAsset.id?.slice(0, 8)}</p>
                   </div>
                </div>
                <button onClick={() => setSchedulingAsset(null)} className="p-2 hover:bg-white rounded-lg transition-colors group">
                   <X className="w-5 h-5 text-slate-400 group-hover:text-rose-500" />
                </button>
             </div>

             <div className="p-8 space-y-6">
                {!schedulePlan ? (
                  <div className="grid grid-cols-1 gap-3">
                     <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 px-1">Select Settlement Strategy</p>
                     <button 
                      onClick={() => setSchedulePlan('whole')}
                      className="group p-5 bg-slate-50 border border-slate-100 rounded-xl hover:border-indigo-500 hover:bg-white transition-all text-left flex items-center justify-between"
                     >
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <ArrowUpRight className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-900 uppercase">Immediate Settlement</p>
                            <p className="text-[9px] text-slate-400 font-medium">Commit total balance as a single ledger entry today</p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
                     </button>
                     <button 
                      onClick={() => setSchedulePlan('installments')}
                      className="group p-5 bg-slate-50 border border-slate-100 rounded-xl hover:border-indigo-500 hover:bg-white transition-all text-left flex items-center justify-between"
                     >
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                            <History className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-900 uppercase">Linear Installments</p>
                            <p className="text-[9px] text-slate-400 font-medium">Distribute burden evenly across a recurring timeline</p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
                     </button>
                     <button 
                      onClick={() => setSchedulePlan('custom')}
                      className="group p-5 bg-slate-50 border border-slate-100 rounded-xl hover:border-indigo-500 hover:bg-white transition-all text-left flex items-center justify-between"
                     >
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                            <Plus className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-900 uppercase">Custom Ledger Entry</p>
                            <p className="text-[9px] text-slate-400 font-medium">Manually configure specific dates and conditions</p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
                     </button>
                     <button 
                      onClick={() => {
                        setSchedulePlan('freedom');
                        setFreedomEntries([{ amount: schedulingAsset.currentBalance, date: new Date().toISOString().split('T')[0] }]);
                      }}
                      className="group p-5 bg-slate-50 border border-slate-100 rounded-xl hover:border-indigo-500 hover:bg-white transition-all text-left flex items-center justify-between"
                     >
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                            <Scale className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-900 uppercase">Freedom Plan</p>
                            <p className="text-[9px] text-slate-400 font-medium">Full granular control over multiple payouts and dates</p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-1 transition-all" />
                     </button>
                  </div>
                ) : schedulePlan === 'freedom' ? (
                  <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                    <div className="space-y-4">
                      {freedomEntries.map((entry, idx) => (
                        <div key={idx} className="bg-slate-50 p-4 rounded-xl border border-slate-100 relative group/entry">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-1">Amount</label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 font-mono text-xs">{currencySymbol}</span>
                                <input 
                                  type="number"
                                  value={entry.amount}
                                  onChange={(e) => {
                                    const newEntries = [...freedomEntries];
                                    newEntries[idx].amount = parseFloat(e.target.value);
                                    setFreedomEntries(newEntries);
                                  }}
                                  className="w-full pl-7 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold outline-none"
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-1">Date</label>
                              <input 
                                type="date"
                                value={entry.date}
                                onChange={(e) => {
                                  const newEntries = [...freedomEntries];
                                  newEntries[idx].date = e.target.value;
                                  setFreedomEntries(newEntries);
                                }}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold outline-none"
                              />
                            </div>
                          </div>
                          {freedomEntries.length > 1 && (
                            <button 
                              onClick={() => setFreedomEntries(freedomEntries.filter((_, i) => i !== idx))}
                              className="absolute -right-2 -top-2 w-6 h-6 bg-white border border-slate-200 text-rose-500 rounded-full flex items-center justify-center opacity-0 group-hover/entry:opacity-100 transition-opacity shadow-sm"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">
                        Total Selected: <span className="text-indigo-600">{currencySymbol}{freedomEntries.reduce((sum, e) => sum + (e.amount || 0), 0).toLocaleString()}</span>
                      </div>
                      <button 
                        onClick={() => setFreedomEntries([...freedomEntries, { amount: 0, date: new Date().toISOString().split('T')[0] }])}
                        className="text-[10px] font-bold text-indigo-600 uppercase hover:text-indigo-700 underline"
                      >
                        + Add Milestone
                      </button>
                    </div>

                    <button 
                      onClick={handleSchedule}
                      disabled={loading || freedomEntries.length === 0}
                      className="w-full py-4 bg-slate-900 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 flex items-center justify-center gap-3"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {loading ? 'Processing...' : 'Commit Freedom Plan'}
                    </button>
                    <button onClick={() => setSchedulePlan(null)} className="w-full text-[10px] font-bold text-slate-400 uppercase tracking-widest py-2 hover:text-slate-600">Back to Strategies</button>
                  </div>
                ) : schedulePlan === 'custom' ? (
                  <div className="max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                    <TransactionForm 
                      initialData={{
                        userId: user?.uid || '',
                        type: schedulingAsset.type === 'receivable' || schedulingAsset.type === 'asset' ? 'income' : 'expense',
                        amount: schedulingAsset.currentBalance,
                        category: schedulingAsset.name,
                        description: `Scheduled settlement for ${schedulingAsset.name}`,
                        date: new Date().toISOString(),
                        isRecurring: false,
                        frequency: 'none',
                        linkedAssetId: schedulingAsset.id,
                        createdAt: '',
                        updatedAt: ''
                      }}
                      onSuccess={() => setSchedulingAsset(null)}
                    />
                  </div>
                ) : schedulePlan === 'installments' ? (
                  <div className="space-y-6">
                    <div className="bg-indigo-50 rounded-xl p-5 border border-indigo-100">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] font-bold text-indigo-700 uppercase">Installment Count</span>
                        <span className="text-xs font-mono font-bold text-indigo-900">{installmentCount} Units</span>
                      </div>
                      <input 
                        type="range" 
                        min="2" 
                        max="24" 
                        value={installmentCount} 
                        onChange={(e) => setInstallmentCount(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-indigo-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                      <div className="flex justify-between mt-2 text-[9px] font-bold text-indigo-400 uppercase font-mono">
                         <span>2 Months</span>
                         <span>Term Duration</span>
                         <span>24 Months</span>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
                       <div className="flex justify-between items-center p-4">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Unit Burden</span>
                          <span className="text-sm font-mono font-bold text-slate-900">{currencySymbol}{(schedulingAsset.currentBalance / installmentCount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                       </div>
                       <div className="flex justify-between items-center p-4">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Execution Start</span>
                          <span className="text-xs font-mono font-bold text-slate-600">{format(new Date(), 'dd MMM yyyy')}</span>
                       </div>
                       <div className="flex justify-between items-center p-4">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Projected End</span>
                          <span className="text-xs font-mono font-bold text-emerald-600">{format(addMonths(new Date(), installmentCount - 1), 'dd MMM yyyy')}</span>
                       </div>
                    </div>

                    <button 
                      onClick={handleSchedule}
                      disabled={loading}
                      className="w-full py-4 bg-slate-900 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 flex items-center justify-center gap-3"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {loading ? 'Processing...' : 'Commit Installment Plan'}
                    </button>
                    <button onClick={() => setSchedulePlan(null)} className="w-full text-[10px] font-bold text-slate-400 uppercase tracking-widest py-2 hover:text-slate-600">Back to Strategies</button>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <p className="text-xs text-slate-500 leading-relaxed text-center px-4">
                      Are you sure you want to commit immediate full settlement of <span className="font-bold text-slate-900">{currencySymbol}{schedulingAsset.currentBalance.toLocaleString()}</span> for <span className="text-indigo-600">{schedulingAsset.name}</span> into the active ledger?
                    </p>
                    
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2 px-1">Effective Entry Date</label>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                          type="date"
                          value={settlementDate}
                          onChange={(e) => setSettlementDate(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-lg text-sm font-mono font-bold focus:ring-2 focus:ring-indigo-500/10 outline-none transition-all"
                        />
                      </div>
                    </div>

                    <button 
                      onClick={handleSchedule}
                      disabled={loading}
                      className="w-full py-4 bg-emerald-600 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 flex items-center justify-center gap-3"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {loading ? 'Processing...' : 'Commit Full Settlement'}
                    </button>
                    <button onClick={() => setSchedulePlan(null)} className="w-full text-[10px] font-bold text-slate-400 uppercase tracking-widest py-2 hover:text-slate-600">Back to Strategies</button>
                  </div>
                )}
             </div>
          </div>
        </div>
      )}
      </div>
      
      {viewTransactionsForAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setViewTransactionsForAsset(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                    <History className="w-5 h-5" />
                 </div>
                 <div>
                    <h3 className="font-bold text-slate-900">Linked Transactions</h3>
                    <p className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">{viewTransactionsForAsset.name}</p>
                 </div>
              </div>
              <button 
                onClick={() => setViewTransactionsForAsset(null)}
                className="p-2 text-slate-400 hover:text-rose-500 hover:bg-white rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="max-h-[60vh] overflow-y-auto p-2 custom-scrollbar bg-slate-50 inline-block w-full">
              {(() => {
                const txs = [
                  ...(linkedTransactions[viewTransactionsForAsset.id || ''] || []),
                  ...(fundedTransactions[viewTransactionsForAsset.id || ''] || [])
                ].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                
                if (txs.length === 0) {
                  return (
                    <div className="py-12 text-center text-slate-400">
                      <p className="text-[11px] font-bold uppercase tracking-widest">No entries found</p>
                    </div>
                  );
                }
                
                return txs.map(t => (
                  <div key={t.id} className="flex flex-col bg-white border border-slate-100 rounded-xl p-4 mb-2">
                     <div className="flex justify-between items-start mb-2">
                        <div>
                           <p className="text-xs font-bold text-slate-900">{t.category}</p>
                           <p className="text-[10px] text-slate-500 line-clamp-1">{t.description}</p>
                        </div>
                        <span className={`text-xs font-bold font-mono ${t.type === 'income' ? 'text-emerald-600' : 'text-slate-900'}`}>
                           {t.type === 'income' ? '+' : '-'}{currencySymbol}{t.amount.toLocaleString()}
                        </span>
                     </div>
                     <div className="flex items-center justify-between mt-1 text-[9px] font-bold uppercase tracking-widest">
                       <span className="text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded text-left">
                         {t.linkedAssetId === viewTransactionsForAsset.id ? 'Settlement' : 'Funded'}
                       </span>
                       <span className="text-slate-400">{format(toLocalDate(t.date), 'MMM dd, yyyy')}</span>
                     </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
      
      <ConfirmDialog
        isOpen={!!showConfirmDelete}
        title="Delete Asset/Position"
        message="Are you sure you want to delete this record? This will remove it from your external balance sheet permanently."
        onConfirm={() => showConfirmDelete && deleteAsset(showConfirmDelete)}
        onCancel={() => setShowConfirmDelete(null)}
        confirmText="Delete Record"
      />
    </>
  );
};
