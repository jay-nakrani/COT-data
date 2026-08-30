"""
Fill in missing weekly closing prices in data-source/weekly.csv.

The CFTC COT report doesn't publish price - fetch_cot.py leaves the
`price` column blank for newly-added rows. This script fetches the
CME futures closing price from Yahoo Finance for the report date
("as of" Tuesday) of every blank row, and fills it in.

Usage:
    python3 scripts/fill_weekly_prices.py

No external libraries required - just the Python standard library.
"""

import csv
import os
import json
import urllib.request
import datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEEKLY_CSV = os.path.join(ROOT, "data-source", "weekly.csv")

# Map weekly.csv symbol -> Yahoo Finance continuous futures ticker
YAHOO_TICKERS = {
    "GC": "GC=F",   # Gold
    "SI": "SI=F",   # Silver
    "ES": "ES=F",   # S&P 500 E-Mini
    "NQ": "NQ=F",   # Nasdaq 100 E-Mini
    "YM": "YM=F",   # Dow Jones E-Mini
    "NIY": "NIY=F", # Nikkei/Yen
    "6S": "6S=F",   # Swiss Franc
    "6C": "6C=F",   # Canadian Dollar
    "6A": "6A=F",   # Australian Dollar
    "6E": "6E=F",   # Euro FX
    "6N": "6N=F",   # NZ Dollar
    "6J": "6J=F",   # Japanese Yen
    "6B": "6B=F",   # British Pound
}


def fetch_close_on_or_before(yahoo_ticker, target_date):
    """
    Fetch the closing price on target_date (a date object), or the
    closest earlier trading day's close if the market was closed
    (e.g. Tuesday holiday). Uses Yahoo Finance's chart API with a
    10-day lookback window ending a few days after target_date.
    """
    period_end = target_date + dt.timedelta(days=4)
    period1 = int(dt.datetime.combine(target_date - dt.timedelta(days=10), dt.time()).timestamp())
    period2 = int(dt.datetime.combine(period_end, dt.time()).timestamp())

    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_ticker}"
        f"?period1={period1}&period2={period2}&interval=1d"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    result = data.get("chart", {}).get("result", [{}])[0]
    timestamps = result.get("timestamp", [])
    closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", [])

    if not timestamps:
        return None

    # Build (date, close) pairs, keep only ones on or before target_date
    candidates = []
    for ts, close in zip(timestamps, closes):
        if close is None:
            continue
        d = dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).date()
        if d <= target_date:
            candidates.append((d, close))

    if not candidates:
        return None

    # Take the latest date at or before target_date
    candidates.sort(key=lambda pair: pair[0])
    return candidates[-1][1]


def main():
    if not os.path.exists(WEEKLY_CSV):
        print(f"ERROR: {WEEKLY_CSV} not found.")
        return

    with open(WEEKLY_CSV, newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    filled = 0
    skipped = 0

    for row in rows:
        price = row.get("price", "").strip()
        if price:
            continue  # already has a price

        symbol = row["symbol"].strip()
        yahoo_ticker = YAHOO_TICKERS.get(symbol)
        if not yahoo_ticker:
            print(f"  SKIP {symbol} {row['date']}: no Yahoo ticker mapping")
            skipped += 1
            continue

        try:
            target_date = dt.datetime.strptime(row["date"].strip(), "%Y-%m-%d").date()
            close = fetch_close_on_or_before(yahoo_ticker, target_date)
            if close is not None:
                row["price"] = round(close, 6)
                print(f"  FILLED {symbol} {row['date']}: {row['price']}")
                filled += 1
            else:
                print(f"  NO DATA {symbol} {row['date']}: Yahoo returned nothing")
                skipped += 1
        except Exception as e:
            print(f"  ERROR {symbol} {row['date']}: {e}")
            skipped += 1

    if filled == 0:
        print("\nNo blank prices found (or none could be filled). weekly.csv unchanged.")
        return

    with open(WEEKLY_CSV, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nFilled {filled} price(s), skipped {skipped}. weekly.csv updated.")


if __name__ == "__main__":
    main()
