"""
Build data/cot.json from the editable CSV source files.

Run this after editing data-source/weekly.csv (e.g. adding a new Friday's
row for each pair). In the repo this also runs automatically via
.github/workflows/build.yml whenever weekly.csv or meta.csv change.

Usage:
    python3 scripts/build_data.py
"""
import csv
import json
import os
import datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META_CSV = os.path.join(ROOT, "data-source", "meta.csv")
WEEKLY_CSV = os.path.join(ROOT, "data-source", "weekly.csv")
OUT_JSON = os.path.join(ROOT, "data", "cot.json")

CATEGORY_ORDER = {"Metals": 0, "Equity Indices": 1, "FX Majors": 2}


def num(v):
    if v is None or v == "":
        return None
    return float(v) if ("." in v or "e" in v.lower()) else int(v)


def load_meta():
    meta = {}
    with open(META_CSV, newline="") as f:
        for row in csv.DictReader(f):
            meta[row["symbol"].strip()] = row
    return meta


def load_weekly():
    by_symbol = {}
    with open(WEEKLY_CSV, newline="") as f:
        for row in csv.DictReader(f):
            sym = row["symbol"].strip()
            if not sym:
                continue
            by_symbol.setdefault(sym, []).append(row)
    # sort each symbol's rows by date ascending
    for sym in by_symbol:
        by_symbol[sym].sort(key=lambda r: r["date"])
    return by_symbol


def build_asset(sym, meta_row, rows):
    weeks = []
    prev = None
    for row in rows:
        total_oi = num(row["total_oi"])
        spec_long = num(row["spec_long"])
        spec_short = num(row["spec_short"])
        hedge_long = num(row["hedge_long"])
        hedge_short = num(row["hedge_short"])
        price = num(row.get("price"))

        spec_net = spec_long - spec_short
        hedge_net = hedge_long - hedge_short

        week = {
            "date": row["date"],
            "totalOI": total_oi,
            "specLong": spec_long, "specShort": spec_short, "specNet": spec_net,
            "specNetPctOI": round(spec_net / total_oi, 4) if total_oi else None,
            "hedgeLong": hedge_long, "hedgeShort": hedge_short, "hedgeNet": hedge_net,
            "price": price,
        }
        if prev:
            week["specNetChg"] = spec_net - prev["specNet"]
            week["hedgeNetChg"] = hedge_net - prev["hedgeNet"]
            week["oiChg"] = total_oi - prev["totalOI"]
            if price is not None and prev["price"] is not None:
                week["priceChg"] = round(price - prev["price"], 6)
                week["priceDir"] = "UP" if price > prev["price"] else ("DOWN" if price < prev["price"] else "FLAT")
            else:
                week["priceChg"] = None
                week["priceDir"] = None
            week["specDir"] = "UP" if week["specNetChg"] > 0 else ("DOWN" if week["specNetChg"] < 0 else "FLAT")
            if week["priceDir"] and week["priceDir"] != "FLAT" and week["specDir"] != "FLAT":
                if (week["priceDir"] == "UP" and week["specDir"] == "DOWN") or \
                   (week["priceDir"] == "DOWN" and week["specDir"] == "UP"):
                    week["divergence"] = "DIVERGENCE"
                else:
                    week["divergence"] = "CONFIRMED"
            else:
                week["divergence"] = None
        else:
            for k in ["specNetChg", "hedgeNetChg", "oiChg", "priceChg", "priceDir", "specDir", "divergence"]:
                week[k] = None
        weeks.append(week)
        prev = week

    return {
        "symbol": sym,
        "displaySymbol": meta_row["displaySymbol"],
        "name": meta_row["name"],
        "category": meta_row["category"],
        "format": meta_row["format"],
        "specLabel": meta_row["specLabel"],
        "hedgeLabel": meta_row["hedgeLabel"],
        "hasPriceData": any(w["price"] is not None for w in weeks),
        "weeks": weeks,
    }


def main():
    meta = load_meta()
    weekly = load_weekly()

    missing_meta = [s for s in weekly if s not in meta]
    if missing_meta:
        raise SystemExit(
            f"weekly.csv has symbol(s) not in meta.csv: {missing_meta}. "
            f"Add a row for each in data-source/meta.csv first."
        )

    assets = []
    for sym, rows in weekly.items():
        assets.append(build_asset(sym, meta[sym], rows))

    assets.sort(key=lambda a: (CATEGORY_ORDER.get(a["category"], 9), a["symbol"]))

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w") as f:
        json.dump({"generated": dt.datetime.now(dt.timezone.utc).isoformat(), "assets": assets}, f, indent=1)

    print(f"Built {OUT_JSON} — {len(assets)} pairs, "
          f"{sum(len(a['weeks']) for a in assets)} total weekly rows.")


if __name__ == "__main__":
    main()
