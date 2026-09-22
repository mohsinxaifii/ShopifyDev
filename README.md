# Zinara-X-Revolv-V6 theme

Theme `Zinara-X-Revolv-V6/main` pulled from the ZINARA store (`432866-5c.myshopify.com`,
theme id `191188009144`, unpublished there) and deployed to `mohsinxaifi.myshopify.com`.

The source store was accessed read-only — nothing there was created, changed or deleted.

## Layout

| Path         | Count | Notes |
|--------------|-------|-------|
| `assets/`    | 125   | css/js/images |
| `blocks/`    | 2     | theme blocks |
| `config/`    | 2     | `settings_schema.json`, `settings_data.json` (ships empty — this theme is hard-coded, not merchant-configurable) |
| `layout/`    | 2     | `theme.liquid`, `password.liquid` |
| `locales/`   | 2     | |
| `sections/`  | 49    | includes `header-group.json` / `footer-group.json` |
| `snippets/`  | 36    | |
| `templates/` | 16    | JSON templates + `gift_card.liquid` |

## Dependencies

- **No app embeds and no app blocks.** The theme renders entirely from its own code.
- 69 images referenced as `shopify://shop_images/...` — all uploaded to the destination's Files library.
- 34 metafield namespace/key pairs read by the theme (`custom.pdp_*`, `content.*`, `reviews.rating`,
  `shop.metafields.custom.pdp_offers`) — definitions and values were cloned.

## Pushing changes

```bash
shopify theme push --store mohsinxaifi.myshopify.com --theme <THEME_ID>
```
