## Pricing update

This PR updates one or more entries in `src/pricing/table.ts` to match published
provider rates.

### Provider

<!-- check one -->
- [ ] Anthropic
- [ ] OpenAI
- [ ] Google

### Model(s) updated

<!-- list each affected model id -->
- `model-id`: input $X / 1M, output $Y / 1M

### Source

<!-- link to the provider's pricing page -->
https://example.com/pricing

### Date verified

<!-- YYYY-MM-DD when you confirmed the rate on the source page -->
2026-MM-DD

### Checklist

- [ ] `src/pricing/table.ts` updated
- [ ] The "verified as of" comment near the top of the table updated to today's date
- [ ] `npm test` passes locally
