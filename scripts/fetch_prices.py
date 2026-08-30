"""
Fetch live CME futures prices from Yahoo Finance API.
Saves to data/prices.json for the frontend dashboard.

Usage:
    python3 scripts/fetch_prices.py

No external libraries required - just the Python standard library.
"""

import json
import os
import urllib.request
import datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRICES_JSON = os.path.join(ROOT, "data", "prices.json")

# Map COT data symbols to Yahoo Finance tickers
# These are CME futures continuous contracts
PRICE_SYMBOLS = {
    "XAU/USD": {"yahoo": "GC=F",  "label": "Gold",            "decimals": 2},
    "XAG/USD": {"yahoo": "SI=F",  "label": "Silver",          "decimals": 2},
    "ES":      {"yahoo": "ES=F",  "label": "S&P 500",          "decimals": 2},
    "NQ":      {"yahoo": "NQ=F",  "label": "Nasdaq 100",       "decimals": 2},
    "YM":      {"yahoo": "YM=F",  "label": "Dow Jones",        "decimals": 2},
    "NIY":     {"yahoo": "NIY=F", "label": "Nikkei 225",       "decimals": 0},
    "AUD/USD": {"yahoo": "6A=F",  "label": "AUD/USD",          "decimals": 4},
    "GBP/USD": {"yahoo": "6B=F",  "label": "GBP/USD",          "decimals": 4},
    "CAD/USD": {"yahoo": "6C=F",  "label": "CAD/USD",          "decimals": 4},
    "EUR/USD": {"yahoo": "6E=F",  "label": "EUR/USD",          "decimals": 4},
    "JPY/USD": {"yahoo": "6J=F",  "label": "JPY/USD",          "decimals": 6},
    "NZD/USD": {"yahoo": "6N=F",  "label": "NZD/USD",          "decimals": 4},
    "CHF/USD": {"yahoo": "6S=F",  "label": "CHF/USD",          "decimals": 4},
    "CL":      {"yahoo": "CL=F",  "label": "Crude Oil WTI",    "decimals": 2},
}


def fetch_price(symbol, yahoo_ticker):
    """Fetch live price data from Yahoo Finance."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_ticker}?interval=1d&range=5d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    
    meta = data.get("chart", {}).get("result", [{}])[0].get("meta", {})
    
    price = meta.get("regularMarketPrice")
    prev_close = meta.get("chartPreviousClose")
    day_high = meta.get("regularMarketDayHigh")
    day_low = meta.get("regularMarketDayLow")
    change_pct = meta.get("regularMarketChangePercent", 0)
    
    if price is None:
        return None
    
    change = price - prev_close if prev_close else 0
    
    # Get 5-day price history from the chart data
    result = data.get("chart", {}).get("result", [{}])[0]
    timestamps = result.get("timestamp", [])
    quotes = result.get("indicators", {}).get("quote", [{}])[0]
    closes = quotes.get("close", [])
    
    history = []
    for i, ts in enumerate(timestamps):
        if i < len(closes) and closes[i] is not None:
            history.append({
                "date": dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).strftime("%Y-%m-%d"),
                "close": round(closes[i], 4),
            })
    
    return {
        "symbol": symbol,
        "price": round(price, 6),
        "prevClose": round(prev_close, 6) if prev_close else None,
        "change": round(change, 6),
        "changePct": round(change_pct, 2),
        "dayHigh": round(day_high, 6) if day_high else None,
        "dayLow": round(day_low, 6) if day_low else None,
        "history": history,
    }


def main():
    os.makedirs(os.path.dirname(PRICES_JSON), exist_ok=True)
    
    print("Fetching live prices from Yahoo Finance...")
    prices = {}
    
    for symbol, config in PRICE_SYMBOLS.items():
        yahoo_ticker = config["yahoo"]
        try:
            data = fetch_price(symbol, yahoo_ticker)
            if data:
                prices[symbol] = data
                print(f"  {symbol:8s} ({yahoo_ticker:6s}): ${data['price']:>12.4f}  ({data['changePct']:>+5.2f}%)")
            else:
                print(f"  {symbol:8s} ({yahoo_ticker:6s}): No price data")
        except Exception as e:
            print(f"  {symbol:8s} ({yahoo_ticker:6s}): ERROR - {e}")
    
    output = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "prices": prices,
    }
    
    with open(PRICES_JSON, "w") as f:
        json.dump(output, f, indent=1)
    
    print(f"\nSaved {len(prices)} prices to {PRICES_JSON}")


if __name__ == "__main__":
    main()
