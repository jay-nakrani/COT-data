"""
Fetch latest COT data from the CFTC public API and append to weekly.csv.

This script reads the existing data-source/weekly.csv to find the last date
for each symbol, then fetches any new weekly data from the CFTC API and
appends it. Prices are left blank because the CFTC does not publish price
data - those still need to be filled in manually (or from another source).

The CFTC releases the data every Friday at 3:30 PM Eastern time (8:30 PM UK).
Data is from the previous Tuesday.

Usage:
    python3 scripts/fetch_cot.py

No external libraries required - just the Python standard library.
"""

import csv
import json
import os
import sys
import urllib.request
import urllib.parse
import datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEEKLY_CSV = os.path.join(ROOT, "data-source", "weekly.csv")
META_CSV = os.path.join(ROOT, "data-source", "meta.csv")

# ---------------------------------------------------------------------------
# CFTC API dataset IDs (Socrata-style API, no auth needed)
# ---------------------------------------------------------------------------
# Disaggregated Futures-Only  -> metals (Gold, Silver)
# TFF Futures-Only            -> equity indices + FX pairs
DISAGG_FO_URL = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json"
TFF_FO_URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"

# When a symbol has no existing data, fetch this many weeks back
DEFAULT_LOOKBACK_WEEKS = 52

# ---------------------------------------------------------------------------
# Asset config - how to find each symbol in the CFTC data
# ---------------------------------------------------------------------------
ASSETS = {
    # Metals - disaggregated report
    "GC": {"search": "GOLD - COMMODITY EXCHANGE INC.",                "report": "disaggregated"},
    "SI": {"search": "SILVER - COMMODITY EXCHANGE INC.",              "report": "disaggregated"},
    # Equity indices - TFF report
    "NQ": {"search": "NASDAQ MINI - CHICAGO MERCANTILE EXCHANGE",      "report": "tff"},
    "ES": {"search": "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",   "report": "tff"},
    "YM": {"search": "DJIA x $5 - CHICAGO BOARD OF TRADE",            "report": "tff"},
    "NIY": {"search": "NIKKEI STOCK AVERAGE YEN DENOM - CHICAGO MERCANTILE EXCHANGE", "report": "tff"},
    # FX majors - TFF report
    "6S": {"search": "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE",     "report": "tff"},
    "6C": {"search": "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE", "report": "tff"},
    "6A": {"search": "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE", "report": "tff"},
    "6E": {"search": "EURO FX - CHICAGO MERCANTILE EXCHANGE",         "report": "tff"},
    "6N": {"search": "NZ DOLLAR - CHICAGO MERCANTILE EXCHANGE",      "report": "tff"},
    "6J": {"search": "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE",   "report": "tff"},
    "6B": {"search": "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE",  "report": "tff"},
}


def api_get(url, params):
    """Simple GET request to the CFTC API. Returns parsed JSON."""
    query = "&".join(f"${k}={urllib.parse.quote(str(v))}" for k, v in params.items())
    full_url = f"{url}?{query}"
    req = urllib.request.Request(full_url, headers={"User-Agent": "COT-Data-Bot/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def num(v):
    """Convert API string value to int or 0."""
    if v is None or v == "":
        return 0
    try:
        return int(v)
    except ValueError:
        return 0


def parse_date(s):
    """Parse CFTC date string like '2026-07-07T00:00:00.000' to YYYY-MM-DD."""
    return s.split("T")[0]


def fetch_new_weeks(symbol, config, last_date):
    """
    Fetch COT data for one symbol from the CFTC API.
    Returns a list of dicts with keys: date, total_oi, spec_long, spec_short,
    hedge_long, hedge_short (price left as empty string).
    Only returns weeks newer than last_date.

    If last_date is None (no existing data), fetches the most recent
    DEFAULT_LOOKBACK_WEEKS weeks by ordering descending and reversing.
    """
    base_url = DISAGG_FO_URL if config["report"] == "disaggregated" else TFF_FO_URL
    market = config["search"]
    is_disagg = config["report"] == "disaggregated"

    where_clause = f"market_and_exchange_names = '{market}'"

    if last_date:
        # Normal case: we have existing data, fetch anything newer
        where_clause += f" AND report_date_as_yyyy_mm_dd > '{last_date}'"
        params = {
            "limit": 50,
            "where": where_clause,
            "order": "report_date_as_yyyy_mm_dd",
        }
    else:
        # First run: fetch most recent N weeks (order descending, then reverse)
        params = {
            "limit": DEFAULT_LOOKBACK_WEEKS,
            "where": where_clause,
            "order": "report_date_as_yyyy_mm_dd DESC",
        }

    rows = api_get(base_url, params)

    # If first run, reverse so oldest comes first (for chronological order in CSV)
    if not last_date:
        rows = list(reversed(rows))

    result = []

    for row in rows:
        date_str = parse_date(row.get("report_date_as_yyyy_mm_dd", ""))
        if not date_str:
            continue

        total_oi = num(row.get("open_interest_all"))

        if is_disagg:
            # Disaggregated: spec = Managed Money, hedge = Producer/Merchant
            spec_long = num(row.get("m_money_positions_long_all"))
            spec_short = num(row.get("m_money_positions_short_all"))
            hedge_long = num(row.get("prod_merc_positions_long"))
            hedge_short = num(row.get("prod_merc_positions_short"))
        else:
            # TFF: spec = Leveraged Funds, hedge = Dealer
            spec_long = num(row.get("lev_money_positions_long"))
            spec_short = num(row.get("lev_money_positions_short"))
            hedge_long = num(row.get("dealer_positions_long_all"))
            hedge_short = num(row.get("dealer_positions_short_all"))

        result.append({
            "symbol": symbol,
            "date": date_str,
            "total_oi": total_oi,
            "spec_long": spec_long,
            "spec_short": spec_short,
            "hedge_long": hedge_long,
            "hedge_short": hedge_short,
            "price": "",
        })

    return result


def load_existing_weekly():
    """Read existing weekly.csv and return (rows, last_date_per_symbol)."""
    rows = []
    last_date = {}

    if not os.path.exists(WEEKLY_CSV):
        return rows, last_date

    with open(WEEKLY_CSV, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
            sym = row["symbol"].strip()
            d = row["date"].strip()
            if sym and d:
                if sym not in last_date or d > last_date[sym]:
                    last_date[sym] = d

    return rows, last_date


def main():
    if not os.path.exists(META_CSV):
        print(f"ERROR: {META_CSV} not found.")
        sys.exit(1)

    with open(META_CSV, newline="") as f:
        meta_symbols = [row["symbol"].strip() for row in csv.DictReader(f)]

    existing_rows, last_dates = load_existing_weekly()
    print(f"Loaded {len(existing_rows)} existing rows from weekly.csv")
    for sym in meta_symbols:
        if sym in last_dates:
            print(f"  {sym}: last date = {last_dates[sym]}")

    all_new_rows = []
    errors = []

    for sym in meta_symbols:
        if sym not in ASSETS:
            print(f"  SKIP {sym}: no CFTC search config defined")
            continue

        config = ASSETS[sym]
        last = last_dates.get(sym)
        try:
            new_weeks = fetch_new_weeks(sym, config, last)
            if new_weeks:
                print(f"  {sym}: found {len(new_weeks)} new week(s)")
                all_new_rows.extend(new_weeks)
            else:
                print(f"  {sym}: up to date")
        except Exception as e:
            print(f"  {sym}: ERROR - {e}")
            errors.append(sym)

    if not all_new_rows:
        print("\nNo new data to add. weekly.csv is already up to date.")
        if errors:
            print(f"WARNING: errors fetching: {', '.join(errors)}")
        return

    fieldnames = ["symbol", "date", "total_oi", "spec_long", "spec_short",
                  "hedge_long", "hedge_short", "price"]

    with open(WEEKLY_CSV, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in existing_rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})
        for row in all_new_rows:
            writer.writerow(row)

    print(f"\nAdded {len(all_new_rows)} new row(s) to weekly.csv")
    print("Prices are left blank - fill them in manually if needed.")
    print("Run scripts/build_data.py next to rebuild cot.json.")

    if errors:
        print(f"WARNING: errors fetching some symbols: {', '.join(errors)}")


if __name__ == "__main__":
    main()
