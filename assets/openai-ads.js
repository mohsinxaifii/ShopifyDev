/**
 * OpenAI Ads (ChatGPT Ads) - the events beyond page_viewed and contents_viewed
 * (those two fire from snippets/openai-ads-pixel.liquid and
 * snippets/openai-ads-product-viewed.liquid, as on the live theme).
 *
 * Unlike Google and Meta, OpenAI has no Shopify app sending the shopping events,
 * so they all come from here:
 *
 *   items_added       every add that the cart confirms - the theme's own
 *                     (cart-drawer.js) and KwikCart's - announced as
 *                     `zinara:cart-added` with the lines /cart/add.js returned.
 *   checkout_started  every Checkout / Buy now click, GoKwik's or Shopify's
 *                     (`zinara:checkout-intent`, see analytics-config.liquid).
 *   custom events     a copy of every event the theme sends to Meta (the
 *                     tracking plan's events), as on the live theme, by
 *                     proxying fbq. Meta's own commerce events come from its
 *                     app, never through this page's fbq, so nothing here
 *                     repeats items_added or checkout_started.
 *
 * Event reference: https://developers.openai.com/ads/supported-events
 */
(() => {
  const OA = window.OpenAIAds;
  if (!OA) return;

  /* ------------------------------------------------------------ helpers */

  // Shopify money is already in minor units (paise); Meta payloads are in ₹.
  const majorToMinor = (value) => {
    const n = typeof value === 'string' ? parseFloat(value) : value;
    return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) : undefined;
  };

  const sum = (contents) =>
    contents.reduce((total, item) => total + (item.amount || 0) * (item.quantity || 1), 0);

  let cartLines = (OA.config.cart && OA.config.cart.items) || [];
  const refreshCart = async () => {
    try {
      const response = await fetch(`${window.Shopify?.routes?.root || '/'}cart.js`, {
        headers: { Accept: 'application/json' },
      });
      cartLines = (await response.json()).items || [];
    } catch (error) {
      // Keep the last snapshot.
    }
  };
  document.addEventListener('cart:updated', refreshCart);

  /* -------------------------------------------------------- items_added */

  document.addEventListener('zinara:cart-added', (event) => {
    const lines = event.detail?.items || [];
    const contents = OA.contents(lines);
    if (!contents.length) return;
    OA.track('items_added', { type: 'contents', amount: sum(contents), currency: OA.currency, contents });
  });

  /* --------------------------------------------------- checkout_started */

  document.addEventListener('zinara:checkout-intent', (event) => {
    let contents = [];
    if (event.detail?.location === 'buy_now') {
      // Buy now checks out the product on the page, in the variant picked now.
      const item = window.zinaraPdp?.currentItem?.() || window.zinaraAnalyticsConfig?.product?.item;
      if (item) {
        contents = [
          {
            id: String(item.item_id),
            name: item.item_name || '',
            content_type: 'product',
            quantity: 1,
            amount: majorToMinor(item.price),
            currency: OA.currency,
          },
        ];
      }
    } else {
      contents = OA.contents(cartLines);
    }
    if (!contents.length) return;
    OA.track('checkout_started', { type: 'contents', amount: sum(contents), currency: OA.currency, contents });
  });

  /* ------------------------------------------ copies of the Meta events */

  // Sent above from the cart itself; skipped here if Meta ever gets them too.
  const SKIP = new Set(['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase']);

  const customName = (name) =>
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
      .slice(0, 64) || null;

  function forward(args) {
    const [command, eventName, props = {}] = args;
    if ((command !== 'track' && command !== 'trackCustom') || !eventName || SKIP.has(eventName)) return;
    const name = customName(eventName);
    if (!name) return;

    const data = { type: 'custom' };
    const value = majorToMinor(props.value ?? props.price);
    if (value !== undefined) {
      data.amount = value;
      data.currency = props.currency || OA.currency;
    }
    OA.track('custom', data, { custom_event_name: name });
  }

  function bridge() {
    const fbq = window.fbq;
    if (typeof fbq !== 'function' || fbq.__openaiBridged || typeof window.Proxy !== 'function') return false;
    // A Proxy keeps fbq transparent: fbevents.js still reads queue/callMethod
    // on the original function.
    window.fbq = new window.Proxy(fbq, {
      apply(target, thisArg, args) {
        try {
          forward(args);
        } catch (error) {
          OA.log('bridge error', error);
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
    window.fbq.__openaiBridged = true;
    return true;
  }

  if (!bridge()) {
    let attempts = 0;
    const timer = setInterval(() => {
      if (bridge() || ++attempts > 20) clearInterval(timer);
    }, 250);
  }
})();
