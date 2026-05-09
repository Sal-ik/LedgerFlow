import React, { useState, useEffect } from 'react';
import { Mail, FileSpreadsheet, Save, Loader2, CheckCircle2 } from 'lucide-react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';

export const SettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [dailyEmail, setDailyEmail] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetchSettings = async () => {
      try {
        const d = await getDoc(doc(db, 'users', user.uid));
        if (d.exists()) {
          const data = d.data();
          setDailyEmail(data.dailyEmailSubscription || false);
          setSheetUrl(data.googleSheetUrl || '');
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'users');
      }
    };
    fetchSettings();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setSaved(false);
    try {
      await setDoc(doc(db, 'users', user.uid), {
        dailyEmailSubscription: dailyEmail,
        googleSheetUrl: sheetUrl,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto p-4 md:p-8">
      <div className="grid gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Email Subscriptions</h2>
              <p className="text-xs text-slate-500">Manage your daily statement delivery</p>
            </div>
          </div>
          
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative flex items-center h-5 mt-0.5">
              <input
                type="checkbox"
                checked={dailyEmail}
                onChange={(e) => setDailyEmail(e.target.checked)}
                className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-600 transition-colors"
              />
            </div>
            <div>
              <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">Subscribe to daily statements</span>
              <p className="text-xs text-slate-500 mt-1">Receive a comprehensive daily summary of your ledger, projected savings, and asset positions directly in your inbox.</p>
            </div>
          </label>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800">Google Sheets Sync</h2>
              <p className="text-xs text-slate-500">Provide the URL to your live-synced Google Sheet</p>
            </div>
          </div>
          
          <div className="space-y-3">
            <input
              type="url"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all placeholder:text-slate-400"
            />
            <p className="text-[11px] text-slate-500">
              This url is launched when you click the "Sheets" button in your navbar. Note that the AI assistant cannot directly authenticate with your Google Drive or automatically install App Scripts. However, you can set it up yourself following the guide below.
            </p>
            <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
               <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-widest mb-2">How to Automate Live Sync</h4>
               <ol className="text-[10px] text-slate-500 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                  <li>Open your Google Sheet and click <b>Extensions &gt; Apps Script</b>.</li>
                  <li>In the Apps Script editor, you will write a script to fetch data from Firestore via its REST API.</li>
                  <li>Use your Firebase Project ID: <b>ledgeflow</b>.</li>
                  <li>Set up a time-driven trigger (e.g., daily) to run your `syncFirebaseToSheets` function automatically.</li>
               </ol>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none shadow-sm"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4" />}
          {saved ? 'Saved Successfully' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
};
