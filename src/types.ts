export type TransactionType = 'income' | 'expense';
export type Frequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Transaction {
  id?: string;
  userId: string;
  type: TransactionType;
  category: string;
  amount: number;
  description: string;
  date: string;
  isRecurring: boolean;
  frequency: Frequency;
  dayOfMonth?: number; // 1-31
  dayOfWeek?: number; // 0-6
  fundedBySavings?: boolean;
  savingsCap?: number;
  fundedByAssetId?: string;
  linkedAssetId?: string; // For scheduling payments/collections against an asset
  endDate?: string; // To limit recurring transactions
  createdAt: string;
  updatedAt: string;
  occurrenceId?: string;
  excludedDates?: string[]; // Array of ISO date strings to skip in recurrence
}

export interface AssetLiability {
  id?: string;
  userId: string;
  name: string;
  type: 'receivable' | 'payable' | 'asset' | 'liability';
  totalAmount: number;
  currentBalance: number;
  description: string;
  isActive: boolean;
  linkedTransactionIds?: string[]; // Optional: tracking transactions linked to this position
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  userId: string;
  email: string | null;
  currency: string;
}

export interface SavingsStrategy {
  id?: string;
  userId: string;
  name: string;
  calculationType?: 'percentage' | 'fixed' | 'sweep';
  percentage?: number;
  fixedAmount?: number;
  leaveAmount?: number;
  frequency: Frequency;
  dayOfMonth: number; // For monthly/yearly (1-31)
  dayOfWeek?: number; // For weekly (0-6)
  minAmount?: number;
  maxAmount?: number;
  isActive: boolean;
  updatedAt: string;
}
