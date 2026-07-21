import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from data_source import ASSETS as FIN_ASSETS  # Silver, NASDAQ100, SP500, DOWJONES, NIKKEIYEN, CHF, CAD, AUD, EUR, NZD, JPY, GBP
import datetime as dt

def dstr(d):
    return d.strftime("%Y-%m-%d")

# ---- Gold (legacy format), pulled from the original Gold_COT_Tracker.xlsx raw data ----
GOLD_ROWS = [
    # date, total_oi, prod_l, prod_s, swap_l, swap_s, swap_spr, mm_l, mm_s, mm_spr, or_l, or_s, or_spr, nr_l, nr_s, price
    (dt.datetime(2026,4,21), 365842, 12633, 33051, 28115, 210637, 15513, 123681, 30705, 33896, 89212, 18182, 10569, 52223, 13289, 4740.9),
    (dt.datetime(2026,4,28), 369530, 12985, 33177, 28032, 202653, 19536, 122257, 32505, 35404, 89561, 19742, 12475, 49280, 14038, 4644.5),
    (dt.datetime(2026,5,5),  367932, 12898, 32010, 27319, 207142, 18013, 123353, 29099, 37353, 88461, 19412, 11283, 49252, 13620, 4730.7),
    (dt.datetime(2026,5,12), 376496, 11437, 31639, 25671, 215727, 20617, 127242, 29227, 36664, 92551, 18944, 12363, 49951, 11315, 4561.9),
    (dt.datetime(2026,5,19), 379325, 14800, 32714, 28950, 202665, 25770, 122894, 29354, 38714, 88124, 21831, 12991, 47082, 15286, 4523.2),
    (dt.datetime(2026,5,26), 353489, 12586, 32096, 29033, 195289, 33022, 124277, 26831, 20369, 76427, 19613, 10626, 47149, 15643, 4593.0),
    (dt.datetime(2026,6,2),  326052, 10275, 30429, 27505, 213696, 16071, 129367, 17188, 12456, 76729, 12888, 9993, 43656, 13331, 4365.3),
    (dt.datetime(2026,6,9),  332709, 10833, 30133, 28443, 210179, 19710, 126280, 20417, 13173, 81704, 13730, 9675, 42891, 15692, 4238.8),
    (dt.datetime(2026,6,16), 339330, 12191, 29238, 29455, 219971, 16574, 128043, 14322, 13259, 83084, 16585, 12758, 43966, 16623, 4245.9),
    (dt.datetime(2026,6,23), 352167, 15839, 25175, 27738, 223806, 21002, 131102, 15707, 15170, 85926, 19982, 16125, 39265, 15200, 4096.3),
    (dt.datetime(2026,6,30), 369541, 15161, 32207, 25821, 229845, 18136, 134577, 14486, 16929, 95042, 21114, 14840, 49035, 21984, 4125.7),
    (dt.datetime(2026,7,7),  371776, 14282, 35268, 25445, 226741, 19837, 134941, 18780, 17256, 98772, 20687, 15607, 45636, 17600, 4113.7),
    (dt.datetime(2026,7,14), 383689, 15840, 34989, 25177, 220816, 38622, 136905, 16126, 18475, 90405, 24502, 13846, 44419, 16313, 4018.8),
]

GOLD = {
    "name": "Gold",
    "symbol": "GC",
    "format": "legacy",
    "price_label": "XAU/USD",
    "rows": [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15]) for r in GOLD_ROWS],
}

CATEGORY = {
    "GC": "Metals", "SI": "Metals",
    "NQ": "Equity Indices", "ES": "Equity Indices", "YM": "Equity Indices", "NIY": "Equity Indices",
    "6S": "FX Majors", "6C": "FX Majors", "6A": "FX Majors", "6E": "FX Majors",
    "6N": "FX Majors", "6J": "FX Majors", "6B": "FX Majors",
}

DISPLAY_SYMBOL = {
    "GC": "XAU/USD", "SI": "XAG/USD", "NQ": "NQ", "ES": "ES", "YM": "YM", "NIY": "NIY",
    "6S": "CHF/USD", "6C": "CAD/USD", "6A": "AUD/USD", "6E": "EUR/USD",
    "6N": "NZD/USD", "6J": "JPY/USD", "6B": "GBP/USD",
}


def export_asset(asset, has_price_row_with_price=False):
    fmt = asset["format"]
    out_weeks = []
    prev = None
    for row in asset["rows"]:
        date = row[0]
        if fmt == "legacy":
            (_, total_oi, prod_l, prod_s, swap_l, swap_s, swap_spr,
             mm_l, mm_s, mm_spr, or_l, or_s, or_spr, nr_l, nr_s, *rest) = row
            price = rest[0] if rest else None
            spec_long, spec_short = mm_l, mm_s
            hedge_long, hedge_short = prod_l, prod_s
        else:
            (_, total_oi, dl_l, dl_s, dl_spr, am_l, am_s, am_spr,
             lev_l, lev_s, lev_spr, or_l, or_s, or_spr, nr_l, nr_s, *rest) = row
            price = rest[0] if rest else None
            spec_long, spec_short = lev_l, lev_s
            hedge_long, hedge_short = dl_l, dl_s

        spec_net = spec_long - spec_short
        hedge_net = hedge_long - hedge_short
        week = {
            "date": dstr(date),
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
                week["priceChg"] = round(price - prev["price"], 4)
                week["priceDir"] = "UP" if price > prev["price"] else ("DOWN" if price < prev["price"] else "FLAT")
            else:
                week["priceChg"] = None
                week["priceDir"] = None
            week["specDir"] = "UP" if week["specNetChg"] > 0 else ("DOWN" if week["specNetChg"] < 0 else "FLAT")
            if week["priceDir"] and week["priceDir"] != "FLAT" and week["specDir"] != "FLAT":
                if week["priceDir"] == "UP" and week["specDir"] == "DOWN":
                    week["divergence"] = "DIVERGENCE"
                elif week["priceDir"] == "DOWN" and week["specDir"] == "UP":
                    week["divergence"] = "DIVERGENCE"
                else:
                    week["divergence"] = "CONFIRMED"
            else:
                week["divergence"] = None
        else:
            week["specNetChg"] = None
            week["hedgeNetChg"] = None
            week["oiChg"] = None
            week["priceChg"] = None
            week["priceDir"] = None
            week["specDir"] = None
            week["divergence"] = None
        out_weeks.append(week)
        prev = week

    spec_label = "Managed Money" if fmt == "legacy" else "Leveraged Funds"
    hedge_label = "Producer/Merchant" if fmt == "legacy" else "Dealer/Intermediary"

    return {
        "symbol": asset["symbol"],
        "displaySymbol": DISPLAY_SYMBOL.get(asset["symbol"], asset["symbol"]),
        "name": asset["name"],
        "category": CATEGORY.get(asset["symbol"], "Other"),
        "format": fmt,
        "specLabel": spec_label,
        "hedgeLabel": hedge_label,
        "hasPriceData": any(w["price"] is not None for w in out_weeks),
        "weeks": out_weeks,
    }


def main():
    all_assets = [GOLD] + FIN_ASSETS
    exported = [export_asset(a) for a in all_assets]
    exported.sort(key=lambda a: (a["category"], a["symbol"]))
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "cot.json")
    with open(out_path, "w") as f:
        json.dump({"generated": dt.datetime.now().isoformat(), "assets": exported}, f, indent=1)
    print("exported", len(exported), "assets")


if __name__ == "__main__":
    main()
