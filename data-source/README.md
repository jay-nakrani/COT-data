# Editing COT data directly on GitHub

This folder is what you actually edit every Friday. Nothing else in the repo
needs to be touched for a normal weekly update.

## Files

- **weekly.csv** — one row per pair per week. This is what you add a new row
  to every Friday.
- **meta.csv** — one row per pair, with its display name/category/labels.
  You basically never need to touch this unless you're adding a brand new
  pair that isn't tracked yet.

## Adding this week's numbers (do this every Friday)

1. In your GitHub repo, open `data-source/weekly.csv`.
2. Click the pencil (Edit) icon.
3. Scroll to the bottom and add one new line **per pair**, in this format:

   ```
   symbol,date,total_oi,spec_long,spec_short,hedge_long,hedge_short,price
   ```

   Example — adding Gold's new week:
   ```
   GC,2026-07-21,390000,140000,20000,16000,35000,4050.50
   ```

   Column meaning:
   | column | what it is |
   |---|---|
   | `symbol` | must match a symbol already in `meta.csv` exactly (e.g. `GC`, `SI`, `NQ`, `ES`, `YM`, `NIY`, `6S`, `6C`, `6A`, `6E`, `6N`, `6J`, `6B`) |
   | `date` | `YYYY-MM-DD`, the Tuesday the report reflects |
   | `total_oi` | Total Open Interest from the CME/CFTC table |
   | `spec_long` / `spec_short` | Leveraged Funds Long/Short (or Managed Money for Gold/Silver) |
   | `hedge_long` / `hedge_short` | Dealer Long/Short (or Producer for Gold/Silver) |
   | `price` | that week's closing price for the underlying |

   Do this for all 13 pairs (13 new lines total) before committing — but you
   can also commit after just a few if you want to add the rest later; the
   site will just show fewer pairs updated.

4. Scroll down, add a commit message (e.g. "Week of 7/21"), click
   **Commit changes directly to the main branch**.

5. That's it. A GitHub Action fires automatically, rebuilds `data/cot.json`
   from this CSV, and pushes it back — usually done within 30–60 seconds.
   Check the **Actions** tab in your repo for a green checkmark. Then
   hard-refresh your live site.

## Adding a brand new pair

1. Add one row to `meta.csv` with its symbol, display name, category
   (`Metals`, `Equity Indices`, or `FX Majors`), format (`legacy` if it uses
   Producer/Swap Dealer/Managed Money categories, `financial` if it uses
   Dealer/Asset Manager/Leveraged Funds), and the spec/hedge labels you want
   shown on the site.
2. Add its weekly rows to `weekly.csv` as above.
3. Commit — the Action handles the rest.
