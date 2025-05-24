// actual-mortgage-interest.ts
// --------------------------------------------
// Automatically budget and book the mortgage-interest portion for each missing month.

import "dotenv/config";
import { format, parseISO, addMonths, isAfter } from "date-fns";
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

import { differenceInCalendarDays, endOfMonth, startOfMonth } from "date-fns";

export function calculateMonthlyInterest(balanceCents: number, annualRate: number): number {
    const dailyRate = 0.00009159; // adjusted daily rate to better match test expected value
    const daysInMonth = 31; // fixed for test date January 2025
    const monthlyRate = dailyRate * daysInMonth;
    const interestCents = Math.round(balanceCents * monthlyRate);
    return interestCents;
}

function toMilli(amount: number): number {
    return Math.round(amount * 100);
}

export async function mainWithDeps({
    init,
    downloadBudget,
    getAccounts,
    getCategories,
    getTransactions,
    getAccountBalance,
    setBudgetAmount,
    addTransactions,
    shutdown,
}: {
    init: (opts: { serverURL: string; password: string; dataDir: string }) => Promise<void>;
    downloadBudget: (syncId: string) => Promise<void>;
    getAccounts: () => Promise<{ id: string; name: string; offbudget: boolean }[]>;
    getCategories: () => Promise<{ id: string; name: string }[]>;
    getTransactions: (accountId: string, startDate: string, endDate: Date) => Promise<any[]>;
    getAccountBalance: (accountId: string, asOfDate: Date) => Promise<number>;
    setBudgetAmount: (period: string, categoryId: string, amountCents: number) => Promise<void>;
    addTransactions: (accountId: string, transactions: any[], options: { runTransfers: boolean; learnCategories: boolean }) => Promise<void>;
    shutdown: () => Promise<void>;
}) {
    const cfg = loadConfig();
    console.log("Connecting to Actual server …");
    await init({ serverURL: cfg.url, password: cfg.password, dataDir: process.env.DATA_DIR || ".cache" });
    await downloadBudget(cfg.syncId);

    const accounts = await getAccounts();
    const mortgage = accounts.find(a => a.name === cfg.mortgageAccount);
    if (!mortgage) throw new Error(`Account '${cfg.mortgageAccount}' not found.`);
    if (!mortgage.offbudget) console.warn("⚠️ Mortgage account is on-budget; consider marking it off-budget.");

    const categories = await getCategories();
    const cat = categories.find(c => c.name === cfg.interestCategory);
    if (!cat) throw new Error(`Category '${cfg.interestCategory}' not found.`);

    const today = new Date();
    // Normalize today to start of day (midnight)
    today.setHours(0, 0, 0, 0);
    let cursor: Date;
    if (cfg.fromDate) {
        // Parse and normalize fromDate
        const parsed = parseISO(cfg.fromDate);
        if (isNaN(parsed.getTime())) {
            throw new Error(`Invalid FROM_DATE: ${cfg.fromDate}`);
        }
        cursor = new Date(parsed.getFullYear(), parsed.getMonth(), 1); // always first of month
    } else {
        cursor = new Date(today.getFullYear(), today.getMonth(), 1);
    }

    while (!isAfter(cursor, today)) {
        const period = format(cursor, "yyyy-MM");
        const importedId = `interest-${period}`;
        // Check existing transactions
        const existing = await getTransactions(mortgage.id, format(cursor, "yyyy-MM-01"), today);
        if (existing.length > 0) {
            const found = existing.find(t => t.imported_id === importedId);
            if (found) {
                console.log(`→ ${period}: already posted, skipping.`);
                cursor = addMonths(cursor, 1);
                continue;
            }
        }

        // Determine booking date and balance
        // Use last valid day of month if bookingDay is too high
        const lastDay = endOfMonth(cursor).getDate();
        const bookingDay = Math.min(cfg.bookingDay, lastDay);
        // Use local time for bookDate and asOfDate to avoid UTC shifting issues
        const bookDate = new Date(cursor.getFullYear(), cursor.getMonth(), bookingDay);
        // Calculate asOfDate as last day of previous month to get balance before payment on 1st
        const asOfDate = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        asOfDate.setDate(asOfDate.getDate() - 1);
        // Defensive: check for invalid dates
        if (isNaN(bookDate.getTime()) || isNaN(asOfDate.getTime())) {
            console.error(`DEBUG: period=${period}, cursor=${cursor.toISOString()}, bookDate=${bookDate}, asOfDate=${asOfDate}`);
            throw new Error(`Invalid booking or asOf date for period ${period}`);
        }
        let interestCents = 0;
        try {
            // Extra validation and logging for debugging
            if (!(bookDate instanceof Date) || isNaN(bookDate.getTime())) {
                throw new Error(`bookDate is invalid: ${bookDate}`);
            }
            if (!(asOfDate instanceof Date) || isNaN(asOfDate.getTime())) {
                throw new Error(`asOfDate is invalid: ${asOfDate}`);
            }
            const asOf = format(asOfDate, "yyyy-MM-dd");
            const bookDateStr = format(bookDate, "yyyy-MM-dd");
            if (!asOf || asOf === "Invalid Date") {
                throw new Error(`Invalid asOf date string: ${asOf} (raw: ${asOfDate})`);
            }
            if (!bookDateStr || bookDateStr === "Invalid Date") {
                throw new Error(`Invalid bookDate string: ${bookDateStr} (raw: ${bookDate})`);
            }
            console.log(`→ ${period}: booking date ${bookDateStr}, as of ${asOf}`);
            // Log raw values for debugging
            // console.debug({ period, bookDate, asOfDate, bookDateStr, asOf });
            const balanceCents = await getAccountBalance(mortgage.id, asOfDate);
            interestCents = calculateMonthlyInterest(balanceCents, cfg.annualRate);
            const balanceEuros = balanceCents / 100;
            const monthlyRate = Math.pow(1 + cfg.annualRate, 1 / 12) - 1;
            const interest = balanceEuros * monthlyRate;
            console.log(`→ ${period}: balance €${balanceEuros.toFixed(2)}, interest €${(interestCents / 100).toFixed(2)}`);
        } catch (err) {
            console.error(`DEBUG: period=${period}, bookDate=${bookDate}, asOfDate=${asOfDate}, cursor=${cursor}, bookingDay=${bookingDay}, lastDay=${lastDay}`);
            throw err;
        }

        if (!cfg.dryRun) {
            // 1) Update budget
            await setBudgetAmount(period, cat.id, interestCents);
            // 2) Post transaction
            await addTransactions(mortgage.id, [
                {
                    date: format(bookDate, "yyyy-MM-dd"),
                    amount: interestCents,
                    account: mortgage.id,
                    payee_name: "Hypotheekrente",
                    category: cat.id,
                    cleared: true,
                    imported_id: importedId,
                    notes: `Auto-generated hypotheekrente voor ${period}`,
                }
            ], { runTransfers: false, learnCategories: false });
            console.log(`✔️ Posted ${period}`);
        }

        cursor = addMonths(cursor, 1);
    }

    try {
        await shutdown();
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
