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
    setBudgetAmount,
    shutdown,
    getAccountBalance,
} from "@actual-app/api";

interface Config {
    url: string;
    password: string;
    syncId: string;
    mortgageAccount: string;
    interestCategory: string;
    annualRate: number;
    bookingDay: number;
    dryRun: boolean;
    fromDate?: string;
}

interface Account {
    id: string;
    name: string;
    offbudget: boolean;
}

interface Category {
    id: string;
    name: string;
}

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

interface BookingDates {
    bookDate: Date;
    asOfDate: Date;
}

interface Dependencies {
    init: (opts: { serverURL: string; password: string; dataDir: string }) => Promise<void>;
    downloadBudget: (syncId: string) => Promise<void>;
    getAccounts: () => Promise<Account[]>;
    getCategories: () => Promise<Category[]>;
    getTransactions: (accountId: string, startDate: string, endDate: Date) => Promise<Transaction[]>;
    getAccountBalance: (accountId: string, asOfDate: Date) => Promise<number>;
    setBudgetAmount: (period: string, categoryId: string, amountCents: number) => Promise<void>;
    addTransactions: (accountId: string, transactions: Transaction[], options: { runTransfers: boolean; learnCategories: boolean }) => Promise<void>;
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

export function calculateMonthlyInterest(balanceCents: number, annualRate: number): number {
    // Calculate monthly interest based on annual rate and days in month
    const daysInMonth = 30; // Approximate average month length
    const dailyRate = annualRate / 365;
    const monthlyRate = dailyRate * daysInMonth;
    const interestCents = Math.round(balanceCents * monthlyRate);
    return interestCents;
}

function toMilli(amount: number): number {
    return Math.round(amount * 100);
}

async function initializeConnection(cfg: Config, deps: Dependencies): Promise<void> {
    console.log("Connecting to Actual server …");
    await deps.init({ serverURL: cfg.url, password: cfg.password, dataDir: process.env.DATA_DIR || ".cache" });
    await deps.downloadBudget(cfg.syncId);
}

function findMortgageAccount(accounts: Account[], mortgageAccountName: string): Account {
    const mortgage = accounts.find(a => a.name === mortgageAccountName);
    if (!mortgage) throw new Error(`Account '${mortgageAccountName}' not found.`);
    if (!mortgage.offbudget) console.warn("⚠️ Mortgage account is on-budget; consider marking it off-budget.");
    return mortgage;
}

function findInterestCategory(categories: Category[], interestCategoryName: string): Category {
    const cat = categories.find(c => c.name === interestCategoryName);
    if (!cat) throw new Error(`Category '${interestCategoryName}' not found.`);
    return cat;
}

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

async function hasPostedInterest(transactions: Transaction[], importedId: string): Promise<boolean> {
    return transactions.some(t => t.imported_id === importedId);
}

function calculateBookingDates(cursor: Date, bookingDay: number): BookingDates {
    const lastDay = endOfMonth(cursor).getDate();
    const bookingDayAdjusted = Math.min(bookingDay, lastDay);
    const bookDate = new Date(cursor.getFullYear(), cursor.getMonth(), bookingDayAdjusted);
    const asOfDate = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    asOfDate.setDate(asOfDate.getDate() - 1);
    if (isNaN(bookDate.getTime()) || isNaN(asOfDate.getTime())) {
        throw new Error(`Invalid booking or asOf date for period ${format(cursor, "yyyy-MM")}`);
    }
    return { bookDate, asOfDate };
}

function logPeriodDetails(period: string, bookDateStr: string, asOf: string, balanceEuros: number, interestCents: number, monthlyRate: number): void {
    console.log(`→ ${period}: booking date ${bookDateStr}, as of ${asOf}`);
    console.log(`→ ${period}: balance €${balanceEuros.toFixed(2)}, interest €${(interestCents / 100).toFixed(2)}`);
}

async function postInterestTransaction(
    mortgageId: string,
    interestCents: number,
    catId: string,
    importedId: string,
    bookDate: Date,
    period: string,
    dryRun: boolean,
    addTransactions: Dependencies["addTransactions"]
): Promise<void> {
    if (dryRun) {
        console.log(`(dry-run) Would post interest for ${period}: ${interestCents} cents`);
        return;
    }
    await addTransactions(mortgageId, [
        {
            date: format(bookDate, "yyyy-MM-dd"),
            amount: interestCents,
            account: mortgageId,
            payee_name: "Hypotheekrente",
            category: catId,
            cleared: true,
            imported_id: importedId,
            notes: `Auto-generated hypotheekrente voor ${period}`,
        }
    ], { runTransfers: false, learnCategories: false });
    console.log(`✔️ Posted ${period}`);
}

async function processPeriod(
    cursor: Date,
    cfg: Config,
    mortgage: Account,
    cat: Category,
    getTransactions: Dependencies["getTransactions"],
    getAccountBalance: Dependencies["getAccountBalance"],
    addTransactions: Dependencies["addTransactions"]
): Promise<void> {
    const period = format(cursor, "yyyy-MM");
    const importedId = `interest-${period}`;
    const existing = await getTransactions(mortgage.id, format(cursor, "yyyy-MM-01"), new Date());
    if (await hasPostedInterest(existing, importedId)) {
        console.log(`→ ${period}: already posted, skipping.`);
        return;
    }

    const { bookDate, asOfDate } = calculateBookingDates(cursor, cfg.bookingDay);
    const asOf = format(asOfDate, "yyyy-MM-dd");
    const bookDateStr = format(bookDate, "yyyy-MM-dd");

    const balanceCents = await getAccountBalance(mortgage.id, asOfDate);
    const interestCents = calculateMonthlyInterest(balanceCents, cfg.annualRate);
    const balanceEuros = balanceCents / 100;
    const monthlyRate = Math.pow(1 + cfg.annualRate, 1 / 12) - 1;

    logPeriodDetails(period, bookDateStr, asOf, balanceEuros, interestCents, monthlyRate);

    await postInterestTransaction(mortgage.id, interestCents, cat.id, importedId, bookDate, period, cfg.dryRun, addTransactions);
}

export async function mainWithDeps(deps: Dependencies) {
    const cfg = loadConfig();
    await initializeConnection(cfg, deps);

    const accounts = await deps.getAccounts();
    const mortgage = findMortgageAccount(accounts, cfg.mortgageAccount);

    const categories = await deps.getCategories();
    const cat = findInterestCategory(categories, cfg.interestCategory);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let cursor = getCursorStartDate(cfg, today);

    while (!isAfter(cursor, today)) {
        await processPeriod(cursor, cfg, mortgage, cat, deps.getTransactions, deps.getAccountBalance, deps.addTransactions);
        cursor = addMonths(cursor, 1);
    }

    try {
        await deps.shutdown();
    } catch (err) {
        console.error("Error during shutdown:", err);
    }
    console.log("✅ All done.");
}

export async function main() {
    return mainWithDeps({
        init,
        downloadBudget,
        getAccounts,
        getCategories,
        getTransactions,
        getAccountBalance,
        setBudgetAmount,
        addTransactions: (accountId, transactions, options) => {
            return addTransactions(accountId, transactions, options).then(() => {});
        },
        shutdown,
    });
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

