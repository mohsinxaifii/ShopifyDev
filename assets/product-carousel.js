/* Wrapped so the class binding stays local: several sections each tag this
   file, and a top-level `class ProductCarousel` would be re-declared on every
   extra copy and throw before it could run. */
(() => {
  class ProductCarousel extends HTMLElement {
    connectedCallback() {
      this.tabs = Array.from(this.querySelectorAll('.product-carousel_wrapper_controls_tabs_tab'));
      this.panels = Array.from(this.querySelectorAll('.product-carousel_wrapper_stage_panel'));
      this.prevButton = this.querySelector('.product-carousel_wrapper_stage_prev');
      this.nextButton = this.querySelector('.product-carousel_wrapper_stage_next');
      this.dotsContainer = this.querySelector('[data-dots]');
      this.viewAllLinks = Array.from(this.querySelectorAll('[data-view-all-link]'));
      this.activeIndex = 0;

      this.tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => this.selectTab(index));
      });
      this.prevButton?.addEventListener('click', () => this.scrollByPage(-1));
      this.nextButton?.addEventListener('click', () => this.scrollByPage(1));

      // Bind every panel, not just the one open at start: switching tabs swaps
      // the track, and a listener left on the old one stops updating the dots.
      this.panels.forEach((panel) => {
        panel
          .querySelector('.product-carousel_wrapper_stage_panel_track')
          ?.addEventListener('scroll', () => this.updateActiveDot(), { passive: true });
      });

      this.buildDots();

      // Rebuild on real size changes, not just window resize: connectedCallback
      // can run before the section stylesheet has applied, and a track measured
      // then looks like it fits on one page, so no dots would appear at all.
      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(() => this.scheduleRebuild());
        if (this.activePanel) this.resizeObserver.observe(this.activePanel);
      } else {
        window.addEventListener('resize', () => this.buildDots());
      }
    }

    disconnectedCallback() {
      this.resizeObserver?.disconnect();
      if (this.rebuildFrame) cancelAnimationFrame(this.rebuildFrame);
    }

    scheduleRebuild() {
      if (this.rebuildFrame) cancelAnimationFrame(this.rebuildFrame);
      this.rebuildFrame = requestAnimationFrame(() => {
        this.rebuildFrame = null;
        this.buildDots();
      });
    }

    get activePanel() {
      return this.panels[this.activeIndex]?.querySelector(
        '.product-carousel_wrapper_stage_panel_track',
      );
    }

    selectTab(index) {
      if (index === this.activeIndex) return;
      this.activeIndex = index;

      this.tabs.forEach((tab, i) => {
        tab.classList.toggle('is-active', i === index);
        tab.setAttribute('aria-selected', String(i === index));
      });
      this.panels.forEach((panel, i) => {
        panel.classList.toggle('is-active', i === index);
        panel.toggleAttribute('hidden', i !== index);
      });

      const url = this.tabs[index]?.dataset.collectionUrl;
      if (url) {
        this.viewAllLinks.forEach((link) => {
          link.href = url;
        });
      }

      this.buildDots();
    }

    scrollByPage(direction) {
      const track = this.activePanel;
      if (!track) return;

      const maxScroll = track.scrollWidth - track.clientWidth;
      if (maxScroll <= 0) return;

      // Advance by whole cards so every move lands on a snap point.
      const step = window.carouselScroll.step(track);
      const distance =
        step > 0 ? Math.max(1, Math.floor(track.clientWidth / step)) * step : track.clientWidth;

      const current = track.scrollLeft;
      const target = current + distance * direction;

      // Clamp before wrapping. Jumping straight back to 0 the moment a page
      // overshoots leaves the last stretch of cards unreachable.
      let destination;
      if (direction > 0) {
        destination = current >= maxScroll - 1 ? 0 : Math.min(target, maxScroll);
      } else {
        destination = current <= 1 ? maxScroll : Math.max(target, 0);
      }

      window.carouselScroll.to(track, destination);
    }

    buildDots() {
      const track = this.activePanel;
      if (!track || !this.dotsContainer) return;

      const pageWidth = track.clientWidth;
      const pageCount = pageWidth > 0 ? Math.ceil(track.scrollWidth / pageWidth) : 1;

      this.dotsContainer.innerHTML = '';
      if (pageCount <= 1) return;

      for (let i = 0; i < pageCount; i += 1) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'product-carousel_wrapper_dots_dot';
        if (i === 0) dot.classList.add('is-active');
        dot.setAttribute('aria-label', `Go to page ${i + 1}`);
        dot.addEventListener('click', () => {
          const maxScroll = track.scrollWidth - track.clientWidth;
          window.carouselScroll.to(track, (i / (pageCount - 1)) * maxScroll);
        });
        this.dotsContainer.appendChild(dot);
      }

      this.updateActiveDot();
    }

    updateActiveDot() {
      const track = this.activePanel;
      if (!track || !this.dotsContainer) return;
      const dots = Array.from(this.dotsContainer.children);
      if (dots.length === 0) return;

      // Spread the dots over the distance the track can actually travel, so the
      // last dot lights up at the end of the scroll rather than a page beyond it.
      const maxScroll = track.scrollWidth - track.clientWidth;
      const progress = maxScroll > 0 ? track.scrollLeft / maxScroll : 0;
      const current = Math.round(progress * (dots.length - 1));
      dots.forEach((dot, i) => dot.classList.toggle('is-active', i === current));
    }
  }

  if (!customElements.get('product-carousel'))
    customElements.define('product-carousel', ProductCarousel);
})();
