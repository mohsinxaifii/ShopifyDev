# Apps installed on ZINARA

Shopify has no API for installing apps — each needs OAuth consent in a browser.
The `Zinara-X-Revolv-V6/main` theme has **no app dependencies**, so the storefront
renders without any of these. They restore back-office behaviour only.

## App Store apps (24) — install by link

| App | Developer | Install |
|---|---|---|
| BoostPop Popups & Banners | AdPerfect | [install](https://apps.shopify.com/a4574581f9095ed59f6321eeaeff42c3) |
| Flow | Shopify | [install](https://apps.shopify.com/15100ebca4d221b650a7671125cd1444) |
| Fulfillment Network | Shopify | [install](https://apps.shopify.com/6cd1dee7b2d1b3fe679f9e3b19b1a9cf) |
| GST Pro | Astral | [install](https://apps.shopify.com/0d5aea1e42490262238767559e2cc2bc) |
| GoKwik Cart-Slide Cart Drawer | GoKwik Commerce Solutions Pvt. Ltd. c/o Fineshift Software Inc. | [install](https://apps.shopify.com/25fc26c8f7e9549196d39f5c7b8c2a3f) |
| HubSpot | Hubspot (Data Sync) | [install](https://apps.shopify.com/e4d465ef040f358f41065cc71e218071) |
| Judge.me Reviews | Judge.me | [install](https://apps.shopify.com/8cada0f5da411a64e756606bb036f1ed) |
| KwikEngage | GOKWIK COMMERCE SOLUTIONS PRIVATE LIMITED c/o Fineshift Software Inc. | [install](https://apps.shopify.com/d74c123817c7f69837183e42f99a23fb) |
| KwikPass | GoKwik Commerce Solutions Pvt. Ltd. c/o Fineshift Software Inc. | [install](https://apps.shopify.com/55d949ad5ec9007937c90a193943597c) |
| MSG91 | Superheros Inc | [install](https://apps.shopify.com/1b7a23964d664a267ed7cbf3339a7589) |
| Matrixify | ITissible | [install](https://apps.shopify.com/88eff9935abeb622b5b85569b705f673) |
| Messaging | Shopify | [install](https://apps.shopify.com/14711ad7477a3d0211488990623ad24c) |
| Microsoft Clarity | Microsoft Clarity | [install](https://apps.shopify.com/f0038feda3e0f0db8cdb4ce3f29bf187) |
| OTPless WhatsApp Login | OTPLESS | [install](https://apps.shopify.com/6397948b4256803750c4139867f58d18) |
| Payflow | Appfleece | [install](https://apps.shopify.com/c8ce8fa96849fbf76ba21c0883d07745) |
| PicManager | Amasty | [install](https://apps.shopify.com/3eb5612cf8f988b2bbc5c7c0b34bf171) |
| Retail Barcode Labels | Shopify | [install](https://apps.shopify.com/6d282cc5913a7ef8cac3e56bfe47d868) |
| SE Wishlist Engine | Script Engine | [install](https://apps.shopify.com/987a9e2ba434637682021cb1219893e0) |
| Search & Discovery | Shopify | [install](https://apps.shopify.com/6bac79c21731e1e8e59b127c6213010a) |
| Shiprocket: eCommerce Shipping | Shiprocket - Shipping in India | [install](https://apps.shopify.com/fc14b70f3ba850c4411e17ab2a8833d4) |
| Tryon | Tryon | [install](https://apps.shopify.com/34cd8586286a05e2c2e6401b8e94f97c) |
| Wishlink | Wishlink | [install](https://apps.shopify.com/24ee7813e389d268e1542575936de0f4) |
| ZOX Zipcode Check & Validate | MageComp | [install](https://apps.shopify.com/e8d55fb240604715a79dd0b50eb4fba9) |
| Zapier | Zapier Inc | [install](https://apps.shopify.com/bbf0f683622bda8092c94de430b34bc8) |

## Custom / private apps (7) — no public listing

These were built for Zinara specifically. They cannot be installed from the App Store;
you would need the developer to share them, or rebuild them.

| App | Developer |
|---|---|
| Gokwik <> Zinara | GoKwik Commerce Solutions Pvt. Ltd. |
| Products Sync Excel | app developer |
| Shopify GraphiQL App | Shopify |
| Try at Home | app developer |
| customer-export | app developer |
| internal-sku-management | app developer |
| new-test-app | app developer |

## Notes

- Several App Store apps here are paid; some may refuse to install on a trial plan.
- **Search & Discovery** (Shopify, free) restores the 4 `shopify--discovery--*` metafield
  definitions that could not be created by API.
- **Judge.me** owns the `reviews.rating` / `reviews.rating_count` namespace. Those
  metafield *values* were copied and the theme reads them, so star ratings already render;
  installing Judge.me is only needed to manage reviews.
- GoKwik apps (KwikPass, KwikEngage, Cart-Slide, `Gokwik <> Zinara`) drive checkout/COD on
  Zinara and are commercially provisioned per merchant.
