# FiBuKI OpenClaw Plugin

Manage your FiBuKI tax accounting data through AI assistants.

## What Claude Can Do

With this plugin, Claude can help you:

| Task | Tools Used |
|------|------------|
| **View bank accounts** | `list_sources`, `get_source` |
| **Browse transactions** | `list_transactions`, `get_transaction` |
| **Find incomplete work** | `list_transactions` (isComplete=false), `list_transactions_needing_files` |
| **Match receipts to transactions** | `list_files`, `connect_file_to_transaction`, `auto_connect_file_suggestions` |
| **Categorize transactions** | `list_no_receipt_categories`, `assign_no_receipt_category` |
| **Check automation status** | `list_automations`, `get_automation_step_details` |
| **Manage email forwarding** | `list_inbound_addresses`, `create_inbound_address` |
| **Open Banking** | `list_gocardless_accounts`, `sync_gocardless_account` |

## Installation

```bash
cd integrations/openclaw-plugin
npm install
openclaw plugins install -l .   # Link for development
```

## Configuration

Add to your OpenClaw config:

```json5
{
  plugins: {
    entries: {
      "fibuki": {
        enabled: true,
        config: {
          userId: "your-fibuki-user-id"
        }
      }
    }
  }
}
```

**Finding your User ID:** Go to FiBuKI **Settings > Integrations > AI Agents** and copy your User ID

## System Context for Claude

Add this to your OpenClaw system prompt for best results:

```
You have access to FiBuKI, a German tax accounting tool. Key concepts:

**Data Model:**
- Sources: Bank accounts or credit cards that transactions come from
- Transactions: Individual bank movements (debits/credits) imported from sources
- Files: Uploaded receipts/invoices (PDFs, images) that need matching to transactions
- Partners: Companies/people you transact with (e.g., "Amazon", "REWE")

**Transaction Completion:**
A transaction is "complete" when it has EITHER:
1. A connected file (receipt/invoice), OR
2. A no-receipt category (for things like bank fees, internal transfers, payroll)

**Your Job:**
Help the user complete their bookkeeping by:
1. Finding incomplete transactions (`list_transactions` with isComplete=false)
2. Matching uploaded files to transactions (`list_files` then `connect_file_to_transaction`)
3. Categorizing transactions that don't need receipts (`assign_no_receipt_category`)

**Important Rules:**
- Individual transactions CANNOT be deleted (accounting integrity)
- Amounts are in CENTS (e.g., 1000 = 10.00 EUR)
- Dates are ISO format (2024-01-15)
- Use `auto_connect_file_suggestions` to bulk-match high-confidence suggestions
```

## Available Tools

### Bank Accounts (Sources)
- `list_sources` - List all connected bank accounts
- `get_source` - Get details of a specific account
- `create_source` - Add a new bank account for CSV imports
- `update_source` - Rename an account
- `delete_source` - Remove account and ALL its transactions

### Transactions
- `list_transactions` - Search/filter transactions
- `get_transaction` - Get full transaction details
- `update_transaction` - Update description, mark complete
- `accept_partner_suggestion` - Confirm auto-detected partner

### Files (Receipts/Invoices)
- `list_files` - List uploaded files with match suggestions
- `get_file` - Get file details including extracted data
- `update_file` - Correct extracted amount/VAT/partner
- `delete_file` - Remove a file
- `connect_file_to_transaction` - Link file to transaction
- `disconnect_file_from_transaction` - Unlink file
- `get_files_for_transaction` - List files attached to a transaction
- `list_transactions_needing_files` - Find transactions without receipts
- `auto_connect_file_suggestions` - Bulk-connect high-confidence matches

### No-Receipt Categories
- `list_no_receipt_categories` - List categories (bank fees, payroll, etc.)
- `get_no_receipt_category` - Get category details
- `assign_no_receipt_category` - Mark transaction as not needing receipt
- `remove_no_receipt_category` - Remove category from transaction

### Automations
- `list_automations` - View automation pipelines and their status
- `get_automation_step_details` - Understand what an automation does
- `explain_transaction_automation` - See what automations ran on a transaction

### Email Forwarding
- `list_inbound_addresses` - List email addresses for forwarding invoices
- `get_inbound_address` - Get address details and stats
- `create_inbound_address` - Create new forwarding address
- `get_inbound_email_logs` - View received emails and processing status

### Open Banking (GoCardless)
- `list_bank_institutions` - Find banks available for connection
- `list_gocardless_accounts` - List connected Open Banking accounts
- `get_gocardless_account_status` - Check sync status
- `sync_gocardless_account` - Trigger manual transaction sync

## Example Conversations

**User:** "Show me my incomplete transactions from last month"
```
Claude uses: list_transactions with dateFrom, dateTo, isComplete=false
```

**User:** "Match my unconnected receipts"
```
Claude uses: auto_connect_file_suggestions with minConfidence=85
```

**User:** "This Amazon transaction is for office supplies"
```
Claude uses: update_transaction to add description
```

**User:** "The bank fee doesn't need a receipt"
```
Claude uses: list_no_receipt_categories, then assign_no_receipt_category
```
