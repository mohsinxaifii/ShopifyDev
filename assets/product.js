/**
 * Product detail page behaviour. Figma: Desktop / PDP 7930:95962.
 *
 * One custom element owns the page so the seven overlay states, the gallery and
 * the buy form can share a single variant table and a single cart request - the
 * add-ons, the gift sleeve and the paired products all have to land in the same
 * /cart/add.js call, or a shopper who picks three things gets three toasts and
 * three chances for one of them to fail on its own.
 */
(() => {
  const RECENT_KEY = 'zinara:recently-viewed';
  const RECENT_LIMIT = 12;

  /* ------------------------------------------------------------- helpers */

  function readJSON(element) {
    if (!element) return null;
    try {
      return JSON.parse(element.textContent);
    } catch (error) {
      return null;
    }
  }

  function readStore(key) {
    try {
      return JSON.parse(window.localStorage.getItem(key)) || [];
    } catch (error) {
      return [];
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* private mode - the list just doesn't persist */
    }
  }

  /* ------------------------------------------------------------- gallery */

  class ProductGallery extends HTMLElement {
    connectedCallback() {
      this.slides = Array.from(this.querySelectorAll('[data-stage-slide]'));
      this.thumbs = Array.from(this.querySelectorAll('[data-thumb]'));
      this.dots = Array.from(this.querySelectorAll('[data-gallery-dot]'));
      this.index = 0;

      this.thumbs.forEach((thumb) => {
        thumb.addEventListener('click', () => this.show(Number(thumb.dataset.index)));
      });

      this.slides.forEach((slide) => {
        slide.addEventListener('click', () => {
          // A swipe ends in a click too; it should turn the page, not open the lightbox.
          if (this.swiped) return;
          this.dispatchEvent(
            new CustomEvent('gallery:open', { bubbles: true, detail: { index: this.index } }),
          );
        });
      });

      this.setupSwipe();
    }

    /* Phones have dots instead of thumbnails, so the image itself has to page. */
    setupSwipe() {
      const stage = this.querySelector('.pdp_gallery_stage');
      if (!stage || this.slides.length < 2) return;
      let startX = 0;
      let startY = 0;
      stage.addEventListener(
        'touchstart',
        (event) => {
          startX = event.touches[0].clientX;
          startY = event.touches[0].clientY;
          this.swiped = false;
        },
        { passive: true },
      );
      stage.addEventListener(
        'touchend',
        (event) => {
          const dx = event.changedTouches[0].clientX - startX;
          const dy = event.changedTouches[0].clientY - startY;
          if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
          this.swiped = true;
          const last = this.slides.length - 1;
          this.show(dx < 0 ? Math.min(this.index + 1, last) : Math.max(this.index - 1, 0));
          window.setTimeout(() => {
            this.swiped = false;
          }, 400);
        },
        { passive: true },
      );
    }

    show(index) {
      if (index < 0 || index >= this.slides.length) return;
      this.index = index;
      this.slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
      this.thumbs.forEach((thumb, i) => thumb.classList.toggle('is-active', i === index));
      this.dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
      this.thumbs[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  if (!customElements.get('product-gallery'))
    customElements.define('product-gallery', ProductGallery);

  /* ---------------------------------------------------------------- page */

  class ProductPage extends HTMLElement {
    connectedCallback() {
      this.data = readJSON(this.querySelector('[data-pdp-variants]')) || { variants: [] };
      this.gallery = this.querySelector('product-gallery');
      this.form = this.querySelector('.pdp_info_form');
      this.variantInput = this.querySelector('[data-variant-id]');

      this.initSheets();
      this.initOptions();
      this.initLightbox();
      this.initUgc();
      this.initCoupons();
      this.initPincode();
      this.initTabs();
      this.initReviews();
      this.initCart();
      this.recordRecentlyViewed();

      this.classList.add('is-ready');
    }

    /* ------------------------------------------------------------ sheets */

    initSheets() {
      this.sheets = new Map();
      this.querySelectorAll('[data-sheet]').forEach((dialog) => {
        this.sheets.set(dialog.dataset.sheet, dialog);

        dialog.querySelectorAll('[data-sheet-close]').forEach((button) => {
          button.addEventListener('click', () => dialog.close());
        });

        // Clicking the padding around the panel closes it. The dialog element
        // itself is the full-viewport backdrop area, so a click whose target is
        // the dialog (not a descendant) landed outside the panel.
        dialog.addEventListener('click', (event) => {
          if (event.target === dialog) dialog.close();
        });
      });

      this.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-open]');
        if (!trigger || !this.contains(trigger)) return;

        const name = trigger.dataset.open;
        if (name === 'know-jewellery') {
          const details = this.querySelector('#pdp-know-jewellery');
          if (details) {
            details.open = true;
            details.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          return;
        }

        const dialog = this.sheets.get(name);
        if (!dialog) return;
        if (name === 'ugc') this.showUgc(Number(trigger.dataset.index) || 0);
        dialog.showModal();
      });
    }

    openSheet(name) {
      this.sheets.get(name)?.showModal();
    }

    /* ----------------------------------------------------------- options */

    initOptions() {
      this.optionInputs = Array.from(this.querySelectorAll('[data-option-input]'));
      if (this.optionInputs.length === 0) return;

      this.optionInputs.forEach((input) => {
        input.addEventListener('change', () => this.onOptionChange());
      });
      this.syncAvailability();
    }

    selectedOptions() {
      const groups = Array.from(this.querySelectorAll('[data-option-group]'));
      return groups.map(
        (group) => group.querySelector('[data-option-input]:checked')?.value ?? null,
      );
    }

    onOptionChange() {
      const selected = this.selectedOptions();
      const match = this.data.variants.find((variant) =>
        selected.every((value, i) => value === null || variant.options[i] === value),
      );

      this.querySelectorAll('[data-option-readout]').forEach((readout, i) => {
        // Only swatch groups print a readout, and they are always the first of
        // their kind, so the readout index tracks the swatch group order.
        const group = this.querySelectorAll('[data-option-group]')[i];
        const checked = group?.querySelector('[data-option-input]:checked');
        if (checked) readout.textContent = checked.value;
      });

      this.syncAvailability();
      if (!match) return;

      this.variantInput.value = match.id;
      this.updatePrice(match);
      this.updateUrl(match);

      if (match.featuredMediaPosition > 0) this.gallery?.show(match.featuredMediaPosition - 1);

      const addButton = this.querySelector('[data-add-to-cart]');
      const buyButton = this.querySelector('[data-buy-now]');
      const label = this.querySelector('[data-add-label]');
      if (addButton) addButton.disabled = !match.available;
      if (buyButton) buyButton.disabled = !match.available;
      if (label) label.textContent = match.available ? 'Add to cart' : 'Sold out';
    }

    /* Grey out values that no variant can reach alongside the current picks. */
    syncAvailability() {
      const groups = Array.from(this.querySelectorAll('[data-option-group]'));
      const selected = this.selectedOptions();

      groups.forEach((group, position) => {
        group.querySelectorAll('[data-option-input]').forEach((input) => {
          const candidate = selected.slice();
          candidate[position] = input.value;
          input.disabled = !this.data.variants.some(
            (variant) =>
              variant.available &&
              candidate.every((value, i) => value === null || variant.options[i] === value),
          );
        });
      });
    }

    money(text) {
      const symbol = this.data.symbol || '';
      if (!text) return '';
      return text.includes(symbol) ? text : symbol + text;
    }

    updatePrice(variant) {
      const price = this.querySelector('[data-price]');
      const compare = this.querySelector('[data-compare]');
      const save = this.querySelector('[data-save]');
      if (price) price.textContent = this.money(variant.priceText);

      const hasCompare = variant.compareAt && variant.compareAt > variant.price;
      if (compare) {
        compare.hidden = !hasCompare;
        compare.textContent = hasCompare ? this.money(variant.compareText) : '';
      }
      if (save) {
        save.hidden = !hasCompare;
        if (hasCompare) {
          const percent = Math.round(
            ((variant.compareAt - variant.price) / variant.compareAt) * 100,
          );
          save.textContent = `Save ${percent}%`;
        }
      }

      this.querySelectorAll('[data-diff-price], [data-diff-cta-price]').forEach((node) => {
        node.textContent = this.money(variant.priceText);
      });
    }

    updateUrl(variant) {
      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url);
    }

    /* --------------------------------------------------------- lightbox */

    initLightbox() {
      const dialog = this.sheets.get('lightbox');
      if (!dialog) return;

      this.lightboxSlides = Array.from(dialog.querySelectorAll('[data-lightbox-slide]'));
      this.lightboxCurrent = dialog.querySelector('[data-lightbox-current]');
      this.lightboxIndex = 0;

      this.addEventListener('gallery:open', (event) => {
        this.showLightbox(event.detail.index);
        dialog.showModal();
      });

      dialog
        .querySelector('[data-lightbox-prev]')
        ?.addEventListener('click', () => this.stepLightbox(-1));
      dialog
        .querySelector('[data-lightbox-next]')
        ?.addEventListener('click', () => this.stepLightbox(1));

      dialog.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') this.stepLightbox(-1);
        if (event.key === 'ArrowRight') this.stepLightbox(1);
      });
    }

    showLightbox(index) {
      if (!this.lightboxSlides?.length) return;
      const total = this.lightboxSlides.length;
      this.lightboxIndex = ((index % total) + total) % total;
      this.lightboxSlides.forEach((slide, i) =>
        slide.classList.toggle('is-active', i === this.lightboxIndex),
      );
      if (this.lightboxCurrent) this.lightboxCurrent.textContent = String(this.lightboxIndex + 1);
      // Keep the inline gallery on the same frame, so closing the lightbox
      // doesn't jump the shopper back to where they started.
      this.gallery?.show(this.lightboxIndex);
    }

    stepLightbox(direction) {
      this.showLightbox(this.lightboxIndex + direction);
    }

    /* -------------------------------------------------------------- UGC */

    initUgc() {
      const dialog = this.sheets.get('ugc');
      if (!dialog) return;

      this.ugcSlides = Array.from(dialog.querySelectorAll('[data-ugc-slide]'));
      this.ugcIndex = 0;

      dialog
        .querySelector('[data-ugc-prev]')
        ?.addEventListener('click', () => this.showUgc(this.ugcIndex - 1));
      dialog
        .querySelector('[data-ugc-next]')
        ?.addEventListener('click', () => this.showUgc(this.ugcIndex + 1));
      dialog.addEventListener('close', () => {
        this.ugcSlides.forEach((slide) => slide.querySelector('video')?.pause());
      });
    }

    showUgc(index) {
      if (!this.ugcSlides?.length) return;
      const total = this.ugcSlides.length;
      this.ugcIndex = ((index % total) + total) % total;

      const next = (this.ugcIndex + 1) % total;
      const prev = (this.ugcIndex - 1 + total) % total;

      this.ugcSlides.forEach((slide, i) => {
        const isActive = i === this.ugcIndex;
        const isPrev = !isActive && i === prev && total > 1;
        const isNext = !isActive && i === next && total > 1;
        slide.classList.toggle('is-active', isActive);
        slide.classList.toggle('is-prev', isPrev);
        slide.classList.toggle('is-near', isPrev || isNext);

        const video = slide.querySelector('video');
        if (!video) return;

        // Controls belong to the clip being watched; on the flanking stills they
        // are just chrome the shopper cannot meaningfully use.
        video.controls = isActive;

        if (isActive) {
          // Sources are attached on demand so opening the reel doesn't kick off
          // three simultaneous video downloads.
          if (!video.src && slide.dataset.src) video.src = slide.dataset.src;
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    }

    /* ---------------------------------------------------------- coupons */

    initCoupons() {
      this.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-copy-code]');
        if (!button) return;
        try {
          await navigator.clipboard.writeText(button.dataset.copyCode);
          button.classList.add('is-copied');
          setTimeout(() => button.classList.remove('is-copied'), 1600);
        } catch (error) {
          /* clipboard blocked - the code is still readable on screen */
        }
      });
    }

    /* --------------------------------------------------------- pincode */

    initPincode() {
      const button = this.querySelector('[data-pincode-check]');
      const input = this.querySelector('[data-pincode]');
      const result = this.querySelector('[data-pincode-result]');
      if (!button || !input || !result) return;

      button.addEventListener('click', () => {
        const value = input.value.trim();
        result.hidden = false;
        if (!/^\d{6}$/.test(value)) {
          result.textContent = 'Please enter a valid 6-digit pincode.';
          return;
        }
        const days = Number(this.dataset.deliveryDays) || 5;
        const eta = new Date();
        eta.setDate(eta.getDate() + days);
        result.textContent = `Delivers by ${eta.toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
        })} to ${value}.`;
      });
    }

    /* ------------------------------------------------------------- tabs */

    initTabs() {
      const root = this.querySelector('[data-related]');
      if (!root) return;

      const tabs = Array.from(root.querySelectorAll('[data-tab]'));
      const panels = Array.from(root.querySelectorAll('[data-panel]'));

      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          tabs.forEach((other) => {
            const isActive = other === tab;
            other.classList.toggle('is-active', isActive);
            other.setAttribute('aria-selected', String(isActive));
          });
          panels.forEach((panel) => {
            panel.hidden = panel.dataset.panel !== tab.dataset.tab;
          });
        });
      });

      this.renderRecentlyViewed(root);
    }

    recordRecentlyViewed() {
      const card = this.data.card;
      if (!card?.handle) return;

      const price = this.querySelector('[data-price]')?.textContent.trim() || '';
      const entry = { ...card, price };
      const list = readStore(RECENT_KEY).filter((item) => item.handle !== card.handle);
      list.unshift(entry);
      writeStore(RECENT_KEY, list.slice(0, RECENT_LIMIT));
    }

    renderRecentlyViewed(root) {
      const track = root.querySelector('[data-recent-track]');
      const empty = root.querySelector('[data-recent-empty]');
      if (!track) return;

      // Written before this runs, so the current product is always first - drop
      // it rather than offering the shopper the page they are already on.
      const items = readStore(RECENT_KEY).filter(
        (item) => item.handle !== this.dataset.productHandle,
      );

      if (items.length === 0) return;
      if (empty) empty.hidden = true;

      track.innerHTML = '';
      items.forEach((item) => {
        const card = document.createElement('a');
        card.className = 'product-card product-card--grid';
        card.href = item.url;
        card.innerHTML = `
          <span class="product-card_media">
            ${item.image ? `<img class="product-card_media_image" src="${item.image}" alt="" loading="lazy">` : ''}
          </span>
          <span class="product-card_info">
            <span class="product-card_info_price">
              <span class="product-card_info_price_current">${item.price || ''}</span>
            </span>
            <span class="product-card_info_title"></span>
          </span>`;
        card.querySelector('.product-card_info_title').textContent = item.title;
        track.appendChild(card);
      });
    }

    /* ---------------------------------------------------------- reviews */

    initReviews() {
      const button = this.querySelector('[data-reviews-more]');
      if (!button) return;
      button.addEventListener('click', () => {
        this.querySelectorAll('[data-review-extra]').forEach((item) => {
          item.hidden = false;
        });
        button.remove();
      });
    }

    /* ------------------------------------------------------------- cart */

    initCart() {
      this.form?.addEventListener('submit', (event) => {
        event.preventDefault();
        this.addToCart(this.buildItems(), { trigger: this.querySelector('[data-add-to-cart]') });
      });

      const buyNow = this.querySelector('[data-buy-now]');
      buyNow?.addEventListener('click', async () => {
        const ok = await this.addToCart(this.buildItems(), { trigger: buyNow });
        if (ok) window.location.href = `${window.Shopify?.routes?.root || '/'}checkout`;
      });

      // Add-ons and paired products are selections, not immediate adds, so the
      // toggles only flip state here and the ids are collected at submit time.
      this.addEventListener('click', (event) => {
        const toggle = event.target.closest('[data-addon-toggle], [data-pair-toggle]');
        if (!toggle) return;
        toggle.setAttribute(
          'aria-pressed',
          toggle.getAttribute('aria-pressed') === 'true' ? 'false' : 'true',
        );
      });

      this.querySelector('[data-addons-done]')?.addEventListener('click', () => {
        this.sheets.get('addons')?.close();
      });

      const pairAdd = this.querySelector('[data-pair-add]');
      pairAdd?.addEventListener('click', () => {
        const items = Array.from(
          this.querySelectorAll('[data-pair-toggle][aria-pressed="true"]'),
        ).map((button) => ({
          id: Number(button.closest('[data-pair-item]').dataset.variantId),
          quantity: 1,
        }));
        // Nothing ticked reads as "I want the whole set".
        const all = Array.from(this.querySelectorAll('[data-pair-item]')).map((item) => ({
          id: Number(item.dataset.variantId),
          quantity: 1,
        }));
        this.addToCart(items.length > 0 ? items : all, { trigger: pairAdd });
      });

      const diffAdd = this.querySelector('[data-diff-add]');
      diffAdd?.addEventListener('click', async () => {
        // Close only once the line is in, so the drawer cannot open behind a
        // sheet that is still on screen.
        const ok = await this.addToCart(this.buildItems(), { trigger: diffAdd });
        if (ok) this.sheets.get('price-difference')?.close();
      });

      this.addEventListener('click', (event) => {
        const button = event.target.closest('[data-add-single]');
        if (!button) return;
        this.addToCart([{ id: Number(button.dataset.variantId), quantity: 1 }], {
          trigger: button,
        });
      });
    }

    buildItems() {
      const items = [{ id: Number(this.variantInput.value), quantity: 1 }];

      const gift = this.querySelector('[data-gift-toggle]');
      if (gift?.checked) items.push({ id: Number(gift.dataset.variantId), quantity: 1 });

      this.querySelectorAll('[data-addon-toggle][aria-pressed="true"]').forEach((button) => {
        items.push({ id: Number(button.dataset.variantId), quantity: 1 });
      });

      return items.filter((item) => Number.isFinite(item.id) && item.id > 0);
    }

    /**
     * Thin wrapper over the shared cart, so the PDP's several buy paths get the
     * same pending -> added -> drawer sequence as every other add in the theme.
     */
    async addToCart(items, { trigger } = {}) {
      if (!window.zinaraCart) return false;
      return window.zinaraCart.add(items, trigger || this.querySelector('[data-add-to-cart]'));
    }
  }

  if (!customElements.get('product-page')) customElements.define('product-page', ProductPage);
})();
