/*
 * The wishlist.
 *
 * Two jobs in one file, because both sides have to agree on the stored list:
 *
 * 1. The heart toggles, which appear on every product card and on the PDP.
 *    These run on every page, from layout/theme.liquid.
 * 2. The wishlist page itself (Figma 7930:94300), which has nothing to render
 *    server-side - the list lives in this browser, so <wishlist-page> fetches
 *    each card and fills its grid.
 *
 * Products are keyed by handle rather than id: a handle can address the product
 * URL the cards are fetched from, and a numeric id cannot. Anything stored
 * under the old id-based scheme is dropped on read instead of being fetched and
 * 404ing forever.
 *
 * Account sync: when a customer is logged in and the theme has a wishlist
 * endpoint, layout/theme.liquid sets window.zinaraWishlistAccount and the list
 * is also kept on their customer record by the zinara-wishlist server app, so
 * it follows them between devices. The first time an account is seen in this
 * browser, whatever was saved here as a guest is merged in; after that the
 * account's list wins, so removing an item on one device removes it
 * everywhere - unless a save from this browser failed, in which case this
 * browser's list is the newest and is saved on the next visit. Without an
 * account the wishlist stays in this browser only.
 *
 * Signing in first: adding to the wishlist needs a signed-in customer. A
 * signed-out shopper's tap stores the product as "pending" and sends them to
 * sign in with return_to set to the page they were on; back on that page, the
 * pending product is added for them, so they never have to tap the heart again.
 * Removing never needs an account, so an older guest list can still be tidied.
 */
(() => {
  const STORAGE_KEY = 'zinara:wishlist';
  const SYNC_KEY = 'zinara:wishlist:account';
  const PENDING_KEY = 'zinara:wishlist:pending';
  /* Long enough to sign in (including an emailed code), short enough that a
     sign-in much later does not add something the shopper has forgotten. */
  const PENDING_MS = 30 * 60 * 1000;
  const account = window.zinaraWishlistAccount || null;
  const isDesignMode = Boolean(window.Shopify && window.Shopify.designMode);
  const signedIn = window.zinaraCustomer === true;

  /* ------------------------------------------------------------------ store */

  function read() {
    let stored;
    try {
      stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return [];
    }
    if (!Array.isArray(stored)) return [];

    /* Handles always carry a non-digit; bare numbers are leftovers from the
       earlier id-based list and cannot be resolved to a URL. */
    return stored.filter((entry) => typeof entry === 'string' && /\D/.test(entry));
  }

  function write(handles, { push = true } = {}) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(handles));
    } catch (error) {
      /* localStorage unavailable (private mode, quota) - the wishlist just
         won't persist past this page. */
    }
    document.dispatchEvent(new CustomEvent('wishlist:change', { detail: { handles } }));
    if (push) schedulePush();
  }

  /* ------------------------------------------------------------- account */

  function syncState() {
    try {
      return JSON.parse(window.localStorage.getItem(SYNC_KEY)) || {};
    } catch (error) {
      return {};
    }
  }

  function setSyncState(state) {
    try {
      window.localStorage.setItem(SYNC_KEY, JSON.stringify(state));
    } catch (error) {
      /* nothing to do - the next visit merges instead of replacing */
    }
  }

  let pushTimer = null;

  /* Saves are batched: a burst of heart taps becomes one request. A save that
     fails leaves the list marked dirty, so the next visit saves this browser's
     list instead of letting the older account copy overwrite it. */
  function schedulePush() {
    if (!account) return;
    setSyncState({ ...syncState(), customer: String(account.customer), dirty: true });
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 600);
  }

  async function push() {
    try {
      const response = await fetch(account.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ customer: account.customer, ts: account.ts, sig: account.sig, handles: read() }),
        keepalive: true,
      });
      if (!response.ok) throw new Error(`${response.status}`);
      setSyncState({ customer: String(account.customer), dirty: false });
    } catch (error) {
      /* stays dirty; merged on the next page view */
    }
  }

  async function pull() {
    if (!account) return;
    let remote;
    try {
      const query = new URLSearchParams({ customer: account.customer, ts: account.ts, sig: account.sig });
      const response = await fetch(`${account.endpoint}?${query}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      remote = (await response.json()).handles;
    } catch (error) {
      return;
    }
    if (!Array.isArray(remote)) return;

    const local = read();
    const state = syncState();
    const firstTimeHere = state.customer !== String(account.customer);

    /* First login in this browser: the guest list and the account's are
       merged (this browser's order, then anything only the account has).
       An unsaved change from last time: this browser's list is the newest, so
       it is kept as it is and saved. Otherwise the account's list wins. */
    let next = remote;
    if (firstTimeHere) next = [...local, ...remote.filter((handle) => !local.includes(handle))];
    else if (state.dirty) next = local;

    if (JSON.stringify(next) !== JSON.stringify(local)) {
      write(next, { push: false });
      document.dispatchEvent(new CustomEvent('wishlist:synced'));
    }
    if (JSON.stringify(next) !== JSON.stringify(remote)) {
      schedulePush();
    } else {
      setSyncState({ customer: String(account.customer), dirty: false });
    }
  }

  function keyOf(button) {
    return button.dataset.productHandle || '';
  }

  /* ------------------------------------------------------------- sign in */

  /* --------------------------------------------------------- analytics */

  /* The GA4 item for a heart: its product card carries one; the PDP's heart
     is the page's own product. */
  function analyticsItem(button) {
    const card = button.closest('[data-analytics-item]');
    if (card) {
      try {
        return JSON.parse(card.dataset.analyticsItem);
      } catch (error) {
        return null;
      }
    }
    return window.zinaraAnalyticsConfig?.product?.item || null;
  }

  function clickLocation(button) {
    if (!button.closest('.product-card')) return 'pdp';
    const page = window.zinaraAnalyticsConfig?.pageType;
    return {
      collection: 'plp_card',
      search: 'search_card',
      wishlist: 'wishlist',
      home: 'home_card',
      product: 'pdp_recommendations',
    }[page] || `${page || 'page'}_card`;
  }

  function trackAdd(item, location) {
    if (!item) return;
    window.zinaraTrack?.('add_to_wishlist', {
      currency: window.zinaraAnalyticsConfig?.currency,
      value: item.price,
      items: [item],
      click_location: location,
    });
  }

  function setPending(handle, extra = {}) {
    try {
      window.localStorage.setItem(PENDING_KEY, JSON.stringify({ handle, at: Date.now(), ...extra }));
      return true;
    } catch (error) {
      return false;
    }
  }

  function takePending() {
    let pending = null;
    try {
      pending = JSON.parse(window.localStorage.getItem(PENDING_KEY));
      window.localStorage.removeItem(PENDING_KEY);
    } catch (error) {
      return null;
    }
    if (!pending || typeof pending.handle !== 'string' || !/\D/.test(pending.handle)) return null;
    if (!(Date.now() - pending.at < PENDING_MS)) return null;
    return pending;
  }

  /* New customer accounts send the shopper back to `return_to`, which has to be
     a relative URL - so the page they were on, without the origin. */
  function signInUrl() {
    const here = `${window.location.pathname}${window.location.search}`;
    /* With KwikPass (GoKwik's phone-OTP login, layout/theme.liquid) the login
       opens over this same page from ?kp_login, and kp_redirect brings the
       shopper back here once they are in. */
    if (window.zinaraAnalyticsConfig?.kwikpass) {
      const url = new URL(window.location.href);
      url.searchParams.set('kp_login', 'true');
      url.searchParams.set('kp_redirect', here);
      return `${url.pathname}${url.search}`;
    }
    return `/customer_authentication/login?return_to=${encodeURIComponent(here)}`;
  }

  /* Runs once the account's list has been pulled, so the added product lands
     on top of it instead of being overwritten by it. */
  function addPending() {
    if (!signedIn) return;
    const pending = takePending();
    if (!pending) return;
    const handles = read();
    if (handles.includes(pending.handle)) return;
    write([...handles, pending.handle]);
    // Counted now that it really is in the wishlist, with where the heart was.
    trackAdd(pending.item, pending.location);
  }

  /* ---------------------------------------------------------------- toggles */

  function syncButton(button) {
    const handle = keyOf(button);
    const isActive = handle !== '' && read().includes(handle);
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));

    /* The markup ships the "add" label, so it is cached on the first sync and
       the button can be swapped back and forth from then on. */
    if (!button.dataset.addLabel) {
      button.dataset.addLabel = button.getAttribute('aria-label') || '';
    }
    const removeLabel = window.themeStrings?.wishlistRemove;
    button.setAttribute(
      'aria-label',
      isActive && removeLabel ? removeLabel : button.dataset.addLabel,
    );
  }

  function toggle(button) {
    const handle = keyOf(button);
    if (handle === '') return;

    const handles = read();
    const index = handles.indexOf(handle);

    /* The theme editor has no customer session, so it keeps the plain toggle. */
    if (index === -1 && !signedIn && !isDesignMode) {
      if (setPending(handle, { item: analyticsItem(button), location: clickLocation(button) })) {
        window.zinaraTrack?.('signin_prompt_view', { trigger: 'wishlist_heart' });
        window.location.href = signInUrl();
        return;
      }
      /* Storage is blocked, so the product could not survive the round trip -
         fall back to keeping it in this browser. */
    }

    if (index === -1) handles.push(handle);
    else handles.splice(index, 1);

    write(handles);

    if (index === -1) {
      trackAdd(analyticsItem(button), clickLocation(button));
    } else {
      window.zinaraTrack?.('remove_from_wishlist', {
        product_id: button.dataset.productId,
        click_location: clickLocation(button),
      });
    }
  }

  function syncAll(root = document) {
    root.querySelectorAll('[data-wishlist-toggle]').forEach(syncButton);
  }

  /* The header heart's bubble (sections/header.liquid), styled like the cart's.
     Hidden at zero, capped at 99+ so it never outgrows the icon. */
  function syncBadges() {
    const count = read().length;
    document.querySelectorAll('[data-wishlist-badge]').forEach((badge) => {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0;
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-wishlist-toggle]');
    if (!button) return;
    event.preventDefault();
    toggle(button);
  });

  /* One listener keeps every heart on the page in step with the store, so the
     PDP heart and a card's heart for the same product never disagree. */
  document.addEventListener('wishlist:change', () => {
    syncAll();
    syncBadges();
  });

  /* Cards are also added after load - collection filters and "Load more", the
     quick-add drawer, the wishlist page - and their hearts ship unpressed, so
     each new one is set from the store as it arrives. */
  function watchNewHearts() {
    new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          if (node.matches('[data-wishlist-toggle]')) syncButton(node);
          node.querySelectorAll('[data-wishlist-toggle]').forEach(syncButton);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* Another tab changed the list (or finished signing in): follow it. */
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    syncAll();
    syncBadges();
  });

  document.addEventListener('DOMContentLoaded', async () => {
    syncAll();
    syncBadges();
    watchNewHearts();
    await pull();
    addPending();
  });
  if (isDesignMode) {
    document.addEventListener('shopify:section:load', (event) => {
      syncAll(event.target);
      syncBadges();
    });
  }

  /* ---------------------------------------------------------------- the page */

  class WishlistPage extends HTMLElement {
    connectedCallback() {
      this.filter = '';

      this.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-wishlist-filter]');
        if (chip) return this.onFilter(chip);
      });

      /* Un-hearting a card on this page should take it out of the grid, not
         just grey out its heart. */
      document.addEventListener('wishlist:change', () => this.prune());

      /* The account's list arrived and differs from this browser's: draw the
         grid again from the merged list. */
      document.addEventListener('wishlist:synced', () => this.render());

      this.render();
    }

    get grid() {
      return this.querySelector('[data-wishlist-grid]');
    }

    show(selector, visible) {
      const el = this.querySelector(selector);
      if (el) el.hidden = !visible;
    }

    async render() {
      const handles = read();

      if (handles.length === 0) {
        this.querySelector('[data-skeleton]')?.remove();
        this.show('[data-wishlist-empty]', true);
        this.setCount(0);
        if (!this.viewTracked) {
          this.viewTracked = true;
          window.zinaraTrack?.('view_wishlist', { items_count: 0 });
        }
        return;
      }

      this.show('[data-wishlist-filters]', true);

      /* Fetched in parallel, then written in the stored order so the grid does
         not reshuffle itself by whichever request happened to land first. */
      const root = this.dataset.rootUrl || '/';
      const results = await Promise.all(
        handles.map(async (handle) => {
          try {
            const response = await fetch(`${root}products/${encodeURIComponent(handle)}?section_id=wishlist-card`);
            if (response.status === 404) return { gone: true };
            if (!response.ok) return { html: '' };
            return { html: (await response.text()).trim() };
          } catch (error) {
            return { html: '' };
          }
        }),
      );

      /* Only a handle that no longer resolves - product deleted or unpublished,
         a 404 - is dropped from the store. A request that merely failed (offline,
         a server hiccup) keeps its product for the next visit. */
      const kept = handles.filter((handle, index) => !results[index].gone);
      if (kept.length !== handles.length) write(kept);

      /* The Section Rendering API wraps each card in a .shopify-section div,
         which critical.css lays out as a page-width grid with side margins -
         inside a grid cell that squeezed the card into a narrow middle column.
         Only the card item itself goes into the grid. */
      const template = document.createElement('template');
      template.innerHTML = results.map((result) => result.html || '').join('');
      const cards = Array.from(template.content.querySelectorAll('[data-wishlist-item]'));
      this.grid.replaceChildren(...cards);
      if (!this.viewTracked) {
        this.viewTracked = true;
        window.zinaraTrack?.('view_wishlist', { items_count: cards.length });
      }
      this.querySelector('[data-skeleton]')?.remove();
      this.show('[data-wishlist-grid]', true);
      this.show('[data-wishlist-empty]', cards.length === 0);
      syncAll(this);
      this.apply();
    }

    onFilter(chip) {
      const value = chip.dataset.wishlistFilter || '';
      /* Clicking the active chip clears it, so the full list is always one tap
         away without a separate "all" chip. */
      this.filter = this.filter === value ? '' : value;

      this.querySelectorAll('[data-wishlist-filter]').forEach((other) => {
        const isActive = other.dataset.wishlistFilter === this.filter && this.filter !== '';
        other.classList.toggle('is-active', isActive);
        other.setAttribute('aria-pressed', String(isActive));
      });

      this.apply();
      if (this.filter) {
        window.zinaraTrack?.('wishlist_tab_select', {
          tab_name: chip.querySelector('.wishlist_wrapper_filters_item_label')?.textContent.trim() || value,
          items_count: Array.from(this.querySelectorAll('[data-wishlist-item]')).filter((item) => !item.hidden).length,
        });
      }
    }

    /* Matched on whole words, not substrings: "rings" is a substring of
       "earrings", so a plain `includes` would have the Rings chip pulling in
       every pair of earrings. A multi-word chip value has no single token to
       compare against, so those fall back to a substring test. */
    matches(item) {
      if (this.filter === '') return true;

      const haystack = `${item.dataset.type || ''},${item.dataset.tags || ''}`;
      if (this.filter.includes(' ')) return haystack.includes(this.filter);

      return haystack.split(/[\s,]+/).includes(this.filter);
    }

    apply() {
      const items = Array.from(this.querySelectorAll('[data-wishlist-item]'));
      let visible = 0;

      items.forEach((item) => {
        const match = this.matches(item);
        item.hidden = !match;
        if (match) visible += 1;
      });

      this.setCount(visible);
      this.show('[data-wishlist-nomatch]', items.length > 0 && visible === 0);
    }

    /* Removes any card whose product has just been un-hearted. */
    prune() {
      const handles = read();
      let removed = false;

      this.querySelectorAll('[data-wishlist-item]').forEach((item) => {
        if (!handles.includes(item.dataset.handle)) {
          item.remove();
          removed = true;
        }
      });

      if (!removed) return;

      const left = this.querySelectorAll('[data-wishlist-item]').length;
      this.show('[data-wishlist-empty]', left === 0);
      this.show('[data-wishlist-grid]', left > 0);
      this.apply();
    }

    setCount(count) {
      const el = this.querySelector('[data-wishlist-count]');
      if (!el) return;

      const template =
        count === 1 ? window.themeStrings?.wishlistCountOne : window.themeStrings?.wishlistCount;
      if (!template) {
        el.hidden = true;
        return;
      }

      el.textContent = template.replace('__COUNT__', String(count));
      el.hidden = count === 0;
    }
  }

  if (!window.customElements.get('wishlist-page')) {
    window.customElements.define('wishlist-page', WishlistPage);
  }
})();
