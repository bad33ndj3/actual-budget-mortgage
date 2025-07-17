// actual-mortgage-interest.ts
// --------------------------------------------
// Automatically budget and book the mortgage-interest portion for each missing month.

import "dotenv/config";
import { format, parseISO, addMonths, isAfter, endOfMonth } from "date-fns";
import {
  init,
  downloadBudget,
  getAccounts,
  getCategories,
  getTransactions,
  addTransactions,
  shutdown,
  getAccountBalance,
} from "@actual-app/api";

/** Configuration loaded from environment variables */
type Cents = number;

interface Config {
  /** Actual server URL */
  url: string;
  /** Password for Actual server */
  password: string;
  /** Sync ID for budget */
  syncId: string;
  /** Name of the mortgage account */
  mortgageAccount: string;
  /** Name of the interest category */
  interestCategory: string;
  /** Annual interest rate as decimal (e.g. 0.04 for 4%) */
  annualRate: number;
  /** Day of month to book interest */
  bookingDay: number;
  /** Whether to run in dry-run mode (no posting) */
  dryRun: boolean;
  /** Optional start date for processing (YYYY-MM-DD) */
  fromDate?: string;
}

/** Represents an account in Actual */
interface Account {
  id: string;
  name: string;
  offbudget: boolean;
}

/** Represents a category in Actual */
interface Category {
  id: string;
  name: string;
}

/** Represents a transaction in Actual */
interface Transaction {
  imported_id: string;
  date: string;
  amount: number;
  account: string;
  payee_name: string;
  category: string;
  cleared: boolean;
  notes: string;
}

/** Booking and balance date information for a period */
interface BookingDates {
  bookDate: Date;
  asOfDate: Date;
}

interface ActualClient {
  init: (opts: {
    serverURL: string;
    password: string;
    dataDir: string;
  }) => Promise<void>;
  downloadBudget: (syncId: string) => Promise<void>;
  getAccounts: () => Promise<Account[]>;
  getCategories: () => Promise<Category[]>;
  getTransactions: (
    accountId: string,
    startDate: string,
    endDate: Date,
  ) => Promise<Transaction[]>;
  getAccountBalance: (accountId: string, asOfDate: Date) => Promise<number>;
  addTransactions: (
    accountId: string,
    transactions: Transaction[],
    options: { runTransfers: boolean; learnCategories: boolean },
  ) => Promise<void>;
  shutdown: () => Promise<void>;
}

export function loadConfig(): Config {
  const required = ["ACTUAL_URL", "ACTUAL_PASSWORD", "ACTUAL_SYNC_ID"] as const;
  for (const k of required) {
    if (!process.env[k]) {
      console.error(`Missing env var ${k}`);
      process.exit(1);
    }
  }
  return {
    url: process.env.ACTUAL_URL!,
    password: process.env.ACTUAL_PASSWORD!,
    syncId: process.env.ACTUAL_SYNC_ID!,
    mortgageAccount: process.env.MORTGAGE_ACCOUNT ?? "Hypotheek",
    interestCategory: process.env.INTEREST_CATEGORY ?? "Wonen: Hypotheekrente",
    annualRate: Number(process.env.ANNUAL_RATE ?? "0.04"),
    bookingDay: Number(process.env.BOOKING_DAY ?? "25"),
    dryRun: process.env.DRY_RUN === "true",
    fromDate: process.env.FROM_DATE, // e.g. "2024-01-01"
  };
}

export function calculateMonthlyInterest(
  balanceCents: Cents,
  annualRate: number,
): Cents {
  // Calculate monthly interest using compound interest formula
  // This is more accurate for mortgage calculations
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  const interestCents = Math.round(balanceCents * monthlyRate);
  return interestCents;
}

export function calculateMonthlyInterestDailyMethod(
  balanceCents: Cents,
  annualRate: number,
  monthDate: Date,
): Cents {
  // Alternative method using actual days in month
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dailyRate = annualRate / 365;
  const monthlyRate = dailyRate * daysInMonth;
  const interestCents = Math.round(balanceCents * monthlyRate);
  return interestCents;
}

/** Find the mortgage account by name, warn if on-budget */
function findMortgageAccount(
  accounts: Account[],
  mortgageAccountName: string,
): Account {
  const mortgage = accounts.find((a) => a.name === mortgageAccountName);
  if (!mortgage) throw new Error(`Account '${mortgageAccountName}' not found.`);
  if (!mortgage.offbudget)
    console.warn(
      "⚠️ Mortgage account is on-budget; consider marking it off-budget.",
    );
  return mortgage;
}

/** Find the interest category by name */
function findInterestCategory(
  categories: Category[],
  interestCategoryName: string,
): Category {
  const cat = categories.find((c) => c.name === interestCategoryName);
  if (!cat) throw new Error(`Category '${interestCategoryName}' not found.`);
  return cat;
}

/** Determine the start date for processing based on config or today */
function getCursorStartDate(cfg: Config, today: Date): Date {
  if (cfg.fromDate) {
    const parsed = parseISO(cfg.fromDate);
    if (isNaN(parsed.getTime())) {
      throw new Error(`Invalid FROM_DATE: ${cfg.fromDate}`);
    }
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  } else {
    return new Date(today.getFullYear(), today.getMonth(), 1);
  }
}

/** Check if interest transaction with importedId already exists */
async function hasPostedInterest(
  transactions: Transaction[],
  importedId: string,
): Promise<boolean> {
  return transactions.some((t) => t.imported_id === importedId);
}

/** Calculate booking and as-of dates for a given month cursor */
function calculateBookingDates(cursor: Date, bookingDay: number): BookingDates {
  const lastDay = endOfMonth(cursor).getDate();
  const bookingDayAdjusted = Math.min(bookingDay, lastDay);
  const bookDate = new Date(
    cursor.getFullYear(),
    cursor.getMonth(),
    bookingDayAdjusted,
  );
  const asOfDate = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  asOfDate.setDate(asOfDate.getDate() - 1);
  if (isNaN(bookDate.getTime()) || isNaN(asOfDate.getTime())) {
    throw new Error(
      `Invalid booking or asOf date for period ${format(cursor, "yyyy-MM")}`,
    );
  }
  return { bookDate, asOfDate };
}

/** Log details about the interest booking period */
function logPeriodDetails(
  period: string,
  bookDateStr: string,
  asOf: string,
  balanceEuros: number,
  interestCents: Cents,
): void {
  console.log(`→ ${period}: booking date ${bookDateStr}, as of ${asOf}`);
  console.log(
    `→ ${period}: balance €${balanceEuros.toFixed(2)}, interest €${(interestCents / 100).toFixed(2)}`,
  );
}

/** Post the interest transaction unless dryRun is true */
async function postInterestTransaction(
  mortgageId: string,
  interestCents: Cents,
  catId: string,
  importedId: string,
  bookDate: Date,
  period: string,
  dryRun: boolean,
  addTransactions: ActualClient["addTransactions"],
): Promise<void> {
  if (dryRun) {
    console.log(
      `(dry-run) Would post interest for ${period}: ${interestCents} cents`,
    );
    return;
  }
  await addTransactions(
    mortgageId,
    [
      {
        date: format(bookDate, "yyyy-MM-dd"),
        amount: interestCents,
        account: mortgageId,
        payee_name: "Hypotheekrente",
        category: catId,
        cleared: true,
        imported_id: importedId,
        notes: `Auto-generated hypotheekrente voor ${period}`,
      },
    ],
    { runTransfers: false, learnCategories: false },
  );
  console.log(`✔️ Posted ${period}`);
}

export class MortgageInterestService {
  private config: Config;
  private client: ActualClient;
  private mortgage!: Account;
  private category!: Category;

  constructor(client: ActualClient) {
    this.config = loadConfig();
    this.client = client;
  }

  async initialize(): Promise<void> {
    console.log("Connecting to Actual server …");
    await this.client.init({
      serverURL: this.config.url,
      password: this.config.password,
      dataDir: process.env.DATA_DIR || ".cache",
    });
    await this.client.downloadBudget(this.config.syncId);

    const accounts = await this.client.getAccounts();
    this.mortgage = findMortgageAccount(accounts, this.config.mortgageAccount);
    const categories = await this.client.getCategories();
    this.category = findInterestCategory(categories, this.config.interestCategory);
  }

  private async processPeriod(cursor: Date): Promise<void> {
    const period = format(cursor, "yyyy-MM");
    const importedId = `interest-${period}`;
    const existing = await this.client.getTransactions(
      this.mortgage.id,
      format(cursor, "yyyy-MM-01"),
      new Date(),
    );
    if (await hasPostedInterest(existing, importedId)) {
      console.log(`→ ${period}: already posted, skipping.`);
      return;
    }

    const { bookDate, asOfDate } = calculateBookingDates(
      cursor,
      this.config.bookingDay,
    );
    const asOf = format(asOfDate, "yyyy-MM-dd");
    const bookDateStr = format(bookDate, "yyyy-MM-dd");

    const balanceCents = await this.client.getAccountBalance(
      this.mortgage.id,
      asOfDate,
    );
    const interestCents = calculateMonthlyInterest(
      balanceCents,
      this.config.annualRate,
    );
    const balanceEuros = balanceCents / 100;
    // const monthlyRate = Math.pow(1 + this.config.annualRate, 1 / 12) - 1;

    logPeriodDetails(period, bookDateStr, asOf, balanceEuros, interestCents);

    await postInterestTransaction(
      this.mortgage.id,
      interestCents,
      this.category.id,
      importedId,
      bookDate,
      period,
      this.config.dryRun,
      this.client.addTransactions,
    );
  }

  async run(): Promise<void> {
    await this.initialize();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let cursor = getCursorStartDate(this.config, today);

    while (!isAfter(cursor, today)) {
      await this.processPeriod(cursor);
      cursor = addMonths(cursor, 1);
    }

    try {
      await this.client.shutdown();
    } catch (err) {
      console.error("Error during shutdown:", err);
    }
    console.log("✅ All done.");
  }
}

export async function main() {
  const service = new MortgageInterestService({
    init,
    downloadBudget,
    getAccounts,
    getCategories,
    getTransactions,
    getAccountBalance,
    addTransactions: (accountId, transactions, options) => {
      return addTransactions(accountId, transactions, options).then(() => {});
    },
    shutdown,
  });
  await service.run();
}

if (process.env.NODE_ENV !== "test") {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
