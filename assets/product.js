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
      this.initDragScroll();
      this.recordRecentlyViewed();

      this.classList.add('is-ready');
    }

    /* ------------------------------------------------------- drag to scroll */

    /* The sideways rails hide their scrollbars, so a mouse had no way to move
       them. Touch already swipes natively (with snap points in CSS); this adds
       click-and-drag for mice. A drag swallows the click that ends it, so the
       copy-code buttons inside the offer cards don't fire on release. */
    initDragScroll() {
      this.querySelectorAll('.pdp_offers_rail, .pdp_headline_tags, .pdp_pair_card_items').forEach(
        (rail) => {
          let startX = 0;
          let startScroll = 0;
          let pointerId = null;
          let dragged = false;

          rail.addEventListener('pointerdown', (event) => {
            if (event.pointerType !== 'mouse' || event.button !== 0) return;
            if (rail.scrollWidth <= rail.clientWidth) return;
            pointerId = event.pointerId;
            startX = event.clientX;
            startScroll = rail.scrollLeft;
            dragged = false;
          });

          rail.addEventListener('pointermove', (event) => {
            if (event.pointerId !== pointerId) return;
            const dx = event.clientX - startX;
            if (!dragged && Math.abs(dx) < 4) return;
            if (!dragged) {
              dragged = true;
              rail.setPointerCapture(pointerId);
              rail.classList.add('is-dragging');
            }
            rail.scrollLeft = startScroll - dx;
          });

          const end = (event) => {
            if (event.pointerId !== pointerId) return;
            pointerId = null;
            if (!dragged) return;
            rail.classList.remove('is-dragging');
            // Let snapping settle the rail on the nearest card.
            rail.scrollBy({ left: 0, behavior: 'smooth' });
          };
          rail.addEventListener('pointerup', end);
          rail.addEventListener('pointercancel', end);

          rail.addEventListener(
            'click',
            (event) => {
              if (!dragged) return;
              event.preventDefault();
              event.stopPropagation();
              dragged = false;
            },
            true,
          );
          rail.addEventListener('dragstart', (event) => event.preventDefault());
        },
      );
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

        if (dialog.hasAttribute('data-sheet-expand')) this.initExpandingSheet(dialog);
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

    /**
     * A phone bottom sheet that opens at its designed height (capped at 768px)
     * and, when the shopper scrolls it, first rises until its top is 15px from
     * the top of the screen and only then scrolls its own content. Pulling
     * down from the top of the content lowers it again; a sheet let go
     * part-way finishes the move in the direction it was going.
     *
     * A touch is either the sheet's or the content's for its whole length: one
     * that starts by moving the sheet carries straight on into the content once
     * the sheet is up (scrolled by hand, since the browser was told not to),
     * so a single swipe reads as one motion.
     */
    initExpandingSheet(dialog) {
      const panel = dialog.querySelector('.pdp-sheet_panel');
      const body = dialog.querySelector('.pdp-sheet_panel_body');
      if (!panel || !body) return;

      const phone = window.matchMedia('(max-width: 749px)');
      const TOP_GAP = 15;
      let base = 0; // height the sheet opened at
      let height = 0; // height it is at now
      let max = 0; // height with its top 15px from the top of the screen

      // Measured on the first touch rather than on open, so images that load
      // after the sheet appears are counted. The ceiling is re-read on every
      // gesture for the same reason.
      const measure = () => {
        if (!base) {
          base = panel.getBoundingClientRect().height;
          height = base;
        }
        // Everything the content needs, but never past 15px from the top.
        const natural = panel.scrollHeight - body.clientHeight + body.scrollHeight;
        max = Math.max(base, Math.min(dialog.clientHeight - TOP_GAP, natural));
      };

      const setHeight = (value, settle = false) => {
        height = Math.min(max, Math.max(base, value));
        panel.classList.toggle('is-settling', settle);
        panel.style.maxHeight = `${height}px`;
      };

      // Move the sheet by `delta` (positive = up). Returns what it could not
      // absorb, for the content to scroll instead.
      const moveSheet = (delta) => {
        const before = height;
        setHeight(height + delta);
        return delta - (height - before);
      };

      dialog.addEventListener('close', () => {
        panel.classList.remove('is-settling');
        panel.style.removeProperty('max-height');
        body.scrollTop = 0;
        base = 0;
      });

      /* ------------------------------------------------------------ touch */

      let lastY = null;
      let lastDelta = 0;
      let owned = null; // null = undecided, true = we drive it, false = browser

      body.addEventListener(
        'touchstart',
        (event) => {
          if (!phone.matches || event.touches.length !== 1) return;
          measure();
          lastY = event.touches[0].clientY;
          owned = null;
          panel.classList.remove('is-settling');
        },
        { passive: true },
      );

      body.addEventListener(
        'touchmove',
        (event) => {
          if (lastY === null) return;
          const y = event.touches[0].clientY;
          const delta = lastY - y; // positive: finger moving up, content scrolling down
          lastY = y;
          if (delta === 0) return;
          lastDelta = delta;

          if (owned === null) {
            const canRise = delta > 0 && height < max;
            const canLower = delta < 0 && height > base && body.scrollTop <= 0;
            owned = canRise || canLower;
          }
          if (!owned || !event.cancelable) return;

          event.preventDefault();
          const rest = moveSheet(delta);
          // Up and still swiping: the rest of the swipe scrolls the content.
          if (rest > 0) body.scrollTop += rest;
        },
        { passive: false },
      );

      const release = () => {
        if (lastY === null) return;
        lastY = null;
        if (!owned) return;
        owned = null;
        // A sheet left part-way carries on the way it was going, so even a
        // short swipe up takes it to the top rather than dropping back.
        if (height > base && height < max) setHeight(lastDelta > 0 ? max : base, true);
      };
      body.addEventListener('touchend', release);
      body.addEventListener('touchcancel', release);

      /* ------------------------------------------------------ wheel / pad */

      body.addEventListener(
        'wheel',
        (event) => {
          if (!phone.matches || !event.deltaY) return;
          measure();
          const rising = event.deltaY > 0 && height < max;
          const lowering = event.deltaY < 0 && height > base && body.scrollTop <= 0;
          if (!rising && !lowering) return;
          event.preventDefault();
          panel.classList.remove('is-settling');
          const rest = moveSheet(event.deltaY);
          if (rest > 0) body.scrollTop += rest;
        },
        { passive: false },
      );
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
      this.updateShipTime(match);

      if (match.featuredMediaPosition > 0) this.gallery?.show(match.featuredMediaPosition - 1);

      const addButton = this.querySelector('[data-add-to-cart]');
      const buyButton = this.querySelector('[data-buy-now]');
      const label = this.querySelector('[data-add-label]');
      if (addButton) addButton.disabled = !match.available;
      if (buyButton) buyButton.disabled = !match.available;
      if (label) label.textContent = match.available ? 'Add to cart' : 'Sold out';
    }

    /* In stock ships in 24 hours; otherwise the product's own ship-time badge,
       or no pill at all when it has none. */
    updateShipTime(variant) {
      const pill = this.querySelector('[data-ship-time]');
      if (!pill) return;
      const text = variant.inStock ? pill.dataset.shipFast : pill.dataset.shipDefault;
      pill.textContent = text || '';
      pill.hidden = !text;
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
        // Phones stack every image vertically, so open on the one tapped.
        // Offsets rather than scrollIntoView: the opening tween is still scaling
        // the stack, and offsets ignore transforms. 64px clears the sticky close.
        if (window.matchMedia('(max-width: 749px)').matches) {
          let top = 0;
          for (let el = this.lightboxSlides[this.lightboxIndex]; el && el !== dialog; el = el.offsetParent) {
            top += el.offsetTop;
          }
          dialog.scrollTop = Math.max(0, top - 64);
        }
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
        if (toggle.matches('[data-addon-toggle]')) this.toggleAddon(toggle);
        else this.togglePair(toggle);
      });

      this.querySelector('[data-addons-done]')?.addEventListener('click', () => {
        this.sheets.get('addons')?.close();
      });

      this.initPair();

      const diffAdd = this.querySelector('[data-diff-add]');
      diffAdd?.addEventListener('click', async () => {
        // Close only once the line is in, so the drawer cannot open behind a
        // sheet that is still on screen.
        const ok = await this.addToCart(this.buildItems(), { trigger: diffAdd });
        if (ok) this.sheets.get('price-difference')?.close();
      });

      // Curated-trends cards: anything with options is picked in the drawer,
      // which then adds it itself.
      this.addEventListener('click', (event) => {
        const button = event.target.closest('[data-add-single]');
        if (!button) return;
        const drawer = document.querySelector('variant-drawer');
        if (Number(button.dataset.variantCount) > 1 && button.dataset.productUrl && drawer) {
          drawer.open(button.dataset.productUrl, button);
          return;
        }
        this.addToCart([{ id: Number(button.dataset.variantId), quantity: 1 }], {
          trigger: button,
        });
      });
    }

    /* --------------------------------------------------- pair beautifully */

    /**
     * "Pair beautifully with" works off what is actually in the cart, read on
     * load and after every cart change (the drawer fires cart:updated), so a
     * piece already in the bag - added here, as part of the set, or removed
     * again in the drawer - is always shown as it really is.
     *
     * - A card's bag icon selects it; a piece already in the cart shows a
     *   tick and cannot be selected again.
     * - The button adds the selection, or with nothing selected, every piece
     *   not yet in the cart. Each goes in as its first available variant - no
     *   picker. Once all of them are in, it reads "Set added to cart" and stays
     *   disabled.
     */
    initPair() {
      const section = this.querySelector('[data-pair]');
      const button = section?.querySelector('[data-pair-add]');
      if (!section || !button) return;
      const label = button.querySelector('[data-add-label]') || button;
      const items = Array.from(section.querySelectorAll('[data-pair-item]'));
      const toggleOf = (item) => item.querySelector('[data-pair-toggle]');
      let inCart = new Set();

      // A piece with nothing available has no variant to add, so it is never
      // part of the set (and its bag icon stays disabled).
      const available = (item) => Number(item.dataset.variantId) > 0;
      const pendingItems = () => items.filter((item) => available(item) && !inCart.has(item.dataset.productId));
      const selectedItems = () =>
        pendingItems().filter((item) => toggleOf(item)?.getAttribute('aria-pressed') === 'true');

      this.syncPair = () => {
        items.forEach((item) => {
          const added = inCart.has(item.dataset.productId);
          const toggle = toggleOf(item);
          item.classList.toggle('is-in-cart', added);
          if (!toggle) return;
          toggle.disabled = added || !available(item);
          if (added) toggle.setAttribute('aria-pressed', 'false');
          const title = item.querySelector('.pdp-mini_info_title')?.textContent.trim() || '';
          toggle.setAttribute('aria-label', added ? `${title} is in your cart` : `Select ${title}`);
        });

        const pending = pendingItems();
        const selected = selectedItems();
        let text;
        if (pending.length === 0) text = 'Set added to cart';
        else if (selected.length > 0)
          text = `Add ${selected.length} item${selected.length > 1 ? 's' : ''} to cart`;
        else if (pending.length < items.filter(available).length) text = `Add remaining ${pending.length} to cart`;
        else text = 'Add set to cart';

        // The shared cart restores this text after its "Added" flash, so it has
        // to follow the state as well as the visible label does.
        label.dataset.restLabel = text;
        const flashing = button.classList.contains('is-loading') || button.classList.contains('is-added');
        if (!flashing) label.textContent = text;
        button.disabled = pending.length === 0 || button.classList.contains('is-loading');
        button.classList.toggle('is-complete', pending.length === 0);
      };

      const readCart = async () => {
        try {
          const response = await fetch(`${window.Shopify?.routes?.root || '/'}cart.js`, {
            headers: { Accept: 'application/json' },
          });
          const cart = await response.json();
          inCart = new Set((cart.items || []).map((line) => String(line.product_id)));
        } catch (error) {
          /* keep the last known state */
        }
        this.syncPair();
      };

      button.addEventListener('click', async () => {
        const chosen = selectedItems();
        const pieces = chosen.length > 0 ? chosen : pendingItems();

        const lines = pieces.map((item) => ({ id: Number(item.dataset.variantId), quantity: 1 }));
        if (lines.length === 0) return;
        const ok = await this.addToCart(lines, { trigger: button });
        if (ok) {
          items.forEach((item) => toggleOf(item)?.setAttribute('aria-pressed', 'false'));
          await readCart();
        }
        this.syncPair();
        // Re-check once the "Added" flash has been restored to the rest label.
        window.setTimeout(() => this.syncPair(), 1900);
      });

      document.addEventListener('cart:updated', readCart);
      readCart();
    }

    /* Selecting a paired piece just marks it; the set button sends its first
       available variant. */
    togglePair(toggle) {
      const pressed = toggle.getAttribute('aria-pressed') === 'true';
      toggle.setAttribute('aria-pressed', String(!pressed));
      this.syncPair?.();
    }

    /* Ticking an add-on that has options asks for the variant first (the
       drawer opens over the add-ons sheet); backing out leaves it unticked.
       The chosen variant is what Done / Add to cart later sends. */
    async toggleAddon(toggle) {
      const label = toggle.closest('.pdp-addons_grid_card')?.querySelector('[data-addon-variant]');
      if (toggle.getAttribute('aria-pressed') === 'true') {
        toggle.setAttribute('aria-pressed', 'false');
        if (label) label.hidden = true;
        this.syncAddonHero();
        return;
      }

      if (Number(toggle.dataset.variantCount) > 1 && window.zinaraVariants) {
        const chosen = await window.zinaraVariants.choose(toggle.dataset.productUrl);
        if (!chosen) return;
        toggle.dataset.variantId = chosen.id;
        if (label) {
          label.textContent = chosen.title;
          label.hidden = false;
        }
      }
      toggle.setAttribute('aria-pressed', 'true');
      this.syncAddonHero();
    }

    /* The add-ons hero follows the ticked set. Each preview image lists the
       add-on product ids it shows; an exact match wins, otherwise the preview
       covering the most ticked add-ons without showing an unticked one, and
       with nothing matching the default hero (tagged "default"). */
    syncAddonHero() {
      const hero = this.querySelector('[data-addon-hero]');
      if (!hero) return;
      const images = Array.from(hero.querySelectorAll('[data-addon-preview]'));
      const selected = new Set(
        Array.from(this.querySelectorAll('[data-addon-toggle][aria-pressed="true"]')).map(
          (button) => button.dataset.productId,
        ),
      );

      let best = images.find((img) => img.dataset.addonPreview === 'default') || null;
      let bestSize = 0;
      images.forEach((img) => {
        if (img.dataset.addonPreview === 'default') return;
        const ids = (img.dataset.addonPreview || '').split(',').filter(Boolean);
        if (!ids.length || !ids.every((id) => selected.has(id))) return;
        if (ids.length > bestSize) {
          best = img;
          bestSize = ids.length;
        }
      });

      images.forEach((img) => img.classList.toggle('is-active', img === best));
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
