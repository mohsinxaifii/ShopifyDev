# ZINARA → mohsinxaifi clone

Source: `432866-5c.myshopify.com` (ZINARA, Grow plan) — **read-only, never written to**
Target: `mohsinxaifi.myshopify.com` (Mohsin Dev, trial plan)
Run: 2026-09-22

Per your instruction, customers and orders were **not** copied.

---

## What was cloned

| Item | Source | Target | Status |
|---|---:|---:|---|
| Theme `Zinara-X-Revolv-V6/main` | 234 files | 234 files | all byte-identical |
| Products | 559 | 559 | verified |
| Variants | 6,413 | 6,413 | verified |
| Product media | 5,874 | 5,874 | verified |
| Collections | 25 | 25 | all 25 rule sets identical |
| Metafield definitions | 89 | 85 | 4 are app-owned, see below |
| Metaobject definitions | 18 | 17 | 1 is Shopify-owned, see below |
| Metaobject entries (custom) | 144 | 144 | verified |
| Shop metafields | 38 | 38 | verified |
| Pages | 19 | 19 | verified |
| Blog + articles | 1 + 2 | 1 + 2 | verified |
| Menus | 9 | 9 | verified |
| Discount codes | 55 | 51 | all 25 **active** codes cloned |
| URL redirects | 12 | 12 | verified |
| Policies | 5 | 4 | privacy policy blocked, see below |
| Inventory levels | 239 non-zero | 239 | verified |

A 40-product deep comparison (title, vendor, type, tags, status, description, category,
options, media count, every metafield, and every variant's price / compare-at / barcode /
taxable / inventory policy / options / metafields) returned **zero discrepancies**.

The theme is **unpublished** on the target, matching its role on Zinara. `Horizon` is still
the live theme — publish V6 from Online Store → Themes when you want it live.

---

## Needs you to act

### 1. Apps — 30 of them, none installable by API

Shopify has no API to install an app; it requires OAuth consent in a browser. This is a
platform limit, not something the token can work around.

**The good news:** `Zinara-X-Revolv-V6/main` has **zero app dependencies** — no app embeds,
no app blocks in any JSON template, and no app vendor scripts anywhere in its 234 files. The
storefront renders fully without installing anything. Its `settings_data.json` is `{"current": {}}`,
so there are no app-embed settings to carry over either.

Apps are only needed to restore back-office behaviour (reviews, shipping, COD, login, popups).
Install links for the 24 App Store apps and the 7 custom apps are in
[clone-tooling/apps.md](clone-tooling/apps.md). Note several are paid and some may not install
on a trial plan.

### 2. Settings that have no API (admin UI only)

These change how prices render, so they matter for a visual match:

| Setting | Zinara | mohsinxaifi | Where |
|---|---|---|---|
| Currency format | `{{amount}}` | `Rs. {{amount}}` | Settings → General → Currency formatting |
| With-currency format | `₹ {{amount}}` | `Rs. {{amount}} INR` | same |
| Prices include tax | off | **on** | Settings → Taxes and duties |
| Storefront password | off | **on** | Online Store → Preferences |

### 3. Privacy policy

Refused with *"Automatic management for Privacy Policy must be turned off."* Turn off
auto-management in Settings → Policies, then re-run `python3 clone-tooling/imp_policies.py`.
The other 4 policies copied fine.

### 4. Videos — 7 files blocked by the trial plan

Shopify rejected all 7 with `UNACCEPTABLE_TRIAL_ASSET` ("not supported on trial accounts").
All 202 images uploaded fine. Three product metafields that point at these videos are
consequently unset: `custom.pdp_ugc_videos`, `custom.pdp_size_guide_video`,
`custom.size_chart_video`.

After upgrading off trial:

```bash
cd clone-tooling
export SRC_TOKEN=...  DST_TOKEN=...
python3 retry_videos.py && python3 reindex_files.py && python3 imp_deferred.py
```

---

## Deliberate gaps (nothing to fix)

- **4 metafield definitions** in `shopify--discovery--*` are owned by the Search & Discovery
  app. They reappear when that app is installed.
- **1 metaobject definition**, `shopify--knowledge-base-fact`, is Shopify-owned and not
  creatable via API. The theme never references it.
- **4 discount codes** (`ZNR6676`, `MEADOW1`, `RADIANT1`, `ZNR1000`) could not be recreated:
  each is `target_selection: entitled` with an **empty** product list, because the products
  they targeted were deleted. All 4 **expired in 2024**. They are already dead on Zinara.
- **3 menu items** pointed at `Collection/636911648952`, which returns `null` on Zinara —
  a pre-existing broken link there, dropped rather than reproduced.
- **2 menu items** in `customer-account-main-menu` are Shopify-managed customer-account
  system pages bound to `myaccount.zinara.in`. They regenerate per store.
- **34 customer references** inside `try_at_home_slot` / `video_trial_slot` metaobjects were
  dropped, since customers were not copied. The booking records themselves were created.
- **`home-trial` (93→91)** and **`ready-to-ship` (118→116)**: both require
  `VARIANT_INVENTORY > 0`. Inventory is *identical* on both stores for the two products
  involved (all zero) — Zinara's membership is stale because Shopify re-evaluates smart
  collections lazily. The target is applying the rule correctly; the rule sets are identical.
- **`frontpage` ("Home page")** was deleted from the target. It is a Shopify default that
  Zinara does not have and the theme never references.

---

## Source store integrity

Every resource this clone touched is unchanged on Zinara:

```
products 559  collections 25  pages 19  blogs 1  price_rules 55  themes 15   all UNCHANGED
live theme still Zinara-X-Revolv/main (191184699576)
Zinara-X-Revolv-V6/main still unpublished, updated_at still 2026-09-15T09:08:17+05:30
shop.updated_at unchanged: 2026-09-17T02:42:07+05:30
```

Customers moved 2862 → 2867 and orders 744 → 745 **during** the run. These are not from this
work — Zinara is a live store with real traffic. The new records are genuine shopper signups,
and order `#ZNR1745` (₹6,389.10) came through `Online Store / web` at 18:46 UTC. No customer
or order endpoint was ever written to.

The helper in [clone-tooling/lib/sh.py](clone-tooling/lib/sh.py) raises `SourceWriteBlocked`
on any non-GET/HEAD request or any GraphQL mutation aimed at the source, so a write to Zinara
was not possible even by mistake. This was tested before the first call.

---

## Tooling

[clone-tooling/](clone-tooling/) holds every script used, plus `maps/` (source→target ID
mappings — needed to re-run any stage idempotently). Tokens are read from `SRC_TOKEN` and
`DST_TOKEN`; none are stored in this repo.

Re-run order if you ever need to repeat it:

```
imp_mo_defs → fix_mo_defs → imp_mf_defs → up_files → imp_products → imp_collections
→ imp_inventory → reindex_files → imp_metaobjects2 → imp_deferred → imp_pages
→ imp_blogs → imp_menus → imp_discounts → imp_shopmf → imp_policies → imp_redirects
→ imp_publish → verify + deepverify
```
