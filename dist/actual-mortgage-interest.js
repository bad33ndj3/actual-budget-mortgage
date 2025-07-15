"use strict";
// actual-mortgage-interest.ts
// --------------------------------------------
// Automatically budget and book the mortgage-interest portion for each missing month.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MortgageInterestService = void 0;
exports.loadConfig = loadConfig;
exports.calculateMonthlyInterest = calculateMonthlyInterest;
exports.calculateMonthlyInterestDailyMethod = calculateMonthlyInterestDailyMethod;
exports.main = main;
require("dotenv/config");
const date_fns_1 = require("date-fns");
const api_1 = require("@actual-app/api");
function loadConfig() {
    const required = ["ACTUAL_URL", "ACTUAL_PASSWORD", "ACTUAL_SYNC_ID"];
    for (const k of required) {
        if (!process.env[k]) {
            console.error(`Missing env var ${k}`);
            process.exit(1);
        }
    }
    return {
        url: process.env.ACTUAL_URL,
        password: process.env.ACTUAL_PASSWORD,
        syncId: process.env.ACTUAL_SYNC_ID,
        mortgageAccount: process.env.MORTGAGE_ACCOUNT ?? "Hypotheek",
        interestCategory: process.env.INTEREST_CATEGORY ?? "Wonen: Hypotheekrente",
        annualRate: Number(process.env.ANNUAL_RATE ?? "0.04"),
        bookingDay: Number(process.env.BOOKING_DAY ?? "25"),
        dryRun: process.env.DRY_RUN === "true",
        fromDate: process.env.FROM_DATE, // e.g. "2024-01-01"
    };
}
function calculateMonthlyInterest(balanceCents, annualRate, monthDate) {
    // Calculate monthly interest using compound interest formula
    // This is more accurate for mortgage calculations
    const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
    const interestCents = Math.round(balanceCents * monthlyRate);
    return interestCents;
}
function calculateMonthlyInterestDailyMethod(balanceCents, annualRate, monthDate) {
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
function findMortgageAccount(accounts, mortgageAccountName) {
    const mortgage = accounts.find(a => a.name === mortgageAccountName);
    if (!mortgage)
        throw new Error(`Account '${mortgageAccountName}' not found.`);
    if (!mortgage.offbudget)
        console.warn("⚠️ Mortgage account is on-budget; consider marking it off-budget.");
    return mortgage;
}
/** Find the interest category by name */
function findInterestCategory(categories, interestCategoryName) {
    const cat = categories.find(c => c.name === interestCategoryName);
    if (!cat)
        throw new Error(`Category '${interestCategoryName}' not found.`);
    return cat;
}
/** Determine the start date for processing based on config or today */
function getCursorStartDate(cfg, today) {
    if (cfg.fromDate) {
        const parsed = (0, date_fns_1.parseISO)(cfg.fromDate);
        if (isNaN(parsed.getTime())) {
            throw new Error(`Invalid FROM_DATE: ${cfg.fromDate}`);
        }
        return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    }
    else {
        return new Date(today.getFullYear(), today.getMonth(), 1);
    }
}
/** Check if interest transaction with importedId already exists */
async function hasPostedInterest(transactions, importedId) {
    return transactions.some(t => t.imported_id === importedId);
}
/** Calculate booking and as-of dates for a given month cursor */
function calculateBookingDates(cursor, bookingDay) {
    const lastDay = (0, date_fns_1.endOfMonth)(cursor).getDate();
    const bookingDayAdjusted = Math.min(bookingDay, lastDay);
    const bookDate = new Date(cursor.getFullYear(), cursor.getMonth(), bookingDayAdjusted);
    const asOfDate = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    asOfDate.setDate(asOfDate.getDate() - 1);
    if (isNaN(bookDate.getTime()) || isNaN(asOfDate.getTime())) {
        throw new Error(`Invalid booking or asOf date for period ${(0, date_fns_1.format)(cursor, "yyyy-MM")}`);
    }
    return { bookDate, asOfDate };
}
/** Log details about the interest booking period */
function logPeriodDetails(period, bookDateStr, asOf, balanceEuros, interestCents) {
    console.log(`→ ${period}: booking date ${bookDateStr}, as of ${asOf}`);
    console.log(`→ ${period}: balance €${balanceEuros.toFixed(2)}, interest €${(interestCents / 100).toFixed(2)}`);
}
/** Post the interest transaction unless dryRun is true */
async function postInterestTransaction(mortgageId, interestCents, catId, importedId, bookDate, period, dryRun, addTransactions) {
    if (dryRun) {
        console.log(`(dry-run) Would post interest for ${period}: ${interestCents} cents`);
        return;
    }
    await addTransactions(mortgageId, [
        {
            date: (0, date_fns_1.format)(bookDate, "yyyy-MM-dd"),
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
class MortgageInterestService {
    constructor(deps) {
        this.cfg = loadConfig();
        this.deps = deps;
    }
    async initialize() {
        console.log("Connecting to Actual server …");
        await this.deps.init({
            serverURL: this.cfg.url,
            password: this.cfg.password,
            dataDir: process.env.DATA_DIR || ".cache",
        });
        await this.deps.downloadBudget(this.cfg.syncId);
        const accounts = await this.deps.getAccounts();
        this.mortgage = findMortgageAccount(accounts, this.cfg.mortgageAccount);
        const categories = await this.deps.getCategories();
        this.category = findInterestCategory(categories, this.cfg.interestCategory);
    }
    async processPeriod(cursor) {
        const period = (0, date_fns_1.format)(cursor, "yyyy-MM");
        const importedId = `interest-${period}`;
        const existing = await this.deps.getTransactions(this.mortgage.id, (0, date_fns_1.format)(cursor, "yyyy-MM-01"), new Date());
        if (await hasPostedInterest(existing, importedId)) {
            console.log(`→ ${period}: already posted, skipping.`);
            return;
        }
        const { bookDate, asOfDate } = calculateBookingDates(cursor, this.cfg.bookingDay);
        const asOf = (0, date_fns_1.format)(asOfDate, "yyyy-MM-dd");
        const bookDateStr = (0, date_fns_1.format)(bookDate, "yyyy-MM-dd");
        const balanceCents = await this.deps.getAccountBalance(this.mortgage.id, asOfDate);
        const interestCents = calculateMonthlyInterest(balanceCents, this.cfg.annualRate);
        const balanceEuros = balanceCents / 100;
        // const monthlyRate = Math.pow(1 + this.cfg.annualRate, 1 / 12) - 1;
        logPeriodDetails(period, bookDateStr, asOf, balanceEuros, interestCents);
        await postInterestTransaction(this.mortgage.id, interestCents, this.category.id, importedId, bookDate, period, this.cfg.dryRun, this.deps.addTransactions);
    }
    async run() {
        await this.initialize();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let cursor = getCursorStartDate(this.cfg, today);
        while (!(0, date_fns_1.isAfter)(cursor, today)) {
            await this.processPeriod(cursor);
            cursor = (0, date_fns_1.addMonths)(cursor, 1);
        }
        try {
            await this.deps.shutdown();
        }
        catch (err) {
            console.error("Error during shutdown:", err);
        }
        console.log("✅ All done.");
    }
}
exports.MortgageInterestService = MortgageInterestService;
async function main() {
    const service = new MortgageInterestService({
        init: api_1.init,
        downloadBudget: api_1.downloadBudget,
        getAccounts: api_1.getAccounts,
        getCategories: api_1.getCategories,
        getTransactions: api_1.getTransactions,
        getAccountBalance: api_1.getAccountBalance,
        addTransactions: (accountId, transactions, options) => {
            return (0, api_1.addTransactions)(accountId, transactions, options).then(() => { });
        },
        shutdown: api_1.shutdown,
    });
    await service.run();
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
