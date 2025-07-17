// actual-mortgage-interest.test.ts
import {
  calculateMonthlyInterest,
  calculateMonthlyInterestDailyMethod,
  loadConfig,
  MortgageInterestService,
} from "../actual-mortgage-interest";

beforeAll(() => {
  process.env.ACTUAL_URL = "https://actual.spruit.xyz";
  process.env.ACTUAL_PASSWORD = "secret";
  process.env.ACTUAL_SYNC_ID = "sync-id";
  process.env.MORTGAGE_ACCOUNT = "Test Mortgage";
  process.env.INTEREST_CATEGORY = "Test Mortgage Interest";
  process.env.BOOKING_DAY = "1";
});

describe("Mortgage Interest Calculations", () => {
  describe("calculateMonthlyInterest (Compound Method)", () => {
    it("should calculate correct monthly interest using compound interest", () => {
      // Test case: €100,000 balance at 3.4% annual rate
      const balanceCents = 10000000; // €100,000
      const annualRate = 0.034; // 3.4%

      const result = calculateMonthlyInterest(balanceCents, annualRate);

      // Expected with compound interest: 100,000 * (1.034^(1/12) - 1) = €279.01
      const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
      const expected = Math.round(balanceCents * monthlyRate);

      expect(result).toBe(expected);
      expect(result).toBe(27901); // €279.01 - compound interest
    });

    it("should handle different balance amounts with compound interest", () => {
      const annualRate = 0.034;

      // Test €200,000
      const balance200k = 20000000;
      const result200k = calculateMonthlyInterest(balance200k, annualRate);
      expect(result200k).toBe(55802); // €558.02

      // Test €50,000
      const balance50k = 5000000;
      const result50k = calculateMonthlyInterest(balance50k, annualRate);
      expect(result50k).toBe(13951); // €139.51
    });

    it("should handle decreasing balance over time correctly", () => {
      // Simulate mortgage balance decreasing over months
      let balance = 30000000; // Start with €300,000
      const monthlyPrincipalPayment = 100000; // €1,000 principal payment per month
      const annualRate = 0.034;

      const interests = [];
      for (let month = 0; month < 12; month++) {
        const interest = calculateMonthlyInterest(balance, annualRate);
        interests.push(interest);
        balance -= monthlyPrincipalPayment; // Reduce balance by principal payment
      }

      // Interest should decrease over time as balance decreases
      expect(interests[0]).toBeGreaterThan(interests[11]);
      expect(interests[0]).toBe(83703); // First month: €837.03
      expect(interests[11]).toBe(80634); // Last month: €806.34
    });
  });

  describe("calculateMonthlyInterestDailyMethod", () => {
    it("should calculate different interest for different month lengths", () => {
      const balanceCents = 10000000; // €100,000
      const annualRate = 0.034;

      // January (31 days)
      const januaryDate = new Date(2024, 0, 1);
      const januaryInterest = calculateMonthlyInterestDailyMethod(
        balanceCents,
        annualRate,
        januaryDate,
      );

      // February (29 days in 2024 - leap year)
      const februaryDate = new Date(2024, 1, 1);
      const februaryInterest = calculateMonthlyInterestDailyMethod(
        balanceCents,
        annualRate,
        februaryDate,
      );

      // March (31 days)
      const marchDate = new Date(2024, 2, 1);
      const marchInterest = calculateMonthlyInterestDailyMethod(
        balanceCents,
        annualRate,
        marchDate,
      );

      expect(januaryInterest).toBe(28877); // 31 days: €288.77
      expect(februaryInterest).toBe(27014); // 29 days: €270.14
      expect(marchInterest).toBe(28877); // 31 days: €288.77

      // January and March should be equal (both 31 days)
      expect(januaryInterest).toBe(marchInterest);

      // February should be less (fewer days)
      expect(februaryInterest).toBeLessThan(januaryInterest);
    });

    it("should handle leap year correctly", () => {
      const balanceCents = 10000000; // €100,000
      const annualRate = 0.034;

      // February 2024 (leap year - 29 days)
      const feb2024 = new Date(2024, 1, 1);
      const feb2024Interest = calculateMonthlyInterestDailyMethod(
        balanceCents,
        annualRate,
        feb2024,
      );

      // February 2023 (non-leap year - 28 days)
      const feb2023 = new Date(2023, 1, 1);
      const feb2023Interest = calculateMonthlyInterestDailyMethod(
        balanceCents,
        annualRate,
        feb2023,
      );

      expect(feb2024Interest).toBe(27014); // 29 days: €270.14
      expect(feb2023Interest).toBe(26082); // 28 days: €260.82
      expect(feb2024Interest).toBeGreaterThan(feb2023Interest);
    });
  });

  describe("Comparison of calculation methods", () => {
    it("should show the difference between compound and daily methods", () => {
      const balanceCents = 10000000; // €100,000
      const annualRate = 0.034;
      const testDate = new Date(2024, 0, 1); // January 2024

      const compoundResult = calculateMonthlyInterest(balanceCents, annualRate);
      const dailyResult = calculateMonthlyInterestDailyMethod(
        balanceCents,
        annualRate,
        testDate,
      );

      expect(compoundResult).toBe(27901); // €279.01 (compound)
      expect(dailyResult).toBe(28877); // €288.77 (daily for January)

      // Daily method gives higher result for 31-day months
      expect(dailyResult).toBeGreaterThan(compoundResult);
    });
  });

  describe("Real-world scenarios with improved calculations", () => {
    it("should calculate accurate interest for typical mortgage scenarios", () => {
      const testCases = [
        { balance: 30000000, rate: 0.034, expected: 83703 }, // €300k → €837.03
        { balance: 25000000, rate: 0.034, expected: 69753 }, // €250k → €697.53
        { balance: 20000000, rate: 0.034, expected: 55802 }, // €200k → €558.02
        { balance: 15000000, rate: 0.034, expected: 41852 }, // €150k → €418.52 (fixed)
        { balance: 10000000, rate: 0.034, expected: 27901 }, // €100k → €279.01
      ];

      testCases.forEach(({ balance, rate, expected }) => {
        const result = calculateMonthlyInterest(balance, rate);
        expect(result).toBe(expected);
      });
    });

    it("should demonstrate the improvement over old calculation method", () => {
      // Show the difference between old simple interest and new compound interest
      const balance = 20000000; // €200,000
      const rate = 0.034;

      // Old method (simple interest with fixed 30 days)
      const oldMonthlyInterest = Math.round(balance * (rate / 365) * 30);
      const oldYearlyTotal = oldMonthlyInterest * 12;

      // New method (compound interest)
      const newMonthlyInterest = calculateMonthlyInterest(balance, rate);
      const newYearlyTotal = newMonthlyInterest * 12;

      expect(oldMonthlyInterest).toBe(55890); // €558.90 (old simple method)
      expect(newMonthlyInterest).toBe(55802); // €558.02 (new compound method)
      expect(oldYearlyTotal - newYearlyTotal).toBe(1056); // €10.56 difference per year

      // The old method was actually over-calculating by about €10.56 per year
      expect(oldMonthlyInterest).toBeGreaterThan(newMonthlyInterest);
    });
  });

  describe("Bug identification and fixes", () => {
    it("should highlight the fixed 30-day bug in the original calculation", () => {
      // The original code used a fixed 30 days for all months
      // This test shows how much this impacts the calculation
      const balance = 10000000; // €100,000
      const rate = 0.034;

      // Original buggy method (fixed 30 days)
      const originalBuggyResult = Math.round(balance * (rate / 365) * 30);

      // Corrected daily method for different months
      const jan2024 = new Date(2024, 0, 1); // 31 days
      const feb2024 = new Date(2024, 1, 1); // 29 days
      const apr2024 = new Date(2024, 3, 1); // 30 days

      const janCorrect = calculateMonthlyInterestDailyMethod(
        balance,
        rate,
        jan2024,
      );
      const febCorrect = calculateMonthlyInterestDailyMethod(
        balance,
        rate,
        feb2024,
      );
      const aprCorrect = calculateMonthlyInterestDailyMethod(
        balance,
        rate,
        apr2024,
      );

      expect(originalBuggyResult).toBe(27945); // Always €279.45
      expect(janCorrect).toBe(28877); // €288.77 (31 days)
      expect(febCorrect).toBe(27014); // €270.14 (29 days)
      expect(aprCorrect).toBe(27945); // €279.45 (30 days)

      // The bug caused under-calculation for 31-day months
      expect(janCorrect).toBeGreaterThan(originalBuggyResult);
      // And over-calculation for 28/29-day months
      expect(febCorrect).toBeLessThan(originalBuggyResult);
    });

    it("should show the accuracy improvement with compound interest", () => {
      // Compound interest is more mathematically accurate for mortgages
      const balance = 10000000; // €100,000
      const rate = 0.034;

      const simpleInterest = Math.round(balance * (rate / 12)); // Simple monthly rate
      const compoundInterest = calculateMonthlyInterest(balance, rate);

      expect(simpleInterest).toBe(28333); // €283.33 (simple)
      expect(compoundInterest).toBe(27901); // €279.01 (compound)

      // Compound interest is lower because it accounts for the fact that
      // interest doesn't compound within the month
      expect(compoundInterest).toBeLessThan(simpleInterest);
    });
  });
});

describe("Configuration Loading", () => {
  it("should load config from environment variables", () => {
    const config = loadConfig();

    expect(config.url).toBe("https://actual.spruit.xyz");
    expect(config.annualRate).toBe(0.04);
    expect(config.bookingDay).toBe(1);
    expect(config.mortgageAccount).toBe("Test Mortgage");
    expect(config.interestCategory).toBe("Test Mortgage Interest");
  });
});

function createMockClient() {
  return {
    init: jest.fn(),
    downloadBudget: jest.fn(),
    getAccounts: jest.fn(),
    getCategories: jest.fn(),
    getTransactions: jest.fn(),
    getAccountBalance: jest.fn(),
    addTransactions: jest.fn(),
    shutdown: jest.fn(),
  };
}

describe("MortgageInterestService Integration", () => {
  let mockDeps: ReturnType<typeof createMockClient>;
  let service: MortgageInterestService;

  beforeEach(() => {
    mockDeps = createMockClient();
    service = new MortgageInterestService(mockDeps);

    mockDeps.getAccounts.mockResolvedValue([
      { id: "mortgage-id", name: "Test Mortgage", offbudget: true },
    ]);
    mockDeps.getCategories.mockResolvedValue([
      { id: "interest-cat-id", name: "Test Mortgage Interest" },
    ]);
    mockDeps.getTransactions.mockResolvedValue([]);
    mockDeps.getAccountBalance.mockResolvedValue(20000000); // €200,000
  });

  it("should initialize properly", async () => {
    await service.initialize();

    expect(mockDeps.init).toHaveBeenCalled();
    expect(mockDeps.downloadBudget).toHaveBeenCalled();
    expect(mockDeps.getAccounts).toHaveBeenCalled();
    expect(mockDeps.getCategories).toHaveBeenCalled();
  });

  it("should calculate correct interest with improved method", async () => {
    await service.initialize();

    const balance = 20000000; // €200,000
    const expectedInterest = calculateMonthlyInterest(balance, 0.034);
    expect(expectedInterest).toBe(55802); // €558.02 with compound interest
  });
});
