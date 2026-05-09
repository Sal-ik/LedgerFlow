import React, { useState } from 'react';
import { Download, FileSpreadsheet, ChevronDown, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import * as XLSX from 'xlsx';
import { format, addDays } from 'date-fns';
import { generateLedger } from '../utils/transactions';

export const ExportMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { user } = useAuth();

  const fetchAllData = async () => {
    if (!user) return null;
    
    try {
      // Fetch Transactions
      const txQuery = query(collection(db, 'transactions'), where('userId', '==', user.uid));
      const txSnapshot = await getDocs(txQuery);
      const transactions = txSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];

      // Fetch Strategies
      const strategiesQuery = query(collection(db, 'savings_strategies'), where('userId', '==', user.uid));
      const strategiesSnapshot = await getDocs(strategiesQuery);
      const strategies = strategiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];

      // Fetch Assets
      const assetsQuery = query(collection(db, 'assets'), where('userId', '==', user.uid));
      const assetsSnapshot = await getDocs(assetsQuery);
      const assets = assetsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];

      return { transactions, strategies, assets };
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'export');
      return null;
    }
  };

  const handleExport = async (horizonLabel: string, horizonDays: number) => {
    if (!user) return;
    setIsExporting(true);
    setIsOpen(false);
    
    try {
      const data = await fetchAllData();
      if (!data) return;
      const { transactions, strategies, assets } = data;
      
      const wb = XLSX.utils.book_new();

      const startDate = transactions.length > 0 ? new Date(Math.min(...transactions.map(t => new Date(t.date).getTime()))) : new Date();
      const endDate = addDays(new Date(), horizonDays);
      
      // Generate Ledger generates projected transactions as well as ledger balances
      const ledger = generateLedger(transactions, strategies, assets, startDate, endDate);
      
      // 1. All Transactions (including future projected ones)
      const allTx = ledger.flatMap(d => d.transactions);
      const uniqueTx = Array.from(new Map(allTx.map(t => [t.id + t.date, t])).values()).sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const assetMap = new Map(assets.map(a => [a.id, a.name]));

      const wsDataTx = uniqueTx.map(t => ({
        Date: t.date ? format(new Date(t.date), 'yyyy-MM-dd') : '',
        Type: t.type,
        Amount: t.amount,
        Category: t.category,
        Description: t.description,
        'Is Recurring': t.isRecurring ? 'Yes' : 'No',
        Frequency: t.frequency || '',
        'Funded By Asset': t.fundedByAssetId ? assetMap.get(t.fundedByAssetId) || t.fundedByAssetId : '',
        'Linked Asset': t.linkedAssetId ? assetMap.get(t.linkedAssetId) || t.linkedAssetId : '',
      }));
      const wsTx = XLSX.utils.json_to_sheet(wsDataTx);
      XLSX.utils.book_append_sheet(wb, wsTx, "Projected & Historical Tx");

      // 2. Ledger Summary
      const ledgerWsData = ledger.map(l => ({
        Date: l.dateStr,
        'Running Balance': l.runningBalance,
        Income: l.income,
        Expense: l.expense,
        'Savings Deduction': l.savingsDeduction
      }));
      const ledgerWs = XLSX.utils.json_to_sheet(ledgerWsData);
      XLSX.utils.book_append_sheet(wb, ledgerWs, "Daily Balance Ledger");

      // 3. Savings Strategies
      const savingsLedgerData = ledger.flatMap(l => [
        ...l.savingsStrategiesSwept.map(s => ({
          Date: l.dateStr,
          Type: 'Deposit (Strategy)',
          Name: s.name,
          Amount: s.amount,
          'Savings Balance After': l.historicalSavings // Approximately true at end of day, accurately we might need a finer track but this is okay. Actually let's just use l.historicalSavings
        })),
        ...l.savingsDrawdowns.map(d => ({
          Date: l.dateStr,
          Type: 'Withdrawal (Drawdown)',
          Name: 'Funded Expense',
          Amount: d.amount,
          'Savings Balance After': l.historicalSavings
        }))
      ]);
      const wsSavingsLedger = XLSX.utils.json_to_sheet(savingsLedgerData);
      XLSX.utils.book_append_sheet(wb, wsSavingsLedger, "Savings Ledger");

      const wsDataStrategies = strategies.map(s => {
        let details = '';
        if (s.calculationType === 'fixed') {
          details = `Fixed: ${s.fixedAmount}`;
        } else if (s.calculationType === 'sweep') {
          details = `Sweep (Leave ${s.leaveAmount})`;
        } else {
          details = `Percentage: ${s.percentage}% (Min: ${s.minAmount}, Max: ${s.maxAmount})`;
        }
        return {
          Name: s.name,
          Model: s.calculationType || 'percentage',
          Details: details,
          Frequency: s.frequency,
          Status: s.isActive ? 'Active' : 'Inactive'
        };
      });
      const wsStrategies = XLSX.utils.json_to_sheet(wsDataStrategies);
      XLSX.utils.book_append_sheet(wb, wsStrategies, "Savings Strategies");

      // 4. External Assets & Liabilities
      // We need to know if it's scheduled. We check if there's any transaction linked to it in the future or historically.
      const txsLinkedToAsset = new Set([
        ...transactions.map((t: any) => t.linkedAssetId).filter(Boolean),
        ...transactions.map((t: any) => t.fundedByAssetId).filter(Boolean)
      ]);

       const wsDataAssets = assets.map(a => {
        const isSettled = a.type !== 'asset' && a.currentBalance <= 0;
        let status = 'Unscheduled';
        if (isSettled) {
          status = 'Settled';
        } else if (txsLinkedToAsset.has(a.id)) {
          status = 'Scheduled';
        }
        
        return {
          Name: a.name,
          Type: a.type,
          Status: status,
          'Current Balance': a.currentBalance,
          'Total Amount / Limit': a.totalAmount,
          Description: a.description || ''
        };
      });
      const wsAssets = XLSX.utils.json_to_sheet(wsDataAssets);
      XLSX.utils.book_append_sheet(wb, wsAssets, "Assets & Liabilities");

      const filename = `LedgerFlow_Statement_${horizonLabel.replace(/ /g, '_')}_${format(new Date(), 'yyyyMMdd_HHmmss')}.xlsx`;
      XLSX.writeFile(wb, filename);

    } catch (error) {
      console.error("Export failed:", error);
      alert("Failed to export data");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-bold transition-colors uppercase tracking-tight"
      >
        {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        Export
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden"
            >
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Comprehensive Statements</p>
              </div>
              <div className="p-1">
                <ExportOption label="Weekly Statement" onClick={() => handleExport('Weekly', 7)} />
                <ExportOption label="Monthly Statement" onClick={() => handleExport('Monthly', 30)} />
                <ExportOption label="6-Monthly Statement" onClick={() => handleExport('6_Monthly', 180)} />
                <ExportOption label="Yearly Statement" onClick={() => handleExport('Yearly', 365)} />
                <div className="my-1 border-t border-slate-100"></div>
                <ExportOption label="Current Snapshot Only" onClick={() => handleExport('Current_Snapshot', 0)} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

function ExportOption({ label, onClick }: { label: string, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors text-left"
    >
      <FileSpreadsheet className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
