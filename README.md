# Actual Mortgage Interest

This script automatically budgets and books the mortgage interest portion for each missing month in an [Actual Budget](https://actualbudget.com/) instance.

## Features

-   Connects to your Actual Budget server.
-   Identifies the mortgage account and interest category.
-   Calculates monthly interest based on the outstanding balance and annual interest rate.
-   Checks for existing interest transactions to avoid duplicates.
-   Updates the budget for the interest category for the given month.
-   Adds a new transaction for the calculated interest amount.
-   Supports a dry-run mode to see what actions would be taken without making changes.
-   Allows specifying a `FROM_DATE` to backfill historical interest.

## Configuration

The script is configured using environment variables. You can set these directly in your shell or use a `.env` file.

**Required:**

-   `ACTUAL_URL`: The URL of your Actual Budget server.
-   `ACTUAL_PASSWORD`: The password for your Actual Budget server.
-   `ACTUAL_SYNC_ID`: The sync ID of your budget file.

**Optional:**

-   `MORTGAGE_ACCOUNT`: The name of your mortgage account in Actual. (Default: "Hypotheek")
-   `INTEREST_CATEGORY`: The name of the category for mortgage interest. (Default: "Wonen: Hypotheekrente")
-   `ANNUAL_RATE`: The annual interest rate for your mortgage (e.g., "0.04" for 4%). (Default: "0.04")
-   `BOOKING_DAY`: The day of the month when the interest should be booked. (Default: "25")
-   `DRY_RUN`: Set to "true" to run the script without making any changes to your budget. (Default: false)
-   `FROM_DATE`: The date from which to start booking interest, in "YYYY-MM-DD" format (e.g., "2024-01-01"). If not set, the script will start from the current month.
-   `DATA_DIR`: Directory to store Actual's cache data. (Default: ".cache")

## Usage

1.  **Install dependencies:**
    ```bash
    npm install
    ```
    (Assuming you have a `package.json` with `@actual-app/api`, `date-fns`, and `dotenv` as dependencies. If not, you'll need to install them: `npm install @actual-app/api date-fns dotenv`)

2.  **Set up environment variables:**
    Create a `.env` file in the root of the project or set the variables in your environment.
    Example `.env` file:
    ```env
    ACTUAL_URL=http://localhost:5006
    ACTUAL_PASSWORD=your_password
    ACTUAL_SYNC_ID=your_sync_id
    MORTGAGE_ACCOUNT=My Mortgage Account
    INTEREST_CATEGORY=Housing: Mortgage Interest
    ANNUAL_RATE=0.035
    BOOKING_DAY=28
    # DRY_RUN=true
    # FROM_DATE=2023-01-01
    ```

3.  **Run the script:**
    ```bash
    npx ts-node actual-mortgage-interest.ts
    ```
    Or, if you compile it to JavaScript first:
    ```bash
    # Compile (if you have a tsconfig.json)
    # npx tsc
    # Run
    # node actual-mortgage-interest.js
    ```

## How it Works

The script performs the following steps:

1.  Loads configuration from environment variables.
2.  Connects to the Actual Budget server and downloads the specified budget.
3.  Retrieves account and category information to find the configured mortgage account and interest category.
4.  Determines the starting month:
    *   If `FROM_DATE` is set, it starts from the first day of that month.
    *   Otherwise, it starts from the first day of the current month.
5.  Iterates through each month from the start date up to the current month:
    *   Formats the period string (e.g., "2024-05").
    *   Checks if an interest transaction with a specific `imported_id` (e.g., `interest-2024-05`) already exists for that month in the mortgage account. If so, it skips that month.
    *   Determines the booking date for the interest transaction (using `BOOKING_DAY`, ensuring it's a valid day in the month).
    *   Calculates the "as of" date for fetching the account balance. This is typically the last day of the previous month to get the balance before any principal payments for the current month.
    *   Fetches the mortgage account balance as of the calculated date.
    *   Calculates the monthly interest amount based on the balance and the `ANNUAL_RATE`.
    *   If `DRY_RUN` is not true:
        *   Sets the budgeted amount for the `INTEREST_CATEGORY` for the current `period` to the calculated interest.
        *   Adds a new transaction to the `MORTGAGE_ACCOUNT` with the calculated interest, booking date, payee "Hypotheekrente", the `INTEREST_CATEGORY`, and a unique `imported_id`.
6.  Shuts down the connection to the Actual server.

The `calculateMonthlyInterest` function uses a simplified daily rate calculation. The script uses `date-fns` for date manipulations.

## Disclaimer

This script interacts directly with your Actual Budget data. While it includes a dry-run mode and checks for existing transactions, it's recommended to:
-   **Backup your Actual Budget data before running the script for the first time.**
-   Test thoroughly with `DRY_RUN=true`.
-   Review the transactions and budget amounts created by the script.

