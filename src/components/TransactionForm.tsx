import React, { useState, useMemo, useEffect } from 'react';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, doc, setDoc, deleteDoc, updateDoc, getDocs, query, where } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { Transaction, TransactionType, Frequency } from '../types';
import { Save, Plus, ArrowUpCircle, ArrowDownCircle, RotateCcw, AlertCircle, Trash2, Wand2 } from 'lucide-react';
import { addDays, addWeeks, addMonths, addYears, format } from 'date-fns';
import { handleFirestoreError, OperationType } from '../lib/firebase';
import { toLocalDate } from '../utils/date';
import { ConfirmDialog } from './ConfirmDialog';
import { ActionDialog } from './ActionDialog';

import { EmailParserModal } from './EmailParserModal';

export const TransactionForm: React.FC<{ initialData?: (Transaction & { isProjected?: boolean }) | null, onSuccess?: () => void, onCancel?: () => void }> = ({ initialData, onSuccess, onCancel }) => {
  const { user, profile } = useAuth();
  const [type, setType] = useState<TransactionType>(initialData?.type || 'expense');
  const [amount, setAmount] = useState(initialData?.amount.toString() || '');
  const [category, setCategory] = useState(initialData?.category || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [date, setDate] = useState(initialData ? format(toLocalDate(initialData.date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
  const [isRecurring, setIsRecurring] = useState(initialData?.isRecurring || false);
  const [fundedBySavings, setFundedBySavings] = useState(initialData?.fundedBySavings || false);
  const [savingsCap, setSavingsCap] = useState<string>(initialData?.savingsCap?.toString() || '');
  const [frequency, setFrequency] = useState<Frequency>(initialData?.frequency || 'monthly');
  const [dayOfMonth, setDayOfMonth] = useState<number>(initialData?.dayOfMonth || 1);
  const [dayOfWeek, setDayOfWeek] = useState<number>(initialData?.dayOfWeek || 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<'occurrence' | 'series'>(initialData?.isProjected ? 'occurrence' : 'series');
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showEmailParser, setShowEmailParser] = useState(false);
  const [assets, setAssets] = useState<any[]>([]);
  const [fundedByAssetId, setFundedByAssetId] = useState(initialData?.fundedByAssetId || '');
  const [linkedAssetId, setLinkedAssetId] = useState(initialData?.linkedAssetId || '');
  const [receiveAsLoan, setReceiveAsLoan] = useState(false);
  
  // Recurrence Limit State
  const [hasRecurrenceLimit, setHasRecurrenceLimit] = useState(!!initialData?.endDate);
  const [recurrenceLimitValue, setRecurrenceLimitValue] = useState<string>('6');
  const [recurrenceLimitType, setRecurrenceLimitType] = useState<'occurrences' | 'date'>(initialData?.endDate ? 'date' : 'occurrences');
  const [customEndDate, setCustomEndDate] = useState(initialData?.endDate ? format(toLocalDate(initialData.endDate), 'yyyy-MM-dd') : '');

  useEffect(() => {
    if (!user) return;
    const fetchAssets = async () => {
      try {
        const { getDocs, query, where, collection } = await import('firebase/firestore');
        const q = query(collection(db, 'assets'), where('userId', '==', user.uid), where('isActive', '==', true));
        const snap = await getDocs(q);
        setAssets(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Error fetching assets:", error);
      }
    };
    fetchAssets();
  }, [user]);

  useEffect(() => {
    if (initialData) {
      setType(initialData.type);
      setAmount(initialData.amount.toString());
      setCategory(initialData.category);
      setDescription(initialData.description);
      setDate(format(toLocalDate(initialData.date), 'yyyy-MM-dd'));
      setIsRecurring(initialData.isRecurring);
      setFundedBySavings(initialData.fundedBySavings || false);
      setFundedByAssetId(initialData.fundedByAssetId || '');
      setLinkedAssetId(initialData.linkedAssetId || '');
      setFrequency(initialData.frequency === 'none' ? 'monthly' : initialData.frequency);
      setDayOfMonth(initialData.dayOfMonth || 1);
      setDayOfWeek(initialData.dayOfWeek || 1);
      setEditMode(initialData.isProjected ? 'occurrence' : 'series');
    }
  }, [initialData]);

  useEffect(() => {
    if (!initialData) {
      const d = toLocalDate(date);
      setDayOfMonth(d.getDate());
      setDayOfWeek(d.getDay());
    }
  }, [date, initialData]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !amount || !category) return;

    setLoading(true);
    try {
      let finalEndDate: string | null = null;
      if (isRecurring && hasRecurrenceLimit) {
        if (recurrenceLimitType === 'date' && customEndDate) {
          finalEndDate = new Date(customEndDate).toISOString();
        } else if (recurrenceLimitType === 'occurrences' && recurrenceLimitValue) {
          const start = new Date(date);
          const count = parseInt(recurrenceLimitValue);
          let end: Date;
          if (frequency === 'daily') end = addDays(start, count - 1);
          else if (frequency === 'weekly') end = addWeeks(start, count - 1);
          else if (frequency === 'monthly') end = addMonths(start, count - 1);
          else if (frequency === 'yearly') end = addYears(start, count - 1);
          else end = start;
          finalEndDate = end.toISOString();
        }
      }

      const parsedAmount = parseFloat(amount);
      const parsedSavingsCap = savingsCap ? parseFloat(savingsCap) : null;

      if (isNaN(parsedAmount)) {
        setError('Please enter a valid numeric amount');
        return;
      }

      const transactionData: any = {
        userId: user.uid,
        type,
        amount: parsedAmount,
        category: category.trim(),
        description: description.trim(),
        date: new Date(date).toISOString(),
        isRecurring,
        fundedBySavings: type === 'expense' ? fundedBySavings : false,
        savingsCap: (type === 'expense' && fundedBySavings && parsedSavingsCap !== null) ? parsedSavingsCap : null,
        fundedByAssetId: (type === 'expense' && !fundedBySavings && fundedByAssetId) ? fundedByAssetId : null,
        linkedAssetId: linkedAssetId || null,
        frequency: isRecurring ? frequency : 'none',
        dayOfMonth: isRecurring && (frequency === 'monthly' || frequency === 'yearly') ? dayOfMonth : null,
        dayOfWeek: isRecurring && frequency === 'weekly' ? dayOfWeek : null,
        endDate: isRecurring ? finalEndDate : null,
        updatedAt: serverTimestamp(),
      };

      if (initialData?.id) {
        if (initialData.isRecurring && editMode === 'occurrence') {
          // 1. Mark original as excluded for this date
          const originalRef = doc(db, 'transactions', initialData.id);
          const currentExcluded = initialData.excludedDates || [];
          const dateToExclude = initialData.date; // The ISO date of the specific occurrence we clicked
          
          await setDoc(originalRef, {
            excludedDates: [...currentExcluded, dateToExclude],
            updatedAt: serverTimestamp()
          }, { merge: true });

          // 2. Create new one-off transaction for this specific change
          await addDoc(collection(db, 'transactions'), {
            ...transactionData,
            isRecurring: false, 
            frequency: 'none',
            createdAt: serverTimestamp(),
          });
        } else {
          // Normal edit of base transaction (updates the whole series or a single non-recurring transaction)
          await setDoc(doc(db, 'transactions', initialData.id), transactionData, { merge: true });
          
          const qAsset = query(collection(db, 'assets'), where('userId', '==', user?.uid), where('linkedTransactionIds', 'array-contains', initialData.id));
          const assetSnap = await getDocs(qAsset);
          for (const a of assetSnap.docs) {
             if (a.data().type === 'payable') {
               const autoDesc = `Auto-updated loan from income transaction on ${format(new Date(date), 'MMM dd, yyyy')}`;
               await updateDoc(doc(db, 'assets', a.id), {
                 totalAmount: parsedAmount,
                 currentBalance: parsedAmount,
                 name: category.trim(),
                 description: description.trim() ? `${description.trim()}\n\n[ ${autoDesc} ]` : autoDesc,
                 updatedAt: serverTimestamp()
               });
             }
          }
        }
      } else {
        const docRef = await addDoc(collection(db, 'transactions'), {
          ...transactionData,
          createdAt: serverTimestamp(),
        });
        
        if (type === 'income' && receiveAsLoan) {
          const autoDesc = `Auto-generated loan from income transaction on ${format(new Date(date), 'MMM dd, yyyy')}`;
          await addDoc(collection(db, 'assets'), {
            userId: user.uid,
            name: category.trim(),
            type: 'payable',
            totalAmount: parsedAmount,
            currentBalance: parsedAmount,
            description: description.trim() ? `${description.trim()}\n\n[ ${autoDesc} ]` : autoDesc,
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            linkedTransactionIds: [docRef.id]
          });
        }
      }

      if (onSuccess) onSuccess();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'transactions');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = () => {
    setShowConfirmDelete(true);
  };

  const confirmDelete = async () => {
    if (!initialData?.id) return;
    setLoading(true);
    try {
      if (initialData.isRecurring && editMode === 'occurrence') {
        const originalRef = doc(db, 'transactions', initialData.id);
        const currentExcluded = initialData.excludedDates || [];
        const dateToExclude = initialData.date;
        
        await setDoc(originalRef, {
          excludedDates: [...currentExcluded, dateToExclude],
          updatedAt: serverTimestamp()
        }, { merge: true });
      } else {
        const qAsset = query(collection(db, 'assets'), where('userId', '==', user?.uid), where('linkedTransactionIds', 'array-contains', initialData.id));
        const assetSnap = await getDocs(qAsset);
        for (const a of assetSnap.docs) {
          await deleteDoc(doc(db, 'assets', a.id));
        }
        await deleteDoc(doc(db, 'transactions', initialData.id));
      }
      if (onSuccess) onSuccess();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `transactions/${initialData.id}`);
    } finally {
      setLoading(false);
      setShowConfirmDelete(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            {initialData ? 'Update Transaction' : 'Entry Registration'}
          </h2>
          <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">
            {initialData ? `Modifying ID: ${initialData.id?.slice(0, 8)}...` : 'Execute new ledger transaction'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!initialData && (
            <button
              onClick={() => setShowEmailParser(true)}
              className="w-10 h-10 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center transition-colors group"
              title="Parse Email/SMS Alert"
            >
              <Wand2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
            </button>
          )}
          <div className={`w-10 h-10 ${initialData ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400'} rounded-lg flex items-center justify-center`}>
            {initialData ? <AlertCircle className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
          </div>
        </div>
      </div>

      <EmailParserModal 
        isOpen={showEmailParser} 
        onClose={() => setShowEmailParser(false)} 
        onParseSuccess={(data) => {
          setAmount(data.amount.toString());
          setType(data.type);
          setCategory(data.category);
          setDescription(data.description);
          if (data.date) setDate(data.date);
        }}
      />

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-6">
        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-100 flex items-center gap-2 text-rose-600 text-xs font-bold animate-in slide-in-from-top-2 duration-200">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
        {initialData && initialData.isRecurring && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 mb-4 flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest">Recurring Control</p>
              <span className="text-[9px] text-indigo-400 font-mono">Series Management</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditMode('occurrence')}
                className={`flex-1 py-2 px-3 rounded-md text-[10px] font-bold uppercase transition-all ${editMode === 'occurrence' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-indigo-600 border border-indigo-200'}`}
              >
                Just this instance
              </button>
              <button
                type="button"
                onClick={() => setEditMode('series')}
                className={`flex-1 py-2 px-3 rounded-md text-[10px] font-bold uppercase transition-all ${editMode === 'series' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-indigo-600 border border-indigo-200'}`}
              >
                Entire recurring series
              </button>
            </div>
          </div>
        )}
        
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setType('income')}
            className={`py-3 px-4 rounded-lg text-[11px] font-bold uppercase tracking-widest border transition-all ${
              type === 'income' 
                ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm' 
                : 'bg-slate-50 border-slate-100 text-slate-400 hover:border-slate-200'
            }`}
          >
            Receivable
          </button>
          <button
            type="button"
            onClick={() => setType('expense')}
            className={`py-3 px-4 rounded-lg text-[11px] font-bold uppercase tracking-widest border transition-all ${
              type === 'expense' 
                ? 'bg-rose-50 border-rose-500 text-rose-700 shadow-sm' 
                : 'bg-slate-50 border-slate-100 text-slate-400 hover:border-slate-200'
            }`}
          >
            Payable
          </button>
        </div>

        <div className="space-y-5">
          <InputGroup label="Nominal Amount" value={amount} onChange={setAmount} type="number" prefix={currencySymbol} isMono />
          <InputGroup label="Entity Category" value={category} onChange={setCategory} placeholder="Salary, Rent, Groceries..." />
          <InputGroup label="Execution Date" value={date} onChange={setDate} type="date" isMono />
          
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Context / Notes</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-lg focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 outline-none transition-all text-sm h-20 resize-none font-medium"
            />
          </div>

          <div className="pt-4 border-t border-slate-50 flex flex-col gap-4">
             {type === 'income' && !initialData && (
               <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={receiveAsLoan}
                  onChange={(e) => setReceiveAsLoan(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                />
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">Receive as a Loan (Liability)</span>
               </label>
             )}

             <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
              />
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">Set as recurring strategy</span>
            </label>

            {type === 'expense' && (
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer select-none mb-2">
                  <input
                    type="checkbox"
                    checked={fundedBySavings}
                    onChange={(e) => {
                      setFundedBySavings(e.target.checked);
                      if (e.target.checked) setFundedByAssetId('');
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                  />
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">Funded by Savings Reserve</span>
                </label>

                {assets.filter(a => a.type === 'asset' || a.type === 'receivable').length > 0 && !fundedBySavings && (
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-2">Funded by (Asset/Receivable)</label>
                    <select
                      value={fundedByAssetId}
                      onChange={(e) => {
                        setFundedByAssetId(e.target.value);
                        if (e.target.value) setLinkedAssetId('');
                      }}
                      className="w-full bg-slate-50 border border-slate-100 rounded-lg text-xs font-bold p-2 text-slate-700"
                    >
                      <option value="">No Active Asset Funding</option>
                      {assets.filter(a => a.type === 'asset' || a.type === 'receivable').map(a => (
                        <option key={a.id} value={a.id}>{a.name} ({currencySymbol}{a.currentBalance.toLocaleString()})</option>
                      ))}
                    </select>
                  </div>
                )}

                {assets.filter(a => a.type === 'liability' || a.type === 'payable' || a.type === 'asset').length > 0 && (
                  <div>
                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-2">Settles (Liability) / Funds (Asset)</label>
                    <select
                      value={linkedAssetId}
                      onChange={(e) => {
                        setLinkedAssetId(e.target.value);
                        if (e.target.value) setFundedByAssetId('');
                      }}
                      className="w-full bg-slate-50 border border-slate-100 rounded-lg text-xs font-bold p-2 text-slate-700"
                    >
                      <option value="">None Linkage</option>
                      {assets.filter(a => a.type === 'liability' || a.type === 'payable' || a.type === 'asset').map(a => (
                        <option key={a.id} value={a.id}>
                           {a.type === 'asset' ? 'Funds: ' : 'Settles: '} {a.name} ({currencySymbol}{a.currentBalance.toLocaleString()})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {type === 'income' && assets.filter(a => a.type === 'receivable' || a.type === 'asset').length > 0 && (
               <div className="space-y-4">
                 <div>
                    <label className="block text-[9px] font-bold text-slate-400 uppercase mb-2">Settles (Receivable/Asset)</label>
                    <select
                      value={linkedAssetId}
                      onChange={(e) => setLinkedAssetId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-100 rounded-lg text-xs font-bold p-2 text-slate-700"
                    >
                      <option value="">No Receivable Settlement</option>
                      {assets.filter(a => a.type === 'receivable' || a.type === 'asset').map(a => (
                        <option key={a.id} value={a.id}>{a.name} ({currencySymbol}{a.currentBalance.toLocaleString()})</option>
                      ))}
                    </select>
                  </div>
               </div>
            )}

            {type === 'expense' && fundedBySavings && (
              <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase">Deduction Cap</span>
                  <div className="flex items-center gap-1 border-b border-emerald-200">
                    <span className="text-emerald-400 font-mono text-[10px]">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Unlimited"
                      value={savingsCap}
                      onChange={(e) => setSavingsCap(e.target.value)}
                      className="w-20 bg-transparent border-none p-0 focus:ring-0 text-[10px] font-bold uppercase text-emerald-900 text-right font-mono"
                    />
                  </div>
                </div>
                <p className="text-[9px] text-emerald-500/70 mt-1">Leave blank for full coverage from savings</p>
              </div>
            )}

            {isRecurring && (
              <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200 space-y-4">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-2">
                    <RotateCcw className="w-3.5 h-3.5 text-indigo-600" />
                    <span className="text-[10px] font-bold text-indigo-700 uppercase">Strategy Frequency</span>
                  </div>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as Frequency)}
                    className="bg-transparent border-none p-0 focus:ring-0 text-[10px] font-bold uppercase text-indigo-900 cursor-pointer text-right"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>

                {frequency === 'weekly' && (
                  <div className="pt-3 border-t border-indigo-100 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-indigo-700 uppercase">Day of Week</span>
                    <select
                      value={dayOfWeek}
                      onChange={(e) => setDayOfWeek(parseInt(e.target.value))}
                      className="bg-transparent border-none p-0 focus:ring-0 text-[10px] font-bold uppercase text-indigo-900 cursor-pointer text-right"
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
                  <div className="pt-3 border-t border-indigo-100 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-indigo-700 uppercase">Date of Month</span>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={dayOfMonth}
                      onChange={(e) => setDayOfMonth(parseInt(e.target.value))}
                      className="w-12 bg-transparent border-none p-0 focus:ring-0 text-[10px] font-bold uppercase text-indigo-900 text-right font-mono"
                    />
                  </div>
                )}

                <div className="pt-3 border-t border-indigo-100 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hasRecurrenceLimit}
                      onChange={(e) => setHasRecurrenceLimit(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                    />
                    <span className="text-[9px] font-bold text-indigo-700 uppercase">Limit Series Duration</span>
                  </label>

                  {hasRecurrenceLimit && (
                    <div className="flex flex-col gap-3 pl-6 animate-in fade-in slide-in-from-left-2 duration-200">
                      <div className="flex items-center gap-4">
                        <select
                          value={recurrenceLimitType}
                          onChange={(e) => setRecurrenceLimitType(e.target.value as any)}
                          className="bg-transparent border-none p-0 focus:ring-0 text-[10px] font-bold uppercase text-indigo-900 cursor-pointer"
                        >
                          <option value="occurrences">For specific count</option>
                          <option value="date">Until specific date</option>
                        </select>
                        <div className="flex-1 h-px bg-indigo-100/50" />
                      </div>

                      {recurrenceLimitType === 'occurrences' ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            value={recurrenceLimitValue}
                            onChange={(e) => setRecurrenceLimitValue(e.target.value)}
                            className="w-16 bg-white border border-indigo-200 rounded px-2 py-1 text-[10px] font-bold font-mono text-indigo-900 focus:ring-1 focus:ring-indigo-500 outline-none"
                          />
                          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-tight">
                            {frequency.replace('ly', '') + (parseInt(recurrenceLimitValue) === 1 ? '' : 's')}
                          </span>
                        </div>
                      ) : (
                        <input
                          type="date"
                          value={customEndDate}
                          onChange={(e) => setCustomEndDate(e.target.value)}
                          className="w-full bg-white border border-indigo-200 rounded px-3 py-1.5 text-[10px] font-bold font-mono text-indigo-900 focus:ring-1 focus:ring-indigo-500 outline-none"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          {initialData && (
            <button
              type="button"
              onClick={handleDeleteClick}
              disabled={loading}
              className="flex-none p-4 text-rose-500 bg-rose-50 rounded-lg hover:bg-rose-100 transition-all font-bold group"
              title="Delete Transaction"
            >
              <Trash2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
            </button>
          )}
          {initialData && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-lg text-sm font-bold uppercase tracking-widest hover:bg-slate-200 transition-all"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={loading}
            className="flex-[2] py-4 bg-slate-900 text-white rounded-lg text-sm font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 flex items-center justify-center gap-3"
          >
            {loading ? 'Executing...' : (
              <>
                <Save className="w-4 h-4" />
                {initialData ? 'Save Changes' : 'Commit Entry'}
              </>
            )}
          </button>
        </div>
      </form>

      <ConfirmDialog
        isOpen={showConfirmDelete}
        title="Delete Transaction"
        message={
          (initialData?.isProjected || initialData?.isRecurring) && editMode === 'occurrence'
            ? "Are you sure you want to delete ONLY this specific occurrence of the recurring transaction?"
            : "Are you sure you want to delete this transaction? This action cannot be undone."
        }
        onConfirm={confirmDelete}
        onCancel={() => setShowConfirmDelete(false)}
        confirmText="Delete"
      />
    </div>
  );
};

function InputGroup({ label, value, onChange, type = "text", placeholder, prefix, isMono }: any) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 font-mono text-sm">{prefix}</span>}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full ${prefix ? 'pl-8' : 'px-4'} py-3 bg-slate-50 border border-slate-100 rounded-lg focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 outline-none transition-all text-sm font-semibold text-slate-900 ${isMono ? 'font-mono' : ''}`}
        />
      </div>
    </div>
  );
}
