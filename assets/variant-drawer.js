/**
 * The variant picker - a bottom sheet on phones, a side drawer on desktop. It is
 * rendered once by the layout, and every add-to-cart for a product with more
 * than one variant goes through it, so nothing is ever added as "whatever the
 * first variant happens to be":
 *
 * - open(url, trigger)  - pick, then Done adds the variant to the cart
 * - choose(url)         - pick, then Done resolves with the variant (no add);
 *                         used where several items are added together
 * - window.zinaraVariants.pick(...) wraps choose() and skips the picker for
 *   products that only have one variant.
 *
 * Opened from inside a modal sheet (add-ons, the UGC lightbox), the picker moves
 * itself into that dialog for as long as it is open: everything outside the
 * top-most modal is inert, so it could not be used from where it lives.
 *
 * Contents are fetched per product through the Section Rendering API rather
 * than built here, because swatches, money formatting and image sizing all
 * live in Liquid and are absent from the /products/x.js payload.
 */
(() => {
  class VariantDrawer extends HTMLElement {
    connectedCallback() {
      this.panel = this.querySelector('.variant-drawer_panel');
      this.content = this.querySelector('[data-drawer-content]');
      this.done = this.querySelector('[data-drawer-done]');

      this.addEventListener('click', (event) => {
        if (event.target.closest('[data-drawer-close]')) return this.close();
        if (event.target.closest('[data-drawer-done]')) return this.confirm();
        // Off to the product page: let the link navigate, but close as we go so
        // coming Back doesn't land on a page still locked under the picker.
        // A modified click opens a new tab, where this page stays put.
        if (event.target.closest('[data-pdp-link]')) {
          if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)) this.close();
        }
      });

      this.addEventListener('change', (event) => {
        if (!event.target.closest('[data-option-input]')) return;
        this.syncSelection();
        this.trackVariantSelect(event.target);
      });

      this.onKeydown = (event) => {
        if (event.key === 'Escape' && !this.hidden) this.close();
      };
      document.addEventListener('keydown', this.onKeydown);
    }

    disconnectedCallback() {
      document.removeEventListener('keydown', this.onKeydown);
    }

    /* -------------------------------------------------------------- open */

    async open(productUrl, trigger) {
      this.mode = 'add';
      return this.show(productUrl, trigger);
    }

    /* Resolves with the chosen variant ({ id, title, ... }) or null if closed. */
    choose(productUrl) {
      this.settleChoice(null);
      this.mode = 'choose';
      return new Promise((resolve) => {
        this.resolveChoice = resolve;
        this.show(productUrl, null);
      });
    }

    settleChoice(value) {
      const resolve = this.resolveChoice;
      this.resolveChoice = null;
      resolve?.(value);
    }

    /* The drawer is a popover (snippets/variant-drawer.liquid): shown, it sits
       in the browser's top layer, above everything on the page whatever its
       z-index. Inside an open modal dialog (hostInOpenDialog, which runs first)
       it is a descendant of that dialog, so it stays usable, and being shown
       after it, it stacks above it. Browsers without popovers keep the plain
       fixed positioning. */
    setTopLayer(on) {
      if (typeof this.showPopover !== 'function') return;
      const showing = this.matches(':popover-open');
      try {
        if (on && !showing) this.showPopover();
        else if (!on && showing) this.hidePopover();
      } catch (error) {
        // Already in the requested state.
      }
    }

    /* Into the top-most open modal dialog, if there is one; see the header. */
    hostInOpenDialog() {
      const dialogs = Array.from(document.querySelectorAll('dialog[open]'));
      const host = dialogs.reverse().find((dialog) => dialog.matches(':modal'));
      if (!this.homeParent) this.homeParent = this.parentElement;
      if (host && this.parentElement !== host) host.append(this);
      else if (!host && this.parentElement !== this.homeParent) this.homeParent.append(this);
    }

    async show(productUrl, trigger) {
      clearTimeout(this.closeTimer);
      this.hostInOpenDialog();
      this.trigger = trigger;
      this.opener = document.activeElement;
      this.hidden = false;
      this.setTopLayer(true);
      // Restored on close rather than cleared: over a sheet, the page under it
      // must stay locked.
      this.previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      // Let the element paint hidden-to-shown before the transition starts.
      requestAnimationFrame(() => this.classList.add('is-open'));

      this.content.setAttribute('aria-busy', 'true');
      try {
        const url = `${productUrl}${productUrl.includes('?') ? '&' : '?'}section_id=variant-drawer`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status}`);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const body = doc.querySelector('[data-drawer-body]');
        if (!body) throw new Error('no drawer body in response');

        this.content.replaceChildren(body);
        this.readVariantData();
        this.syncSelection();
        window.zinaraTrack?.('variant_sheet_open', {
          product_id: this.data?.productId,
          click_location: this.clickLocation(),
        });
        this.panel.querySelector('[data-option-input]')?.focus();
      } catch (error) {
        console.error('[variant-drawer] could not load product', error);
        this.close();
        // Picking was the point, so fall back to the product page to pick there.
        window.location.href = productUrl;
      } finally {
        this.content.removeAttribute('aria-busy');
      }
    }

    close() {
      this.settleChoice(null);
      this.classList.remove('is-open');
      document.documentElement.style.overflow = this.previousOverflow || '';
      const finish = () => {
        this.setTopLayer(false);
        this.hidden = true;
        this.content.replaceChildren();
        if (this.homeParent && this.parentElement !== this.homeParent) this.homeParent.append(this);
      };
      // Wait out the panel's own exit transition - the side drawer's on desktop,
      // the bottom sheet's on phones - which reduced motion already shrinks to 0.
      // Kept so a reopen straight after (the next piece of a set) can cancel it -
      // otherwise this would hide the new picker as soon as it appeared.
      const exitMs = parseFloat(getComputedStyle(this.panel).transitionDuration) * 1000 || 0;
      clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(finish, exitMs);
      this.opener?.focus?.();
    }

    /* --------------------------------------------------------- selection */

    readVariantData() {
      const node = this.querySelector('[data-variant-data]');
      try {
        this.data = JSON.parse(node?.textContent || '{}');
      } catch {
        this.data = { variants: [] };
      }
    }

    selectedOptions() {
      return Array.from(this.querySelectorAll('[data-option-group]')).map((group) => {
        const checked = group.querySelector('[data-option-input]:checked');
        return checked ? checked.value : null;
      });
    }

    matchingVariant() {
      const chosen = this.selectedOptions();
      if (chosen.some((value) => value === null)) return null;
      return (this.data?.variants || []).find((variant) =>
        variant.options.every((option, index) => option === chosen[index]),
      );
    }

    syncSelection() {
      // Keep the "Color: Gold" readout in step with the chosen swatch.
      this.querySelectorAll('[data-option-group]').forEach((group) => {
        const readout = group.querySelector('[data-option-readout]');
        const checked = group.querySelector('[data-option-input]:checked');
        if (readout && checked) readout.textContent = checked.value;
      });

      const variant = this.matchingVariant();
      this.variant = variant;
      if (this.done) this.done.disabled = !variant || !variant.available;

      // The product links open the page on the variant being picked here.
      const card = this.querySelector('[data-pdp-url]');
      if (card) {
        const href = variant ? `${card.dataset.pdpUrl}?variant=${variant.id}` : card.dataset.pdpUrl;
        card.querySelectorAll('[data-pdp-link]').forEach((link) => link.setAttribute('href', href));
      }
    }

    /* --------------------------------------------------------- analytics */

    /* Where the picker was opened from: a [data-analytics-location] around the
       button that opened it, else the kind of page (plp, search, wishlist…). */
    clickLocation() {
      const marked = this.trigger?.closest?.('[data-analytics-location]')?.dataset.analyticsLocation;
      if (marked) return marked;
      if (this.mode === 'choose') return 'pdp_set';
      const page = window.zinaraAnalyticsConfig?.pageType;
      return { collection: 'plp_variant_sheet', search: 'search_variant_sheet' }[page] || `${page || 'page'}_variant_sheet`;
    }

    trackVariantSelect(input) {
      const group = input.closest('[data-option-group]');
      // Is anything available with this value, given the other options picked?
      const index = Array.from(this.querySelectorAll('[data-option-group]')).indexOf(group);
      const chosen = this.selectedOptions();
      const available = (this.data?.variants || []).some(
        (variant) =>
          variant.available &&
          variant.options.every((option, i) => (i === index ? option === input.value : chosen[i] === null || option === chosen[i])),
      );
      window.zinaraTrack?.('variant_select', {
        product_id: this.data?.productId,
        variant_type: group?.dataset.optionName,
        variant_value: input.value,
        variant_availability: available ? 'available' : 'sold_out',
        click_location: 'plp_variant_sheet',
      });
    }

    /* ----------------------------------------------------------- confirm */

    async confirm() {
      if (!this.variant) return;

      if (this.mode === 'choose') {
        const chosen = { ...this.variant, productTitle: this.data?.productTitle };
        this.settleChoice(chosen);
        this.close();
        return;
      }

      this.done.disabled = true;

      // The shared cart owns the request, the button's pending/added states, the
      // header count and opening the drawer; this only has to close itself once
      // the line is actually in.
      const added = await window.zinaraCart?.add(
        [{ id: this.variant.id, quantity: 1 }],
        this.trigger,
      );

      if (added) this.close();
      else this.done.disabled = false;
    }
  }

  if (!customElements.get('variant-drawer')) customElements.define('variant-drawer', VariantDrawer);

  const drawer = () => document.querySelector('variant-drawer');

  /**
   * The variant id to add for a product: straight through when it has only one
   * variant, otherwise whatever the shopper picks (null if they back out).
   */
  window.zinaraVariants = {
    async pick({ productUrl, variantCount, variantId }) {
      if (Number(variantCount) <= 1 || !productUrl || !drawer()) return Number(variantId) || null;
      const chosen = await drawer().choose(productUrl);
      return chosen ? chosen.id : null;
    },
    choose(productUrl) {
      return drawer()?.choose(productUrl) ?? Promise.resolve(null);
    },
  };

  /**
   * Every product card's Add to cart, on every page - collection, search,
   * wishlist, carousels, the product page's "You may also like". Captured at the
   * document so it runs before the card's own link navigates or any section
   * script adds the card's default variant.
   */
  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest('.product-card [data-add-to-cart]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;

      const productUrl =
        button.dataset.productUrl || button.closest('.product-card')?.getAttribute('href');
      if (Number(button.dataset.variantCount) > 1 && productUrl && drawer()) {
        drawer().open(productUrl, button);
        return;
      }
      window.zinaraCart?.add([{ id: Number(button.dataset.variantId), quantity: 1 }], button);
    },
    true,
  );
})();
