import React, { useState, useRef, useEffect } from 'react';
import { RefreshCw, Mail, ChevronDown, Calendar } from 'lucide-react';
import { auth, googleProvider, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { collection, addDoc, serverTimestamp, getDocs, query, where } from 'firebase/firestore';
import { GoogleGenAI, Type } from "@google/genai";

interface ParsedTransaction {
  amount: number;
  type: 'income' | 'expense';
  category: string;
  description: string;
  date: string;
  transactionId: string;
}

export const GmailSyncButton = () => {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncedCount, setSyncedCount] = useState<number | null>(null);
  const [syncedTransactions, setSyncedTransactions] = useState<ParsedTransaction[] | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [daysToSync, setDaysToSync] = useState(3);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowOptions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSync = async () => {
    setShowOptions(false);
    setSyncing(true);
    setError(null);
    setSyncedCount(null);
    setSyncedTransactions(null);

    try {
      if (!auth.currentUser) throw new Error("Must be logged in to sync.");
      
      let token = sessionStorage.getItem('gmail_auth_token');
      let tokenExpiry = sessionStorage.getItem('gmail_auth_token_expiry');

      if (!token || !tokenExpiry || Date.now() > parseInt(tokenExpiry, 10)) {
        try {
           const result = await signInWithPopup(auth, googleProvider);
           const credential = GoogleAuthProvider.credentialFromResult(result);
           if (!credential?.accessToken) throw new Error("No access token.");
           token = credential.accessToken;
           sessionStorage.setItem('gmail_auth_token', token);
           sessionStorage.setItem('gmail_auth_token_expiry', (Date.now() + 50 * 60 * 1000).toString());
        } catch (err) {
           console.error("Popup Error:", err);
           throw new Error("Failed to get Gmail permissions. Make sure to allow them.");
        }
      }

      // Use newer_than to securely match recent emails
      const qStr = encodeURIComponent(`("PKR" OR "Rs" OR "transaction" OR "paid" OR "debit" OR "credit" OR "Raast") newer_than:${daysToSync}d`);
      
      const listReq = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${qStr}&maxResults=50`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const listData = await listReq.json();
      
      if (!listReq.ok) {
         sessionStorage.removeItem('gmail_auth_token');
         sessionStorage.removeItem('gmail_auth_token_expiry');
         throw new Error(`Gmail API Error: ${listData.error?.message || 'Unknown error'}. You may need to sign out and sign in again to grant email permissions.`);
      }

      const messages = listData.messages || [];
      
      if (messages.length === 0) {
        throw new Error(`Found 0 emails matching search in the last ${daysToSync} days.`);
      }

      const emailBodies: { id: string, text: string }[] = [];
      for (const msg of messages) {
         try {
           const msgReq = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
              headers: { Authorization: `Bearer ${token}` }
           });
           const msgData = await msgReq.json();
           
           const getBody = (payload: any): string => {
             let bodyData = '';
             
             const findPart = (parts: any[], mimeType: string): string | null => {
                 for (const part of parts) {
                     if (part.mimeType === mimeType && part.body && part.body.data) {
                         return part.body.data;
                     }
                     if (part.parts) {
                         const found = findPart(part.parts, mimeType);
                         if (found) return found;
                     }
                 }
                 return null;
             };

             if (payload.parts) {
                 bodyData = findPart(payload.parts, 'text/plain') || findPart(payload.parts, 'text/html') || '';
             }
             if (!bodyData && payload.body && payload.body.data) {
                 bodyData = payload.body.data;
             }
             
             if (bodyData) {
               try {
                 let b64 = bodyData.replace(/-/g, '+').replace(/_/g, '/');
                 while (b64.length % 4 > 0) b64 += '=';
                 const decoded = decodeURIComponent(escape(atob(b64)));
                 return decoded.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
               } catch(e) {
                 try {
                   let b64 = bodyData.replace(/-/g, '+').replace(/_/g, '/');
                   while (b64.length % 4 > 0) b64 += '=';
                   return atob(b64).replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
                 } catch(ex) {
                    console.error("Failed base64 decoding for message", msg.id, ex);
                    return '';
                 }
               }
             }
             return '';
           };
           
           const bodyText = getBody(msgData.payload);
           if (bodyText) {
              emailBodies.push({ id: msgData.id, text: bodyText.substring(0, 4000) });
           }
         } catch(e) {
             console.error("Error fetching individual message text", e);
         }
      }

      console.log(`Fetched ${messages.length} messages, successfully extracted text for ${emailBodies.length} of them`);

      if (emailBodies.length === 0) {
        throw new Error(`Found emails but failed to extract their text content. They might be attachments or unsupported formats.`);
      }

      if (!process.env.GEMINI_API_KEY) {

        throw new Error('Gemini API key is not configured.');
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `You are a financial email parser. Given the following array of email snippets (Bank alerts, payment confirmations, etc.), extract all valid transactions.
For each valid transaction found, return an object. If an email is not a transaction, ignore it.
Output must be a JSON array of objects.

Examples of transaction texts:
"You paid PKR. 50.00 to MUHAMMAD RIZWAN via Raast... Transaction ID: 1180948627" -> 
{ "amount": 50, "type": "expense", "category": "MUHAMMAD RIZWAN", "description": "Raast Transfer", "date": "2026-05-08", "transactionId": "1180948627" }

"A debit transaction of PKR. 2,100.00 was made... Beneficiary: TAMKEEN RABBANI KHAN... Transaction ID: 1179686189" ->
{ "amount": 2100, "type": "expense", "category": "TAMKEEN RABBANI KHAN", "description": "Inter Bank Funds Transfer", "date": "2026-05-07", "transactionId": "1179686189" }

Emails:
${JSON.stringify(emailBodies)}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            description: "List of extracted transactions",
            items: {
              type: Type.OBJECT,
              properties: {
                amount: { type: Type.NUMBER, description: "Transaction amount" },
                type: { type: Type.STRING, description: "income or expense" },
                category: { type: Type.STRING, description: "Vendor, person name or category" },
                description: { type: Type.STRING, description: "Context from the email" },
                date: { type: Type.STRING, description: "YYYY-MM-DD" },
                transactionId: { type: Type.STRING, description: "A unique identifier or the email ID. Use email ID if none found in text." }
              },
              required: ['amount', 'type', 'category', 'description', 'date', 'transactionId']
            }
          }
        }
      });

      const parsedJson: ParsedTransaction[] = JSON.parse(response.text.trim() || '[]');
      console.log('Gemini Extracted:', parsedJson);
      
      const recentQ = query(collection(db, 'transactions'), where('userId', '==', auth.currentUser.uid));
      const recentSnap = await getDocs(recentQ);
      const existingDocs = recentSnap.docs.map(d => d.data());

      let newCount = 0;
      const newTransactionsList: ParsedTransaction[] = [];
      
      for (const t of parsedJson) {
        // Prevent duplicate sync using transactionId or similar unique field we could store in the description or native metadata 
        if (!t?.amount || !t?.date) {
            console.warn("Skipping invalid parsed row:", t);
            continue;
        }

        let exists = false;
        for (const d of existingDocs) {
           if (t.transactionId && d.description && String(d.description).includes(`[Email Sync - ${t.transactionId}]`)) {
             exists = true; break;
           }
        }
        
        if (!exists) {
           await addDoc(collection(db, 'transactions'), {
              userId: auth.currentUser.uid,
              type: t.type || 'expense',
              amount: t.amount,
              date: new Date(t.date).toISOString(),
              category: t.category,
              description: `[Email Sync - ${t.transactionId}] ${t.description}`,
              isRecurring: false,
              frequency: 'none',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
           }).catch(err => handleFirestoreError(err, OperationType.CREATE, 'transactions'));
           
           // Keep track of newly added transactions to prevent duplicate parsing in the same batch
           existingDocs.push({
              amount: t.amount,
              description: `[Email Sync - ${t.transactionId}] ${t.description}`
           } as any);

           newCount++;
           newTransactionsList.push(t);
        }
      }

      setSyncedCount(newCount);
      setSyncedTransactions(newTransactionsList);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      // Don't auto-dismiss if it's the API disabled error so the user has time to click it
      if (!(err instanceof Error && err.message.includes('console.developers.google.com'))) {
         setTimeout(() => { setError(null); }, 7000);
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="relative group" ref={dropdownRef}>
      <div className="flex bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-all divide-x divide-slate-200 hover:divide-slate-300">
        <button 
          onClick={handleSync} 
          disabled={syncing}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-indigo-600 rounded-l-lg"
          title={`Sync Gmail Transactions (Last ${daysToSync} days)`}
        >
          <Mail className="w-4 h-4" />
          <span className="hidden md:inline">{syncing ? 'Scanning Inbox...' : `Auto-Sync (${daysToSync}d)`}</span>
          {syncing && <RefreshCw className="w-3 h-3 animate-spin" />}
        </button>
        <button
          disabled={syncing}
          onClick={() => setShowOptions(!showOptions)}
          className="px-2 py-1.5 flex items-center justify-center text-slate-500 hover:text-indigo-600 rounded-r-lg"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${showOptions ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {showOptions && (
        <div className="absolute top-full mt-2 right-0 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden py-1">
           <div className="px-3 py-2 border-b border-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
             <Calendar className="w-3 h-3" />
             Select Timespan
           </div>
           {[1, 3, 7, 30].map(days => (
             <button
               key={days}
               onClick={() => { setDaysToSync(days); setShowOptions(false); }}
               className={`w-full text-left px-3 py-2 text-xs font-bold hover:bg-indigo-50 transition-colors flex items-center justify-between ${daysToSync === days ? 'text-indigo-600 bg-indigo-50/50' : 'text-slate-600'}`}
             >
               Last {days} {days === 1 ? 'Day' : 'Days'}
               {daysToSync === days && <div className="w-1.5 h-1.5 rounded-full bg-indigo-600" />}
             </button>
           ))}
        </div>
      )}
      
      {error && (
        <div className="absolute top-10 right-0 w-80 p-3 bg-white shadow-xl border border-rose-100 rounded-xl z-50 text-xs font-bold text-rose-600 text-left">
          <div className="flex justify-between items-start mb-1">
             <span className="font-bold text-rose-700">Sync Error</span>
             <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-700 text-lg leading-none">&times;</button>
          </div>
          {error.includes('console.developers.google.com') ? (
            <div className="space-y-2">
              <p>The Gmail API has not been enabled for your project.</p>
              <a 
                href={error.match(/https:\/\/[^\s]+/)?.[0]} 
                target="_blank" 
                rel="noreferrer" 
                className="inline-block px-3 py-1.5 bg-rose-100 text-rose-700 rounded-lg hover:bg-rose-200 transition-colors"
               >
                Click here to enable it
              </a>
              <p className="text-[10px] text-rose-500">Wait about 1 minute after enabling, then try syncing again.</p>
            </div>
          ) : (
            error
          )}
        </div>
      )}
      
      {syncedTransactions !== null && !error && (
        <div className="absolute top-12 right-0 w-80 p-4 bg-white shadow-xl border border-emerald-100 rounded-xl z-50 text-sm md:w-[28rem] text-left transform origin-top-right transition-all">
          <div className="font-bold text-emerald-600 mb-3 flex items-center gap-2 border-b border-emerald-50 pb-2">
            <span className="flex-1">Successfully synced {syncedTransactions.length} new transaction(s)!</span>
            <button onClick={() => { setSyncedTransactions(null); setSyncedCount(null); }} className="text-emerald-400 hover:text-emerald-600 transition-colors">
              &times;
            </button>
          </div>
          {syncedTransactions.length > 0 && (
            <div className="max-h-[300px] overflow-y-auto space-y-2 mb-3 pr-2 custom-scrollbar">
              {syncedTransactions.map((tx, i) => (
                <div key={i} className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs transition-colors hover:border-emerald-200 hover:bg-emerald-50/30">
                  <div className="flex justify-between items-start mb-1.5">
                    <span className="font-bold text-slate-700 truncate pr-2">{tx.category}</span>
                    <span className={`font-bold whitespace-nowrap ${tx.type === 'expense' ? 'text-rose-500' : 'text-emerald-500'}`}>
                      {tx.type === 'expense' ? '-' : '+'}PKR {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="text-slate-500 text-xs line-clamp-2">{tx.description}</div>
                  <div className="text-slate-400 text-[10px] mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5">
                     <span>{new Date(tx.date).toLocaleDateString()}</span>
                     <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[9px] truncate max-w-[150px]">ID: {tx.transactionId}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button 
             onClick={() => { setSyncedTransactions(null); setSyncedCount(null); }} 
             className="w-full py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};
