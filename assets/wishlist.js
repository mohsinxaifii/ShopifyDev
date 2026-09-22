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
 */
(() => {
  const STORAGE_KEY = 'zinara:wishlist';

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

  function write(handles) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(handles));
    } catch (error) {
      /* localStorage unavailable (private mode, quota) - the wishlist just
         won't persist past this page. */
    }
    document.dispatchEvent(new CustomEvent('wishlist:change', { detail: { handles } }));
  }

  function keyOf(button) {
    return button.dataset.productHandle || '';
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
    if (index === -1) handles.push(handle);
    else handles.splice(index, 1);

    write(handles);
  }

  function syncAll(root = document) {
    root.querySelectorAll('[data-wishlist-toggle]').forEach(syncButton);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-wishlist-toggle]');
    if (!button) return;
    event.preventDefault();
    toggle(button);
  });

  /* One listener keeps every heart on the page in step with the store, so the
     PDP heart and a card's heart for the same product never disagree. */
  document.addEventListener('wishlist:change', () => syncAll());

  document.addEventListener('DOMContentLoaded', () => syncAll());
  if (window.Shopify && window.Shopify.designMode) {
    document.addEventListener('shopify:section:load', (event) => syncAll(event.target));
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
        return;
      }

      this.show('[data-wishlist-filters]', true);

      /* Fetched in parallel, then written in the stored order so the grid does
         not reshuffle itself by whichever request happened to land first. */
      const root = this.dataset.rootUrl || '/';
      const results = await Promise.all(
        handles.map(async (handle) => {
          try {
            const response = await fetch(`${root}products/${handle}?section_id=wishlist-card`);
            if (!response.ok) return null;
            return await response.text();
          } catch (error) {
            return null;
          }
        }),
      );

      /* A handle that no longer resolves - product deleted or unpublished - is
         dropped from the store rather than left to fail on every visit. */
      const kept = handles.filter((handle, index) => results[index]);
      if (kept.length !== handles.length) write(kept);

      this.grid.innerHTML = results.filter(Boolean).join('');
      this.querySelector('[data-skeleton]')?.remove();
      this.show('[data-wishlist-grid]', true);
      this.show('[data-wishlist-empty]', kept.length === 0);
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
