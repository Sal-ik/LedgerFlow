import React from 'react';
import { AlertCircle, X } from 'lucide-react';

interface Choice {
  id: string;
  label: string;
  description?: string;
  isDestructive?: boolean;
  onClick: () => void;
}

interface ActionDialogProps {
  isOpen: boolean;
  title: string;
  message?: string;
  choices: Choice[];
  onCancel: () => void;
}

export function ActionDialog({
  isOpen,
  title,
  message,
  choices,
  onCancel,
}: ActionDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-900">{title}</h3>
          <button onClick={onCancel} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        {message && (
          <div className="p-4 pb-0 text-sm text-slate-600 whitespace-pre-wrap">
            {message}
          </div>
        )}
        <div className="p-4 space-y-2">
          {choices.map((choice) => (
            <button
              key={choice.id}
              onClick={() => {
                choice.onClick();
                onCancel();
              }}
              className={`w-full text-left p-3 rounded-xl border transition-all ${
                choice.isDestructive 
                  ? 'border-rose-100 bg-rose-50 hover:bg-rose-100 hover:border-rose-200 text-rose-700' 
                  : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-900'
              }`}
            >
              <p className="font-bold text-sm tracking-tight">{choice.label}</p>
              {choice.description && (
                <p className={`text-xs mt-0.5 ${choice.isDestructive ? 'text-rose-600/70' : 'text-slate-500'}`}>
                  {choice.description}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
