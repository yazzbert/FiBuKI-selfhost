# FiBuKI Integrations

External integrations for FiBuKI Tax Studio.

## Available Integrations

### OpenClaw Plugin (`/openclaw-plugin`)

Allows AI assistants using OpenClaw to manage your FiBuKI account - transactions, receipts, bank accounts, and tax categorization.

**Setup:**
```bash
cd integrations/openclaw-plugin
npm install
openclaw plugins install -l .
```

**Configure in OpenClaw:**
```json5
{
  plugins: {
    entries: {
      "fibuki": {
        enabled: true,
        config: {
          userId: "your-fibuki-user-id"  // Settings > Integrations > AI Agents
        }
      }
    }
  }
}
```

See [openclaw-plugin/README.md](./openclaw-plugin/README.md) for full documentation.
