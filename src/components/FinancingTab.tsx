import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { Home, Car, CreditCard, Calculator, CheckCircle2, DollarSign, CalendarClock, Percent, Calendar } from 'lucide-react';
import { handleFirestoreError, OperationType, db } from '../lib/firebase';
import { collection, serverTimestamp, writeBatch, doc } from 'firebase/firestore';
import { format, addMonths } from 'date-fns';

export const FinancingTab: React.FC<{ onComplete?: () => void }> = ({ onComplete }) => {
  const { user, profile } = useAuth();
  const [loanType, setLoanType] = useState<'mortgage' | 'auto' | 'personal'>('mortgage');
  const [name, setName] = useState('');
  
  const [assetValue, setAssetValue] = useState('');
  const [downPayment, setDownPayment] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  
  const [interestRate, setInterestRate] = useState('');
  const [tenor, setTenor] = useState(''); // Years for Mortgage/Auto, Months for Personal
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  
  const [loading, setLoading] = useState(false);

  const currencySymbol = profile?.currency === 'EUR' ? '€' : profile?.currency === 'GBP' ? '£' : '$';

  // Computed Values
  const computedPrincipal = useMemo(() => {
    let p = 0;
    if (loanType === 'personal') {
      p = parseFloat(loanAmount) || 0;
    } else {
      const value = parseFloat(assetValue) || 0;
      const down = parseFloat(downPayment) || 0;
      p = Math.max(0, value - down);
    }
    return p;
  }, [loanType, loanAmount, assetValue, downPayment]);

  const computedTenorMonths = useMemo(() => {
    const t = parseFloat(tenor) || 0;
    if (loanType === 'personal') return t;
    return t * 12;
  }, [loanType, tenor]);

  const pmt = useMemo(() => {
    if (computedPrincipal <= 0 || computedTenorMonths <= 0) return 0;
    const rateAnnual = parseFloat(interestRate) || 0;
    const r = (rateAnnual / 100) / 12;
    const n = computedTenorMonths;
    
    if (r === 0) return computedPrincipal / n;
    
    return (computedPrincipal * r) / (1 - Math.pow(1 + r, -n));
  }, [computedPrincipal, computedTenorMonths, interestRate]);

  const totalPayment = pmt * computedTenorMonths;
  const totalInterest = Math.max(0, totalPayment - computedPrincipal);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (computedPrincipal <= 0 || computedTenorMonths <= 0 || !name.trim()) return;

    setLoading(true);
    try {
      const batch = writeBatch(db);
      
      const payableRef = doc(collection(db, 'assets'));
      
      const loanLabel = loanType.charAt(0).toUpperCase() + loanType.slice(1);
      
      // 1. Create Payable Record (for the total amount owed: principal + interest)
      // Recording Principal + Interest as the payable balance.
      batch.set(payableRef, {
        userId: user.uid,
        name: `${loanLabel} Loan: ${name}`,
        type: 'payable',
        totalAmount: totalPayment,
        currentBalance: totalPayment,
        description: `Financing: ${computedTenorMonths} months @ ${interestRate}% APR`,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 2. Add Asset Record (Only for Auto/Mortgage)
      if (loanType !== 'personal') {
        const assetRef = doc(collection(db, 'assets'));
        batch.set(assetRef, {
          userId: user.uid,
          name: `${loanLabel}: ${name}`,
          type: 'asset',
          totalAmount: parseFloat(assetValue) || 0,
          currentBalance: parseFloat(assetValue) || 0,
          description: `Financed Asset`,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        
        // Add single transaction for the Down Payment (Cash Outflow)
        const dp = parseFloat(downPayment) || 0;
        if (dp > 0) {
          const dpTxRef = doc(collection(db, 'transactions'));
          batch.set(dpTxRef, {
            userId: user.uid,
            type: 'expense',
            amount: dp,
            category: `${loanLabel} Down Payment`,
            description: `Down payment for ${name}`,
            date: new Date(startDate).toISOString(),
            isRecurring: false,
            frequency: 'none',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      // 3. Add Scheduled Recurring Transaction for Installments
      const startD = new Date(startDate);
      const endD = addMonths(startD, computedTenorMonths - 1);
      const recurringTxRef = doc(collection(db, 'transactions'));
      
      batch.set(recurringTxRef, {
        userId: user.uid,
        type: 'expense',
        amount: pmt,
        category: `${loanLabel} Installment`,
        description: `Installment for ${name}`,
        date: startD.toISOString(),
        isRecurring: true,
        frequency: 'monthly',
        dayOfMonth: startD.getDate(),
        endDate: endD.toISOString(),
        linkedAssetId: payableRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Commit Batch
      await batch.commit();

      if (onComplete) onComplete();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'financing_batch');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4 border-b border-slate-100 pb-6">
        <div className="w-12 h-12 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-indigo-500 shadow-sm">
          <Calculator className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">Financing & Loans</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Structure Term Debt</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Form */}
        <div className="lg:col-span-2 space-y-8">
          <div className="grid grid-cols-3 gap-4">
            {[
              { id: 'mortgage', label: 'Mortgage', icon: <Home className="w-5 h-5 mb-2" /> },
              { id: 'auto', label: 'Auto Loan', icon: <Car className="w-5 h-5 mb-2" /> },
              { id: 'personal', label: 'Personal Loan', icon: <CreditCard className="w-5 h-5 mb-2" /> }
            ].map((type) => (
              <button
                key={type.id}
                onClick={() => setLoanType(type.id as any)}
                className={`p-4 rounded-xl border flex flex-col items-center justify-center transition-all ${
                  loanType === type.id 
                    ? 'border-indigo-500 bg-indigo-50/50 text-indigo-600 shadow-sm' 
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {type.icon}
                <span className="text-[10px] font-bold uppercase tracking-widest">{type.label}</span>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Identifier / Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={loanType === 'mortgage' ? 'e.g. 123 Main St' : loanType === 'auto' ? 'e.g. Tesla Model 3' : 'e.g. Sofi Consolidation'}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {loanType !== 'personal' ? (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Asset Value</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">{currencySymbol}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={assetValue}
                        onChange={e => setAssetValue(e.target.value)}
                        className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Down Payment</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">{currencySymbol}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={downPayment}
                        onChange={e => setDownPayment(e.target.value)}
                        className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono"
                        required
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-2 md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Loan Amount</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">{currencySymbol}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={loanAmount}
                      onChange={e => setLoanAmount(e.target.value)}
                      className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono"
                      required
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Interest Rate (APR)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold"><Percent className="w-4 h-4" /></span>
                  <input
                    type="number"
                    step="0.01"
                    value={interestRate}
                    onChange={e => setInterestRate(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tenor ({loanType === 'personal' ? 'Months' : 'Years'})</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold"><CalendarClock className="w-4 h-4" /></span>
                  <input
                    type="number"
                    value={tenor}
                    onChange={e => setTenor(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono"
                    required
                  />
                </div>
              </div>
              
              <div className="space-y-2 md:col-span-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Start Date</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold"><Calendar className="w-4 h-4" /></span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono"
                    required
                  />
                </div>
              </div>

            </div>
          </form>
        </div>

        {/* Right Column: Preview & Action */}
        <div className="space-y-6">
          <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">Amortization Summary</h3>
            
            <div className="space-y-6">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Principal Amount</p>
                <p className="text-2xl font-mono">{currencySymbol}{computedPrincipal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div className="h-px w-full bg-slate-800"></div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Monthly Payment</p>
                <p className="text-3xl font-mono text-indigo-400">{currencySymbol}{pmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div className="h-px w-full bg-slate-800"></div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">Total Interest</p>
                  <p className="text-sm font-mono text-rose-400">{currencySymbol}{totalInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div>
                   <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">Total Cost</p>
                   <p className="text-sm font-mono">{currencySymbol}{totalPayment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading || pmt <= 0 || !name.trim()}
              className="mt-8 w-full py-4 bg-indigo-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
            >
              {loading ? (
                'Processing...'
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Establish Facility
                </>
              )}
            </button>
            <p className="text-center text-[9px] text-slate-500 mt-4 px-4 leading-relaxed">
              This will automatically set up external assets/liabilities and integrate scheduled payments to your ledger.
            </p>
          </div>
        </div>
        
      </div>
    </div>
  );
};
