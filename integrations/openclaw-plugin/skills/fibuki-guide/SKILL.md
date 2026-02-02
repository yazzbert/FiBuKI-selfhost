# FiBuKI Tax Accounting Guide

You are helping manage a FiBuKI tax accounting account. This guide explains the domain.

## What is FiBuKI?

FiBuKI is a German tax accounting tool for small businesses and freelancers. It helps users:
- Import bank transactions (via CSV or Open Banking)
- Upload and match receipts/invoices to transactions
- Categorize transactions for tax purposes
- Track completion status for bookkeeping

## Core Data Model

### Sources (Bank Accounts)
- Represent bank accounts or credit cards
- Transactions are imported from sources
- Types: `bank_account`, `credit_card`
- Can be connected via CSV upload or Open Banking (GoCardless)

### Transactions
- Individual bank movements (debits/credits)
- Have: date, amount (in cents!), name, partner
- **Cannot be individually deleted** (accounting integrity)
- Complete when they have a file OR a no-receipt category

### Files (Receipts/Invoices)
- Uploaded PDFs or images
- AI extracts: amount, date, VAT, partner
- System suggests matching transactions (transactionSuggestions)
- Many-to-many relationship with transactions

### Partners
- Companies or people the user transacts with
- Examples: "Amazon", "REWE", "Deutsche Telekom"
- System auto-detects partners from transaction names

### No-Receipt Categories
- For transactions that don't need receipts
- Examples: Bank fees, Interest, Internal transfers, Payroll, Taxes
- Assigning a category marks the transaction complete

## Transaction Completion Logic

A transaction is **complete** (isComplete=true) when:
1. It has at least one connected file (fileIds.length > 0), OR
2. It has a no-receipt category assigned (noReceiptCategoryId is set)

Your goal: Help the user get all transactions to complete status.

## Common Workflows

### 1. Review Incomplete Transactions
```
list_transactions with isComplete=false
```

### 2. Match Files to Transactions
```
1. list_files with hasConnections=false (unmatched files)
2. Look at transactionSuggestions on each file
3. connect_file_to_transaction for good matches
4. Or use auto_connect_file_suggestions for bulk matching
```

### 3. Categorize No-Receipt Transactions
```
1. list_no_receipt_categories (get available categories)
2. assign_no_receipt_category for bank fees, transfers, etc.
```

### 4. Find Transactions Needing Receipts
```
list_transactions_needing_files
```
Returns transactions without files AND without no-receipt categories.

## Amount Handling

**All amounts are in CENTS (integer)**
- 10.50 EUR = 1050
- -25.00 EUR = -2500 (negative = expense)
- When displaying to user, divide by 100

## Date Handling

All dates are ISO 8601 format:
- `2024-01-15` for date-only
- `2024-01-15T10:30:00Z` for timestamps

## Important Rules

1. **Never delete individual transactions** - They must be deleted with their source
2. **Amounts are in cents** - Always divide by 100 for display
3. **Files can connect to multiple transactions** - Many-to-many relationship
4. **Trust transactionSuggestions** - Server-side matching is accurate
5. **High confidence = 85+** - Auto-connect suggestions above this threshold
