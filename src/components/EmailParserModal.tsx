import React, { useState } from 'react';
import { X, Wand2, KeyRound } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";

interface ParsedData {
  amount: number;
  type: 'income' | 'expense';
  category: string;
  description: string;
  date: string;
}

interface EmailParserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onParseSuccess: (data: ParsedData) => void;
}

export const EmailParserModal: React.FC<EmailParserModalProps> = ({ isOpen, onClose, onParseSuccess }) => {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleParse = async () => {
    if (!text.trim()) {
      setError('Please paste the email content');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('Gemini API key is not configured.');
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Parse the following bank/email alert text and extract transaction details.
Text:
${text}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              amount: { type: Type.NUMBER, description: "The transaction amount as a number." },
              type: { type: Type.STRING, description: "income or expense" },
              category: { type: Type.STRING, description: "Short category name or payee name" },
              description: { type: Type.STRING, description: "A brief description of the transaction based on the alert" },
              date: { type: Type.STRING, description: "The transaction date in YYYY-MM-DD format. E.g. '2026-05-08'" }
            },
            required: ['amount', 'type', 'category', 'description', 'date']
          }
        }
      });

      const parsedJson = JSON.parse(response.text.trim());
      onParseSuccess(parsedJson as ParsedData);
      onClose();
    } catch (err) {
      console.error(err);
      setError('Failed to parse email. Please check the content and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <Wand2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest">AI Parse Email Alert</h3>
              <p className="text-[10px] font-medium text-slate-500">Extract transaction details automatically</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-4">
           {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-100 text-rose-600 text-xs font-bold">
              {error}
            </div>
          )}
          
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Paste Email / SMS Content</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Dear user, you paid PKR 50.00 to..."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-sm h-48 resize-none"
            />
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
          <button 
            type="button" 
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-lg uppercase tracking-wider transition-colors"
          >
            Cancel
          </button>
          <button 
            type="button"
            onClick={handleParse}
            disabled={loading || !text.trim()}
            className="px-6 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg uppercase tracking-wider shadow-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            {loading ? 'Analyzing...' : (
              <>
                <Wand2 className="w-3.5 h-3.5" />
                Parse Data
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
