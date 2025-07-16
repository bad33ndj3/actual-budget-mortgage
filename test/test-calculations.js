// test-calculations.js
// Simple test to get actual calculation values

// Compound interest calculation
function calculateMonthlyInterest(balanceCents, annualRate) {
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  const interestCents = Math.round(balanceCents * monthlyRate);
  return interestCents;
}

// Daily method calculation
function calculateMonthlyInterestDailyMethod(
  balanceCents,
  annualRate,
  monthDate,
) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dailyRate = annualRate / 365;
  const monthlyRate = dailyRate * daysInMonth;
  const interestCents = Math.round(balanceCents * monthlyRate);
  return interestCents;
}

console.log("=== Compound Interest Method ===");
console.log("€100,000 at 3.4%:", calculateMonthlyInterest(10000000, 0.034));
console.log("€200,000 at 3.4%:", calculateMonthlyInterest(20000000, 0.034));
console.log("€300,000 at 3.4%:", calculateMonthlyInterest(30000000, 0.034));
console.log("€250,000 at 3.4%:", calculateMonthlyInterest(25000000, 0.034));
console.log("€150,000 at 3.4%:", calculateMonthlyInterest(15000000, 0.034));
console.log("€50,000 at 3.4%:", calculateMonthlyInterest(5000000, 0.034));

console.log("\n=== Daily Method ===");
const jan2024 = new Date(2024, 0, 1);
const feb2024 = new Date(2024, 1, 1);
const feb2023 = new Date(2023, 1, 1);
const mar2024 = new Date(2024, 2, 1);

console.log(
  "€100,000 January 2024 (31 days):",
  calculateMonthlyInterestDailyMethod(10000000, 0.034, jan2024),
);
console.log(
  "€100,000 February 2024 (29 days):",
  calculateMonthlyInterestDailyMethod(10000000, 0.034, feb2024),
);
console.log(
  "€100,000 February 2023 (28 days):",
  calculateMonthlyInterestDailyMethod(10000000, 0.034, feb2023),
);
console.log(
  "€100,000 March 2024 (31 days):",
  calculateMonthlyInterestDailyMethod(10000000, 0.034, mar2024),
);

console.log("\n=== Decreasing Balance Simulation ===");
let balance = 30000000; // €300,000
const monthlyPrincipalPayment = 100000; // €1,000
const annualRate = 0.034;

const interests = [];
for (let month = 0; month < 12; month++) {
  const interest = calculateMonthlyInterest(balance, annualRate);
  interests.push(interest);
  balance -= monthlyPrincipalPayment;
}

console.log("First month interest (€300k):", interests[0]);
console.log("Last month interest (€210k):", interests[11]);

console.log("\n=== Old vs New Method Comparison ===");
const testBalance = 20000000; // €200,000
const oldMethod = Math.round(testBalance * (0.034 / 365) * 30);
const newMethod = calculateMonthlyInterest(testBalance, 0.034);
console.log("Old method (simple, 30 days):", oldMethod);
console.log("New method (compound):", newMethod);
console.log("Difference per month:", newMethod - oldMethod);
console.log("Difference per year:", (newMethod - oldMethod) * 12);
