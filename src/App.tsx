/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { signInWithGoogle, signOut } from './lib/firebase';
import { LogIn, LogOut, Wallet, LayoutDashboard, ListFilter, PlusCircle, Globe, PiggyBank, ChevronLeft, ChevronRight, Menu, Briefcase, Settings, Landmark } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Dashboard } from './components/Dashboard';
import { BalanceSheet } from './components/BalanceSheet';
import { TransactionForm } from './components/TransactionForm';
import { SavingsTab } from './components/SavingsTab';
import { AssetsLiabilityTab } from './components/AssetsLiabilityTab';
import { ExportMenu } from './components/ExportMenu';
import { SheetsButton } from './components/SheetsButton';
import { GmailSyncButton } from './components/GmailSyncButton';
import { SettingsTab } from './components/SettingsTab';
import { FinancingTab } from './components/FinancingTab';
import { Transaction } from './types';

function AppContent() {
  const { user, profile, loading, updateCurrency } = useAuth();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'add' | 'savings' | 'assets' | 'settings' | 'financing'>('dashboard');
  const [isCurrencyMenuOpen, setIsCurrencyMenuOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const handleEdit = (t: Transaction) => {
    setEditingTransaction(t);
    setActiveTab('add');
  };

  const handleFormSuccess = () => {
    setEditingTransaction(null);
    setActiveTab('history');
  };

  const handleFormCancel = () => {
    setEditingTransaction(null);
    setActiveTab('history');
  };

  const currencies = [
    { code: 'USD', symbol: '$' },
    { code: 'EUR', symbol: '€' },
    { code: 'GBP', symbol: '£' },
    { code: 'JPY', symbol: '¥' },
    { code: 'INR', symbol: '₹' },
    { code: 'PKR', symbol: '₨' },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <motion.div
           animate={{ rotate: 360 }}
           transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
           className="w-10 h-10 border-2 border-indigo-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white p-6">
        <motion.div
           initial={{ opacity: 0, scale: 0.95 }}
           animate={{ opacity: 1, scale: 1 }}
           className="max-w-md w-full text-center space-y-8"
        >
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold shadow-xl shadow-indigo-200">
              <Wallet className="w-8 h-8" />
            </div>
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">LedgerFlow</h1>
            <p className="text-slate-500">The professional approach to personal balance sheets.</p>
          </div>
          <button
             onClick={signInWithGoogle}
             className="w-full flex items-center justify-center gap-3 py-3.5 px-6 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-all shadow-lg active:scale-[0.98]"
          >
            <LogIn className="w-5 h-5" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar - Desktop */}
      <aside className={`fixed inset-y-0 left-0 ${isSidebarCollapsed ? 'w-20' : 'w-64'} bg-white border-r border-slate-200 hidden md:flex flex-col z-50 transition-all duration-300`}>
        <div className={`h-16 flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-6'} mb-4 border-b border-slate-100`}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold leading-none">L</div>
            {!isSidebarCollapsed && <span className="text-lg font-bold tracking-tight text-slate-900">LedgerFlow</span>}
          </div>
          {!isSidebarCollapsed && (
            <button 
               onClick={() => setIsSidebarCollapsed(true)}
               className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-1 px-4">
          {isSidebarCollapsed && (
            <button 
               onClick={() => setIsSidebarCollapsed(false)}
               className="w-full flex justify-center py-2 mb-4 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}
          <SidebarLink
             icon={<LayoutDashboard className="w-4 h-4" />}
             label="Dashboard"
             active={activeTab === 'dashboard'}
             collapsed={isSidebarCollapsed}
             onClick={() => {
               setActiveTab('dashboard');
               setEditingTransaction(null);
             }}
          />
          <SidebarLink
             icon={<ListFilter className="w-4 h-4" />}
             label="Statement"
             active={activeTab === 'history'}
             collapsed={isSidebarCollapsed}
             onClick={() => {
               setActiveTab('history');
               setEditingTransaction(null);
             }}
          />
          <SidebarLink
             icon={<PlusCircle className="w-4 h-4" />}
             label="New Entry"
             active={activeTab === 'add' && !editingTransaction}
             collapsed={isSidebarCollapsed}
             onClick={() => {
               setEditingTransaction(null);
               setActiveTab('add');
             }}
          />
          <SidebarLink
             icon={<PiggyBank className="w-4 h-4" />}
             label="Savings"
             active={activeTab === 'savings'}
             collapsed={isSidebarCollapsed}
             onClick={() => {
               setEditingTransaction(null);
               setActiveTab('savings');
             }}
          />
          <SidebarLink
             icon={<Briefcase className="w-4 h-4" />}
             label="External Assets/Liabilities"
             active={activeTab === 'assets'}
             collapsed={isSidebarCollapsed}
             onClick={() => {
               setEditingTransaction(null);
               setActiveTab('assets');
             }}
          />
          <SidebarLink
             icon={<Landmark className="w-4 h-4" />}
             label="Financing"
             active={activeTab === 'financing'}
             collapsed={isSidebarCollapsed}
             onClick={() => {
               setEditingTransaction(null);
               setActiveTab('financing');
             }}
          />
          <SidebarLink
             icon={<Settings className="w-4 h-4" />}
             label="Configuration"
             active={activeTab === 'settings'}
             collapsed={isSidebarCollapsed}
             onClick={() => {
               setEditingTransaction(null);
               setActiveTab('settings');
             }}
          />
          
          <div className="pt-4 mt-4 border-t border-slate-100">
             {!isSidebarCollapsed && (
               <div className="px-4 mb-2">
                 <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Global Options</span>
               </div>
             )}
             <div className={`relative ${isSidebarCollapsed ? 'px-0' : 'px-4'}`}>
               <button 
                  onClick={() => setIsCurrencyMenuOpen(!isCurrencyMenuOpen)}
                  className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between px-3'} py-2 rounded-md bg-slate-50 border border-slate-100 hover:border-slate-200 transition-all group`}
               >
                 <div className="flex items-center gap-2">
                   <Globe className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600" />
                   {!isSidebarCollapsed && <span className="text-[11px] font-bold text-slate-600 uppercase">{profile?.currency || 'USD'}</span>}
                 </div>
                 {!isSidebarCollapsed && <span className="text-[10px] text-slate-300 font-mono">{currencies.find(c => c.code === (profile?.currency || 'USD'))?.symbol}</span>}
               </button>

               <AnimatePresence>
                 {isCurrencyMenuOpen && (
                   <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute bottom-full left-4 right-4 mb-2 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden"
                   >
                     {currencies.map((c) => (
                       <button
                          key={c.code}
                          onClick={() => {
                            updateCurrency(c.code);
                            setIsCurrencyMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-bold uppercase hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-none"
                       >
                         <span className={profile?.currency === c.code ? 'text-indigo-600' : 'text-slate-600'}>{c.code}</span>
                         <span className="text-slate-400 font-mono">{c.symbol}</span>
                       </button>
                     ))}
                   </motion.div>
                 )}
               </AnimatePresence>
             </div>
          </div>
        </nav>

        <div className="mt-auto p-4 border-t border-slate-100">
           <div className={`flex items-center gap-3 ${isSidebarCollapsed ? 'justify-center' : 'px-2'} mb-4`}>
             <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full ring-2 ring-indigo-50" referrerPolicy="no-referrer" />
             {!isSidebarCollapsed && (
               <div className="overflow-hidden min-w-0">
                 <p className="text-xs font-bold text-slate-900 truncate">{user.displayName}</p>
                 <p className="text-[10px] text-slate-400 truncate tracking-tight">{user.email}</p>
               </div>
             )}
           </div>
           <button
              onClick={signOut}
              className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-2 px-3'} py-2 rounded-md text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors`}
              title={isSidebarCollapsed ? "End Session" : ""}
           >
             <LogOut className="w-4 h-4" />
             {!isSidebarCollapsed && "End Session"}
           </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className={`flex-1 ${isSidebarCollapsed ? 'md:ml-20' : 'md:ml-64'} flex flex-col min-h-screen pb-16 md:pb-0 transition-all duration-300`}>
        <header className="h-14 md:h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 sticky top-0 z-40">
           <p className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-widest truncate max-w-[200px]">
            {activeTab === 'dashboard' ? 'Overview' : activeTab === 'history' ? 'Ledger statement' : activeTab === 'savings' ? 'Savings Strategies' : activeTab === 'assets' ? 'External Assets/Liabilities' : activeTab === 'financing' ? 'Financing & Loans' : activeTab === 'settings' ? 'Configuration' : editingTransaction ? 'Edit Transaction' : 'Draft Entry'}
          </p>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2">
                 <GmailSyncButton />
                 <div className="hidden sm:flex gap-2">
                   <SheetsButton />
                   <ExportMenu />
                 </div>
             </div>
             <div className="flex items-center gap-2">
               <span className="hidden sm:inline text-[10px] font-bold text-slate-300 uppercase">Status:</span>
               <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
               <span className="text-[10px] font-bold text-emerald-600 uppercase">Live</span>
             </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8">
           <AnimatePresence mode="wait">
             {activeTab === 'dashboard' && (
               <motion.div key="db" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                 <Dashboard onShowAdd={() => setActiveTab('add')} onEdit={handleEdit} />
               </motion.div>
             )}
             {activeTab === 'history' && (
               <motion.div key="hist" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                 <BalanceSheet onEdit={handleEdit} onShowAdd={() => setActiveTab('add')} />
               </motion.div>
             )}
             {activeTab === 'add' && (
               <motion.div key="add" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                 <TransactionForm 
                    initialData={editingTransaction} 
                    onSuccess={handleFormSuccess} 
                    onCancel={handleFormCancel}
                 />
               </motion.div>
             )}
             {activeTab === 'savings' && (
               <motion.div key="savings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                 <SavingsTab />
               </motion.div>
             )}
             {activeTab === 'assets' && (
               <motion.div key="assets" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                 <AssetsLiabilityTab />
               </motion.div>
             )}
             {activeTab === 'financing' && (
               <motion.div key="financing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                 <FinancingTab onComplete={() => setActiveTab('assets')} />
               </motion.div>
             )}
             {activeTab === 'settings' && (
               <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                 <SettingsTab />
               </motion.div>
             )}
           </AnimatePresence>
        </main>
      </div>

      {/* Mobile Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-slate-200 flex items-center justify-around md:hidden px-4 z-50">
        <MobileNavLink icon={<LayoutDashboard className="w-5 h-5" />} active={activeTab === 'dashboard'} onClick={() => { setActiveTab('dashboard'); setEditingTransaction(null); }} />
        <MobileNavLink icon={<ListFilter className="w-5 h-5" />} active={activeTab === 'history'} onClick={() => { setActiveTab('history'); setEditingTransaction(null); }} />
        <MobileNavLink icon={<PlusCircle className="w-5 h-5" />} active={activeTab === 'add'} onClick={() => { setActiveTab('add'); setEditingTransaction(null); }} />
        <MobileNavLink icon={<Briefcase className="w-5 h-5" />} active={activeTab === 'assets'} onClick={() => { setActiveTab('assets'); setEditingTransaction(null); }} />
        <MobileNavLink icon={<Landmark className="w-5 h-5" />} active={activeTab === 'financing'} onClick={() => { setActiveTab('financing'); setEditingTransaction(null); }} />
      </nav>
    </div>
  );
}

function SidebarLink({ icon, label, active, collapsed, onClick }: { icon: React.ReactNode, label: string, active: boolean, collapsed?: boolean, onClick: () => void }) {
  return (
    <button
       onClick={onClick}
       title={collapsed ? label : ""}
       className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3 px-4'} py-2.5 rounded-md transition-all duration-200 ${
         active 
           ? 'bg-slate-900 text-white shadow-md' 
           : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
       }`}
    >
      {icon}
      {!collapsed && <span className="font-semibold text-xs tracking-tight">{label}</span>}
    </button>
  );
}

function MobileNavLink({ icon, active, onClick }: { icon: React.ReactNode, active: boolean, onClick: () => void }) {
  return (
    <button onClick={onClick} className={`p-2 rounded-lg ${active ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}>
      {icon}
    </button>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

