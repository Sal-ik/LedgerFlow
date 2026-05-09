import React, { useEffect, useState } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { ExternalLink } from 'lucide-react';

export const SheetsButton: React.FC = () => {
  const { user } = useAuth();
  const [sheetUrl, setSheetUrl] = useState('');

  useEffect(() => {
    if (!user) return;
    const loadUrl = async () => {
      try {
        const d = await getDoc(doc(db, 'users', user.uid));
        if (d.exists() && d.data().googleSheetUrl) {
          setSheetUrl(d.data().googleSheetUrl);
        }
      } catch (e) {
        handleFirestoreError(e, OperationType.GET, 'users');
      }
    };
    loadUrl();
  }, [user]);

  const handleClick = () => {
    if (sheetUrl) {
      window.open(sheetUrl, '_blank', 'noopener,noreferrer');
    } else {
      alert('Please configure your Google Sheets URL in the Settings configuration.');
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md text-[11px] font-bold transition-colors uppercase tracking-tight whitespace-nowrap"
      title="Open configured Google Sheet"
    >
      <ExternalLink className="w-3.5 h-3.5" />
      Sheets
    </button>
  );
};
