/**
 * Event tracking for GA4 and Meta - the Zinara event tracking plan.
 *
 * Who sends what, so nothing is counted twice:
 *
 *   The Google & YouTube and Facebook & Instagram apps already send, from
 *   Shopify's own pixels: page_view, view_item, view_item_list, search,
 *   add_to_cart, remove_from_cart, view_cart, begin_checkout, add_shipping_info,
 *   add_payment_info, purchase (Google) and PageView, ViewContent, Search,
 *   AddToCart, InitiateCheckout, AddPaymentInfo, Purchase (Meta). This file
 *   never sends those to the platform that already has them:
 *
 *   - gtag is configured with send_page_view: false, and fbq is initialised
 *     without a PageView.
 *   - view_item, add_to_cart and search from the plan are left to the apps.
 *   - view_item_list goes to Meta only (the Meta app has no equivalent).
 *   - begin_checkout is the exception the plan calls for: checkout runs on
 *     GoKwik, where Shopify's pixels cannot see it, so the theme sends it -
 *     switchable in theme settings in case checkout ever moves back to Shopify.
 *   - purchase / refund / cancel / RTO stay server-side, as the plan says.
 *
 * Everything else in the plan is sent from here, to GA4 as the plan's event
 * name and to Meta as a custom event of the same name (or the matching Meta
 * standard event where one exists: AddToWishlist, Contact, InitiateCheckout).
 * Each event also lands on window.dataLayer for GTM, without a GTM container
 * loaded, so it cannot double-fire anything.
 *
 * Wiring:
 *   - Markup: an element with data-analytics="event_name" sends that event on
 *     click; data-analytics-* attributes supply its values
 *     (data-analytics-section-name -> section_name). Only the parameters the plan lists for that event are
 *     kept, and common ones (page_type, destination_url, product_id) are filled
 *     in automatically.
 *   - Code: components call window.zinaraTrack(name, params) - defined as a
 *     queue in layout/theme.liquid, so calls made before this file loads wait
 *     here instead of being lost.
 */
(() => {
  const config = window.zinaraAnalyticsConfig || {};
  const queued = Array.isArray(window.zinaraTrackQueue) ? window.zinaraTrackQueue : [];

  /* ------------------------------------------------------------ the plan */

  /*
   * Event -> the parameters the plan lists for it (global properties are added
   * to every event on top). meta: 'custom' (trackCustom, same name), a Meta
   * standard event name, or false to keep it off Meta. ga: false keeps it off
   * GA4 (because the Google app already sends it).
   */
  const PLAN = {
    // 1. Global
    announcement_bar_click: ['message_text', 'destination_url', 'page_type'],
    nav_icon_click: ['icon_name', 'page_type', 'cart_count', 'wishlist_count'],
    sidenav_open: ['page_type'],
    sidenav_item_click: ['item_name', 'item_group', 'position', 'destination_url'],
    breadcrumb_click: ['crumb_text', 'crumb_level', 'destination_url', 'page_type'],
    footer_link_click: ['link_text', 'link_group', 'destination_url', 'page_type'],
    faq_expand: ['question', 'faq_position', 'page_type'],
    page_not_found: ['page_url', 'referrer'],
    scroll_depth: ['percent_scrolled', 'page_type', 'page_url'],
    // 2. Homepage
    homepage_view: ['page_title', 'page_url', 'referrer'],
    home_banner_view: ['banner_id', 'banner_name', 'banner_position'],
    home_banner_click: ['banner_id', 'banner_name', 'destination_url', 'banner_position'],
    category_click: ['category_name', 'category_url', 'section_name', 'position'],
    home_section_view: ['section_name', 'section_position'],
    product_tab_select: ['section_name', 'tab_name', 'tab_position', 'page_type'],
    know_your_jewellery_interaction: ['card_name', 'action', 'card_index', 'page_type'],
    ugc_video_open: ['video_id', 'position', 'tagged_product_id', 'page_type'],
    ugc_video_progress: ['video_id', 'percent_watched', 'tagged_product_id'],
    collection_click: ['collection_name', 'section_name', 'position', 'destination_url'],
    section_cta_click: ['section_name', 'cta_text', 'destination_url', 'page_type'],
    review_card_open: ['review_id', 'product_id', 'rating', 'page_type'],
    review_product_click: ['review_id', 'product_id', 'page_type'],
    celebrity_look_click: ['celebrity_name', 'product_id', 'position'],
    instagram_click: ['post_id', 'position', 'page_type'],
    blog_card_click: ['article_title', 'section_name', 'position', 'page_type'],
    // 3. Search (search itself is sent by both apps)
    search_open: ['click_location', 'page_type'],
    search_suggestion_click: ['search_term', 'suggestion_text', 'suggestion_type', 'position'],
    search_no_results: ['search_term', 'page_type'],
    // 4. PLP
    view_item_list: { params: ['item_list_id', 'item_list_name', 'items', 'results_count'], ga: false },
    plp_chip_click: ['chip_name', 'collection_name', 'position'],
    sort_apply: ['sort_option', 'previous_sort', 'collection_name'],
    filter_open: ['collection_name', 'active_filter_count'],
    filter_apply: ['filters_applied', 'filter_count', 'collection_name', 'results_count'],
    filter_clear: ['collection_name', 'filter_count'],
    plp_load_more: ['collection_name', 'page_number', 'items_loaded'],
    variant_sheet_open: ['product_id', 'click_location', 'page_type'],
    select_item: ['item_list_id', 'item_list_name', 'items'],
    // 5. PDP (view_item and add_to_cart are sent by both apps)
    product_media_interaction: ['product_id', 'media_type', 'media_index', 'action'],
    variant_select: ['product_id', 'variant_type', 'variant_value', 'variant_availability', 'click_location'],
    size_guide_open: ['product_id', 'product_category', 'click_location'],
    size_guide_whatsapp_click: ['product_id', 'page_type'],
    addon_sheet_open: ['product_id', 'addons_available'],
    addon_select: ['product_id', 'addon_name', 'addon_price', 'action'],
    gift_sleeve_toggle: ['product_id', 'selected', 'price'],
    savings_calculator_open: ['product_id', 'price', 'mined_equivalent_price'],
    offers_view_all: ['product_id', 'offers_count', 'page_type'],
    coupon_copy: ['coupon_code', 'offer_id', 'product_id', 'click_location'],
    pincode_check: ['pincode', 'product_id', 'serviceable', 'delivery_eta'],
    trust_badge_click: ['badge_name', 'product_id', 'page_type'],
    certificate_view: ['product_id', 'certificate_type'],
    material_info_click: ['product_id', 'info_type', 'click_location'],
    expert_help_click: ['product_id', 'help_type', 'page_type'],
    video_call_booked: { params: ['booking_id', 'product_id', 'slot_date', 'slot_time'], meta: 'Schedule' },
    info_expand: ['product_id', 'section_name'],
    recommendation_click: ['rec_section', 'source_product_id', 'clicked_product_id', 'clicked_product_name', 'position'],
    set_item_click: ['source_product_id', 'clicked_product_id', 'position'],
    buy_now_click: ['currency', 'value', 'items'],
    review_interaction: ['product_id', 'action', 'review_count'],
    review_submit: ['product_id', 'rating', 'has_media'],
    // 6. Wishlist
    add_to_wishlist: { params: ['currency', 'value', 'items', 'click_location'], meta: 'AddToWishlist' },
    remove_from_wishlist: ['product_id', 'click_location'],
    view_wishlist: ['items_count', 'page_type'],
    wishlist_tab_select: ['tab_name', 'items_count'],
    signin_prompt_view: ['trigger', 'page_type'],
    // 7. Get your own design
    custom_design_start: ['click_location', 'page_type'],
    // 8. Contact, blog
    contact_click: { params: ['contact_method', 'click_location', 'page_type'], meta: 'Contact' },
    blog_select: ['article_id', 'article_title', 'card_type', 'position', 'click_element'],
    blog_article_view: ['article_title', 'article_category', 'author', 'publish_date'],
    blog_read_progress: ['article_title', 'percent_read'],
    blog_product_click: ['article_title', 'product_id', 'position'],
    // Checkout on GoKwik (see the header comment)
    begin_checkout: { params: ['currency', 'value', 'items', 'click_location'], meta: 'InitiateCheckout' },
  };

  const spec = (name) => {
    const entry = PLAN[name];
    if (!entry) return null;
    return Array.isArray(entry)
      ? { params: entry, ga: true, meta: 'custom' }
      : { ga: true, meta: 'custom', ...entry };
  };

  /* ------------------------------------------------------------- loaders */

  window.dataLayer = window.dataLayer || [];
  const gaId = config.ga4Id || '';
  const pixelId = config.metaPixelId || '';

  if (gaId) {
    window.gtag =
      window.gtag ||
      function gtag() {
        window.dataLayer.push(arguments);
      };
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
    document.head.appendChild(script);
    window.gtag('js', new Date());
    // The Google app owns page_view; this tag only carries the plan's events.
    window.gtag('config', gaId, {
      send_page_view: false,
      ...(config.userId ? { user_id: config.userId } : {}),
    });
  }

  if (pixelId) {
    /* eslint-disable */
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    // Meta's automatic events (button clicks, page metadata) would add events
    // nobody asked for on top of the app's; the plan's events are explicit.
    window.fbq('set', 'autoConfig', false, pixelId);
    window.fbq('init', pixelId);
    // No PageView here - the Meta app sends it.
  }

  /* ---------------------------------------------------- global properties */

  const SESSION_UTM_KEY = 'zinara:utm';
  const isPhone = () => window.matchMedia('(max-width: 749px)').matches;

  /* First-touch UTMs for the session: kept from the landing URL, so a later
     internal page without them does not wipe them. Meta's {{site_source_name}}
     arrives as utm_source and passes straight through. */
  function sessionUtms() {
    let stored = null;
    try {
      stored = JSON.parse(window.sessionStorage.getItem(SESSION_UTM_KEY));
    } catch (error) {
      stored = null;
    }
    if (stored) return stored;
    const query = new URLSearchParams(window.location.search);
    const utms = {
      session_utm_source: query.get('utm_source') || '',
      session_utm_medium: query.get('utm_medium') || '',
      session_utm_campaign: query.get('utm_campaign') || '',
    };
    try {
      window.sessionStorage.setItem(SESSION_UTM_KEY, JSON.stringify(utms));
    } catch (error) {
      // Storage blocked: the UTMs still go out on this page.
    }
    return utms;
  }

  const cart = {
    value: Number(config.cart?.value) || 0,
    count: Number(config.cart?.count) || 0,
    lines: null,
  };

  function wishlistCount() {
    try {
      const list = JSON.parse(window.localStorage.getItem('zinara:wishlist'));
      return Array.isArray(list) ? list.filter((entry) => typeof entry === 'string' && /\D/.test(entry)).length : 0;
    } catch (error) {
      return 0;
    }
  }

  /* The drawer announces every cart change without the cart itself, so it is
     read back. The lines are kept too: begin_checkout is sent while the browser
     is already leaving for checkout, with no time left to ask for the cart. */
  async function refreshCart() {
    try {
      const response = await fetch(`${window.Shopify?.routes?.root || '/'}cart.js`, {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json();
      cart.value = data.total_price / 100;
      cart.count = data.item_count;
      cart.currency = data.currency;
      cart.lines = data.items;
    } catch (error) {
      // Keep the last known values.
    }
  }
  document.addEventListener('cart:updated', refreshCart);
  if (config.beginCheckout && cart.count > 0) refreshCart();

  function globals() {
    return {
      page_type: config.pageType || 'other',
      page_url: window.location.href,
      page_title: document.title,
      logged_in: Boolean(config.loggedIn),
      customer_type: config.customerType || 'new',
      cart_value: cart.value,
      cart_item_count: cart.count,
      wishlist_count: wishlistCount(),
      platform: isPhone() ? 'mobile_web' : 'desktop_web',
      ...sessionUtms(),
      ...(config.userId ? { user_id: config.userId } : {}),
    };
  }

  /* ----------------------------------------------------------------- send */

  const LIMIT = 100; // GA4 caps parameter values at 100 characters.

  function clean(value) {
    if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, LIMIT);
    return value;
  }

  /** Meta reads ecommerce data as content_ids / contents. */
  function metaPayload(params) {
    const payload = { ...params };
    if (Array.isArray(params.items)) {
      payload.content_type = 'product';
      payload.content_ids = params.items.map((item) => item.item_id);
      payload.contents = params.items.map((item) => ({
        id: item.item_id,
        quantity: item.quantity || 1,
        item_price: item.price,
      }));
      payload.num_items = params.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
      delete payload.items;
    }
    return payload;
  }

  function send(name, input = {}) {
    const plan = spec(name);
    if (!plan) {
      console.warn(`[analytics] "${name}" is not in the tracking plan`);
      return;
    }

    const base = globals();
    const params = {};
    plan.params.forEach((key) => {
      let value = input[key];
      if (value === undefined && key in base) value = base[key];
      if (value === undefined && key === 'product_id') value = config.product?.id;
      if (value === undefined && key === 'cart_count') value = cart.count;
      if (value === undefined && key === 'currency') value = config.currency;
      if (value !== undefined && value !== null && value !== '') params[key] = clean(value);
    });
    // Guard the plan asks for: an ecommerce event with no items is noise.
    if (plan.params.includes('items') && (!Array.isArray(params.items) || params.items.length === 0)) return;

    // product_id rides along on items for this file's own use; GA4 items
    // carry only the fields in the plan's Items Array tab.
    if (Array.isArray(params.items)) {
      params.items = params.items.map(({ product_id: omitted, ...item }) => item);
    }
    const payload = { ...base, ...params };
    window.dataLayer.push({ event: name, ...payload });

    if (gaId && plan.ga && typeof window.gtag === 'function') {
      window.gtag('event', name, { ...payload, send_to: gaId });
    }
    if (pixelId && plan.meta && typeof window.fbq === 'function') {
      const metaData = metaPayload(payload);
      if (plan.meta === 'custom') window.fbq('trackCustom', name, metaData);
      else window.fbq('track', plan.meta, metaData);
    }
    if (config.debug) console.info('[analytics]', name, payload);
  }

  window.zinaraTrack = send;
  queued.forEach(([name, params]) => send(name, params));
  queued.length = 0;

  /* ---------------------------------------------------- helpers for markup */

  const toSnake = (key) => key.replace(/([A-Z])/g, '_$1').toLowerCase();

  /** data-analytics-section-name="x" -> { section_name: 'x' } */
  function dataParams(element) {
    const params = {};
    Object.entries(element.dataset).forEach(([key, value]) => {
      if (!key.startsWith('analytics') || key === 'analytics') return;
      const name = toSnake(key.slice(9).replace(/^./, (ch) => ch.toLowerCase()));
      if (value === 'true' || value === 'false') params[name] = value === 'true';
      else if (value !== '' && !Number.isNaN(Number(value)) && /(_count|position|index|price|value|rating|level|number)$/.test(name)) params[name] = Number(value);
      else params[name] = value;
    });
    return params;
  }

  const textOf = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim();

  function hrefOf(element) {
    const link = element.closest('a[href]');
    if (!link) return undefined;
    const href = link.getAttribute('href');
    if (!href || href === '#') return undefined;
    try {
      const url = new URL(href, window.location.href);
      return url.origin === window.location.origin ? url.pathname + url.search : url.href;
    } catch (error) {
      return href;
    }
  }

  /** Product handle from a /products/<handle> link. */
  function handleFromUrl(url) {
    const match = /\/products\/([^/?#]+)/.exec(url || '');
    return match ? decodeURIComponent(match[1]) : undefined;
  }

  window.zinaraAnalytics = { send, dataParams, textOf, hrefOf, handleFromUrl, wishlistCount, cart };

  /* ----------------------------------------- data-analytics click delegation */

  /* Capture phase on document: it runs before any component handler, so a
     handler that stops propagation (carousel drag guards, GoKwik) cannot hide
     the click from tracking. */
  document.addEventListener(
    'click',
    (event) => {
      const element = event.target.closest?.('[data-analytics]');
      if (!element) return;
      // One element may stand for more than one plan event, space-separated
      // (a footer phone link is both footer_link_click and contact_click).
      element.dataset.analytics.split(/\s+/).filter(Boolean).forEach((name) => {
        const params = dataParams(element);
        if (params.destination_url === undefined) params.destination_url = hrefOf(element);
        if (params.cta_text === undefined && spec(name)?.params.includes('cta_text')) {
          params.cta_text = textOf(element);
        }
        send(name, params);
      });
    },
    true,
  );

  /* ------------------------------------------------- accordions (details) */

  /* `toggle` does not bubble, but a capture listener still sees it - and it
     fires however the <details> was opened (GSAP in faq.js, or the browser's
     own toggle when GSAP is missing). Only openings count. */
  document.addEventListener(
    'toggle',
    (event) => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement) || !details.open) return;

      if (details.matches('.faq_wrapper_list_item')) {
        const list = Array.from(document.querySelectorAll('.faq_wrapper_list_item'));
        send('faq_expand', {
          question: textOf(details.querySelector('.faq_wrapper_list_item_summary_question')),
          faq_position: list.indexOf(details) + 1,
        });
      } else if (details.matches('[data-analytics-info]')) {
        send('info_expand', { section_name: details.dataset.analyticsInfo });
      }
    },
    true,
  );

  /* ------------------------------------------------------- page-level events */

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(() => {
    const referrer = document.referrer || '';

    if (config.pageType === 'home') {
      send('homepage_view', { page_title: document.title, page_url: window.location.href, referrer });
    }
    if (config.pageType === '404') {
      send('page_not_found', { page_url: window.location.href, referrer });
    }
    if (config.pageType === 'search' && config.search && Number(config.search.results) === 0) {
      send('search_no_results', { search_term: config.search.terms });
    }
    if (config.article) {
      send('blog_article_view', {
        article_title: config.article.title,
        article_category: config.article.category,
        author: config.article.author,
        publish_date: config.article.published,
      });
    }
    if (Array.isArray(config.itemList?.items) && config.itemList.items.length > 0) {
      send('view_item_list', {
        item_list_id: config.itemList.id,
        item_list_name: config.itemList.name,
        items: config.itemList.items,
        results_count: config.itemList.results,
      });
    }
  });

  /* ---------------------------------------------------------- scroll depth */

  /* 25 / 50 / 75 / 100 % of the page, once each. GA4's own 90% scroll event
     should be switched off in the data stream's enhanced measurement. Blog
     articles also report how far the article body itself was read. */
  onReady(() => {
    const marks = [25, 50, 75, 100];
    const sent = new Set();
    const readMarks = [50, 100];
    const read = new Set();
    const body = config.article ? document.querySelector('[data-article-body]') : null;
    let ticking = false;

    const check = () => {
      ticking = false;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      const percent = scrollable <= 0 ? 100 : Math.round((window.scrollY / scrollable) * 100);
      marks.forEach((mark) => {
        if (percent >= mark && !sent.has(mark)) {
          sent.add(mark);
          send('scroll_depth', { percent_scrolled: mark });
        }
      });

      if (body) {
        const rect = body.getBoundingClientRect();
        const seen = rect.height <= 0 ? 0 : ((window.innerHeight - rect.top) / rect.height) * 100;
        readMarks.forEach((mark) => {
          if (seen >= mark && !read.has(mark)) {
            read.add(mark);
            send('blog_read_progress', { article_title: config.article.title, percent_read: mark });
          }
        });
      }
    };

    window.addEventListener(
      'scroll',
      () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(check);
      },
      { passive: true },
    );
  });

  /* --------------------------------------------------------- impressions */

  /** Calls fn once, the first time element is at least `ratio` visible for `ms`. */
  function onSeen(element, fn, { ratio = 0.5, ms = 0 } = {}) {
    if (!('IntersectionObserver' in window)) return;
    let timer = null;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.intersectionRatio >= ratio) {
            if (timer) return;
            timer = window.setTimeout(() => {
              observer.disconnect();
              fn();
            }, ms);
          } else if (timer) {
            window.clearTimeout(timer);
            timer = null;
          }
        });
      },
      { threshold: [0, ratio] },
    );
    observer.observe(element);
  }

  window.zinaraAnalytics.onSeen = onSeen;

  /* Home sections: once each at >= 50% visible. Home sections are named by
     their key in templates/index.json (shopify-section-template--…__<key>),
     translated to the plan's section_name. A section that holds two of the
     plan's sections (the split promo: custom design + about) marks each half
     with data-analytics-view instead. Sections not in the plan's list (hero,
     USP strips, press logos) are left out - the hero has its own events. */
  const HOME_SECTIONS = {
    'shop-by-category': 'shop_by_category',
    bestsellers: 'bestsellers',
    'know-your-jewellery': 'know_your_jewellery',
    'curated-trends': 'curated_trends',
    'zinara-collections': 'zinara_collections',
    testimonials: 'reviews',
    'occasion-showcase': 'every_occasion',
    gifting: 'gifting',
    'as-seen-on': 'as_seen_on',
    'instagram-community': 'instagram',
    journal: 'journal',
    faq: 'faq',
  };

  /** The plan's section_name for the section an element sits in, if any. */
  function sectionNameOf(element) {
    const section = element?.closest?.('.shopify-section');
    const key = section?.id.split('__').pop();
    return HOME_SECTIONS[key] || key?.replace(/-/g, '_');
  }
  window.zinaraAnalytics.sectionNameOf = sectionNameOf;

  onReady(() => {
    if (config.pageType !== 'home') return;
    const targets = [];
    document.querySelectorAll('.shopify-section[id*="__"]').forEach((section) => {
      const halves = section.querySelectorAll('[data-analytics-view]');
      if (halves.length) {
        halves.forEach((half) => targets.push([half, half.dataset.analyticsView]));
        return;
      }
      const name = HOME_SECTIONS[section.id.split('__').pop()];
      if (name) targets.push([section, name]);
    });
    targets.forEach(([element, name], index) => {
      onSeen(element, () => send('home_section_view', { section_name: name, section_position: index + 1 }));
    });
  });

  // Hero banner: a slide counts as viewed when the banner is >= 50% visible
  // while that slide is the active one, for a full second.
  onReady(() => {
    document.querySelectorAll('hero-banner-slideshow').forEach((banner) => {
      const seen = new Set();
      let visible = false;
      let timer = null;

      const arm = () => {
        window.clearTimeout(timer);
        if (!visible) return;
        const slide = banner.querySelector('[data-banner-id].is-active');
        if (!slide || seen.has(slide.dataset.bannerId)) return;
        timer = window.setTimeout(() => {
          if (!slide.classList.contains('is-active') || !visible) return;
          seen.add(slide.dataset.bannerId);
          send('home_banner_view', {
            banner_id: slide.dataset.bannerId,
            banner_name: slide.dataset.bannerName,
            banner_position: Number(slide.dataset.slideIndex) + 1,
          });
        }, 1000);
      };

      if ('IntersectionObserver' in window) {
        new IntersectionObserver(
          (entries) => {
            visible = entries[0].intersectionRatio >= 0.5;
            arm();
          },
          { threshold: [0, 0.5] },
        ).observe(banner);
      }
      new MutationObserver(arm).observe(banner, { subtree: true, attributeFilter: ['class'] });
    });
  });

  /* ------------------------------------------------------- video progress */

  /** 25 / 50 / 75 / 100 % of a video, once each per page. */
  const videoMarks = new WeakMap();
  function trackVideoProgress(video, params) {
    if (!video || videoMarks.has(video)) return;
    videoMarks.set(video, new Set());
    const report = (mark) => {
      const sent = videoMarks.get(video);
      if (sent.has(mark)) return;
      sent.add(mark);
      send('ugc_video_progress', { ...params(), percent_watched: mark });
    };
    video.addEventListener('timeupdate', () => {
      if (!video.duration) return;
      const percent = (video.currentTime / video.duration) * 100;
      [25, 50, 75].forEach((mark) => {
        if (percent >= mark) report(mark);
      });
    });
    video.addEventListener('ended', () => report(100));
  }

  window.zinaraAnalytics.trackVideoProgress = trackVideoProgress;

  /* -------------------------------------------- GoKwik checkout (see top) */

  /* The click is announced from layout/theme.liquid by a capture listener that
     runs before GoKwik can swallow it; it carries where it came from. */
  /** GA4 items from /cart.js lines. */
  function cartItems(lines) {
    return lines.map((line, index) => ({
      item_id: line.sku || String(line.variant_id),
      item_name: line.product_title,
      item_brand: 'Zinara',
      item_category: line.product_type,
      item_variant: line.variant_title || undefined,
      price: line.final_price / 100,
      discount: line.original_price > line.final_price ? (line.original_price - line.final_price) / 100 : 0,
      quantity: line.quantity,
      index,
    }));
  }

  if (config.beginCheckout) {
    document.addEventListener('zinara:checkout-intent', (event) => {
      // Buy now sends its own begin_checkout with the item it just added.
      if (event.detail?.location === 'buy_now' || !cart.lines?.length) return;
      send('begin_checkout', {
        currency: cart.currency || config.currency,
        value: cart.value,
        items: cartItems(cart.lines),
        click_location: event.detail?.location,
      });
    });
  }
})();
