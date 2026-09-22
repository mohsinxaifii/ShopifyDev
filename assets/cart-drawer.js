/**
 * The cart drawer, and the single cart API the rest of the theme adds through.
 *
 * Before this there were three separate `/cart/add.js` implementations - the
 * PDP, the PLP's variant drawer and the product card - each with its own idea of
 * what "added" looked like and none of them touching the header count. They all
 * delegate to `window.zinaraCart.add()` now, so one change to the sequence
 * (pending -> added -> drawer) applies everywhere.
 *
 * Contents come from the Section Rendering API rather than /cart.js: line
 * pricing and this shop's symbol-less money format are Liquid concerns, and
 * rebuilding them in JS is how the two drift apart.
 */
(() => {
  const root = () => window.Shopify?.routes?.root || '/';

  class ZinaraCart {
    constructor() {
      this.dialog = document.querySelector('[data-cart-drawer]');
      this.content = this.dialog?.querySelector('[data-cart-content]');
      this.busy = false;
      if (this.dialog) this.bind();
      this.bindGlobal();
    }

    /* ------------------------------------------------------------- wiring */

    bind() {
      this.dialog
        .querySelectorAll('[data-cart-close]')
        .forEach((button) => button.addEventListener('click', () => this.close()));

      // The dialog element is the backdrop area; a click that lands on it
      // rather than on a descendant happened outside the panel.
      this.dialog.addEventListener('click', (event) => {
        if (event.target === this.dialog) this.close();
      });

      // Quantity and removal are delegated: the contents are replaced wholesale
      // on every change, so per-element listeners would not survive a refresh.
      this.dialog.addEventListener('click', (event) => {
        const line = event.target.closest('[data-cart-line]');
        if (!line) return;

        if (event.target.closest('[data-cart-remove]')) {
          return this.change(line.dataset.lineKey, 0);
        }

        const input = line.querySelector('[data-qty-input]');
        if (!input) return;
        const current = Number(input.value) || 0;

        if (event.target.closest('[data-qty-up]'))
          return this.change(line.dataset.lineKey, current + 1);
        if (event.target.closest('[data-qty-down]'))
          return this.change(line.dataset.lineKey, current - 1);
      });

      this.dialog.addEventListener('change', (event) => {
        const input = event.target.closest('[data-qty-input]');
        if (!input) return;
        const line = input.closest('[data-cart-line]');
        this.change(line.dataset.lineKey, Math.max(0, Number(input.value) || 0));
      });
    }

    bindGlobal() {
      // The cart icon opens the drawer instead of navigating. The link keeps its
      // href so it still works with the script blocked, and middle-click or
      // ctrl-click keep opening the page in a new tab as a shopper expects.
      document.addEventListener('click', (event) => {
        const link = event.target.closest('a[href$="/cart"], a[href*="/cart?"]');
        if (!link || !this.dialog) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        this.open();
      });
    }

    /* -------------------------------------------------------------- state */

    open() {
      if (!this.dialog || this.dialog.open) return;
      this.dialog.showModal();
    }

    close() {
      if (this.dialog?.open) this.dialog.close();
    }

    /* --------------------------------------------------------- operations */

    /**
     * @param {Array<{id:number, quantity:number}>} items
     * @param {HTMLElement} [trigger] button to run the pending/added states on
     * @returns {Promise<boolean>} whether the cart actually changed
     */
    async add(items, trigger) {
      const lines = (items || []).filter((i) => Number.isFinite(i.id) && i.id > 0);
      if (lines.length === 0 || this.busy) return false;
      this.busy = true;
      this.setTriggerState(trigger, 'pending');

      try {
        const response = await fetch(`${root()}cart/add.js`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items: lines }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.description || `${response.status}`);
        }

        // Only after the cart has confirmed: refresh, then show the result.
        await this.refresh();
        this.setTriggerState(trigger, 'added');
        this.open();
        return true;
      } catch (error) {
        this.setTriggerState(trigger, 'failed');
        return false;
      } finally {
        this.busy = false;
      }
    }

    async change(key, quantity) {
      if (this.busy || !key) return;
      this.busy = true;
      this.dialog?.classList.add('is-busy');
      try {
        const response = await fetch(`${root()}cart/change.js`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ id: key, quantity: Math.max(0, quantity) }),
        });
        if (!response.ok) throw new Error(`${response.status}`);
        await this.refresh();
      } catch (error) {
        // A failed change leaves the drawer showing the server's last known
        // state rather than an optimistic one that never landed.
        await this.refresh();
      } finally {
        this.dialog?.classList.remove('is-busy');
        this.busy = false;
      }
    }

    /** Re-render the drawer and the header count from the server's cart. */
    async refresh() {
      try {
        const response = await fetch(`${root()}?section_id=cart-drawer`);
        if (!response.ok) throw new Error(`${response.status}`);
        const markup = await response.text();
        const doc = new DOMParser().parseFromString(markup, 'text/html');
        const fresh = doc.querySelector('[data-cart-body]');
        if (fresh && this.content) {
          const footer = doc.querySelector('[data-cart-footer]');
          this.content.replaceChildren(fresh, ...(footer ? [footer] : []));
          this.syncCount(Number(fresh.dataset.cartCount) || 0);
        }
      } catch (error) {
        /* the add itself succeeded; the drawer just shows a stale line */
      }
      document.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));
    }

    syncCount(count) {
      const badge = document.querySelector('.header_wrapper_actions_cart_badge');
      const title = document.querySelector('[data-cart-title-count]');
      if (title) title.textContent = count;

      if (badge) {
        badge.textContent = count;
        badge.hidden = count === 0;
        if (count > 0 && window.gsap) {
          window.gsap.fromTo(
            badge,
            { scale: 0.5 },
            { scale: 1, duration: 0.4, ease: 'back.out(2.5)' },
          );
        }
        return;
      }

      // The badge is only printed when the cart has something in it, so the
      // first add has to create it rather than update it.
      const link = document.querySelector('.header_wrapper_actions a[href$="/cart"]');
      if (link && count > 0) {
        const created = document.createElement('span');
        created.className = 'header_wrapper_actions_cart_badge';
        created.textContent = count;
        link.appendChild(created);
      }
    }

    /* ------------------------------------------------------------ trigger */

    /**
     * Buttons across the theme label themselves differently, so the original
     * text is stashed on first use and restored once the confirmation has been
     * on screen long enough to read.
     */
    setTriggerState(trigger, state) {
      if (!trigger) return;
      const label = trigger.querySelector('[data-add-label], [data-add-single-label]') || trigger;
      if (label.dataset.restLabel === undefined) label.dataset.restLabel = label.textContent.trim();

      clearTimeout(trigger.dataset.motionTimer);
      trigger.classList.toggle('is-loading', state === 'pending');
      trigger.classList.toggle('is-added', state === 'added');
      trigger.classList.toggle('is-failed', state === 'failed');
      trigger.disabled = state === 'pending';
      if (state === 'pending') trigger.setAttribute('aria-busy', 'true');
      else trigger.removeAttribute('aria-busy');

      const copy = {
        pending: window.themeStrings?.adding || 'Adding…',
        added: trigger.dataset.addedLabel || window.themeStrings?.added || 'Added to cart',
        failed: window.themeStrings?.failed || 'Could not add',
      };
      label.textContent = copy[state] || label.dataset.restLabel;

      if (state === 'pending') return;
      const timer = setTimeout(() => {
        label.textContent = label.dataset.restLabel;
        trigger.classList.remove('is-added', 'is-failed');
      }, 1800);
      trigger.dataset.motionTimer = timer;
    }
  }

  function boot() {
    window.zinaraCart = new ZinaraCart();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
