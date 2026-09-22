/* Wrapped so the class binding stays local: several sections each tag this
   file, and a top-level `class ScrollCarousel` would be re-declared on every
   extra copy and throw before it could run. */
(() => {
  class ScrollCarousel extends HTMLElement {
    connectedCallback() {
      this.track = this.querySelector('[data-track]');
      this.prevButtons = Array.from(this.querySelectorAll('[data-prev]'));
      this.nextButtons = Array.from(this.querySelectorAll('[data-next]'));
      this.dotsContainer = this.querySelector('[data-dots]');
      if (!this.track) return;

      this.loop = this.hasAttribute('loop');

      this.prevButtons.forEach((button) =>
        button.addEventListener('click', () => this.scrollByPage(-1)),
      );
      this.nextButtons.forEach((button) =>
        button.addEventListener('click', () => this.scrollByPage(1)),
      );

      if (this.loop) this.buildLoop();
      this.buildDots();

      this.track.addEventListener(
        'scroll',
        () => {
          this.updateActiveDot();
          this.scheduleRecentre();
        },
        { passive: true },
      );

      // Rebuild on real size changes, not just window resize: connectedCallback can
      // run before the section stylesheet has applied, and a track measured then
      // looks like it fits on one page, so the dots would never appear at all.
      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(() => this.scheduleRebuild());
        this.resizeObserver.observe(this.track);
        const first = this.track.firstElementChild;
        if (first) this.resizeObserver.observe(first);
      } else {
        window.addEventListener('resize', () => this.buildDots());
      }
    }

    disconnectedCallback() {
      this.resizeObserver?.disconnect();
      if (this.rebuildFrame) cancelAnimationFrame(this.rebuildFrame);
      if (this.recentreTimer) clearTimeout(this.recentreTimer);
    }

    /* Coalesce the observer's bursts into one rebuild per frame. */
    scheduleRebuild() {
      if (this.rebuildFrame) cancelAnimationFrame(this.rebuildFrame);
      this.rebuildFrame = requestAnimationFrame(() => {
        this.rebuildFrame = null;
        this.buildDots();
        this.alignToCurrentCard();
      });
    }

    /* Re-park on an exact card boundary once sizes settle. The initial park runs
       before fonts and images land, so its card step can be slightly stale, and
       snapping hides the discrepancy until the first animation releases it. */
    alignToCurrentCard() {
      if (!this.loop) return;
      this.jumpToIndex(this.nearestIndex());
      this.normaliseIndex();
    }

    /* ------------------------------------------------------------ geometry */

    cardStep() {
      return window.carouselScroll.step(this.track);
    }

    /* Exact scroll offset that aligns child `index` with the start of the track.
       Read from real layout rather than multiplying a measured step, so it lands
       precisely on the browser's own snap point and never drifts. */
    scrollOffsetOf(index) {
      const child = this.track.children[index];
      if (!child) return this.track.scrollLeft;

      // Tracks that bleed into the page margin pad their content back in, and
      // that padding is part of every child's offset - so discount it, or the
      // first card parks against the viewport edge instead of the content edge.
      const padStart = parseFloat(getComputedStyle(this.track).paddingInlineStart) || 0;

      return (
        this.track.scrollLeft +
        child.getBoundingClientRect().left -
        this.track.getBoundingClientRect().left -
        this.track.clientLeft -
        padStart
      );
    }

    /* Index of the card currently sitting at the start of the track. */
    nearestIndex() {
      const trackLeft = this.track.getBoundingClientRect().left + this.track.clientLeft;
      let best = 0;
      let bestDistance = Infinity;
      Array.from(this.track.children).forEach((child, i) => {
        const distance = Math.abs(child.getBoundingClientRect().left - trackLeft);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      });
      return best;
    }

    /* ---------------------------------------------------------------- loop */

    /* One copy of the card set on each side, so the track can keep travelling in
       either direction; the scroll position is quietly moved back into the middle
       copy whenever it leaves, which is invisible because the sets are identical. */
    buildLoop() {
      this.originals = Array.from(this.track.children);
      if (this.originals.length < 2) {
        this.loop = false;
        return;
      }

      const before = document.createDocumentFragment();
      const after = document.createDocumentFragment();
      this.originals.forEach((item) => {
        before.appendChild(this.cloneItem(item));
        after.appendChild(this.cloneItem(item));
      });
      this.track.insertBefore(before, this.track.firstChild);
      this.track.appendChild(after);

      this.index = this.originals.length;
      requestAnimationFrame(() => this.jumpToIndex(this.index));
    }

    cloneItem(item) {
      const clone = item.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.removeAttribute('id');
      clone.removeAttribute('data-shopify-editor-block');
      if (clone.tagName === 'A' || clone.tagName === 'BUTTON') clone.tabIndex = -1;
      clone.querySelectorAll('a, button, input, select, textarea').forEach((el) => {
        el.tabIndex = -1;
      });
      return clone;
    }

    jumpToIndex(index) {
      this.index = index;
      const left = this.scrollOffsetOf(index);
      if (Math.abs(this.track.scrollLeft - left) >= 0.5) this.track.scrollLeft = left;
    }

    /* Move back into the middle copy. The copies are identical, so shifting a
       whole set changes nothing on screen. */
    normaliseIndex() {
      if (!this.loop) return;
      const total = this.originals.length;
      if (this.index >= total * 2) this.jumpToIndex(this.index - total);
      else if (this.index < total) this.jumpToIndex(this.index + total);
    }

    /* Only correct once the scroll has settled, so an in-flight smooth scroll is
       never cut short mid-animation. */
    scheduleRecentre() {
      if (!this.loop) return;
      if (this.recentreTimer) clearTimeout(this.recentreTimer);
      this.recentreTimer = setTimeout(() => {
        this.index = this.nearestIndex();
        this.normaliseIndex();
      }, 120);
    }

    /* ------------------------------------------------------------ movement */

    scrollByPage(direction) {
      const step = this.cardStep();

      if (this.loop) {
        this.normaliseIndex(); // instant, before the animation starts
        this.index += direction;
        this.scrollTrackTo(this.scrollOffsetOf(this.index));
        return;
      }

      const maxScroll = this.track.scrollWidth - this.track.clientWidth;
      if (maxScroll <= 0) return;

      const distance =
        step > 0
          ? Math.max(1, Math.floor(this.track.clientWidth / step)) * step
          : this.track.clientWidth;

      const current = this.track.scrollLeft;
      const target = current + distance * direction;

      // Clamp before wrapping. A track only a little wider than one page would
      // otherwise overshoot on the first click and snap straight back to 0,
      // which reads as the arrow doing nothing.
      let destination;
      if (direction > 0) {
        destination = current >= maxScroll - 1 ? 0 : Math.min(target, maxScroll);
      } else {
        destination = current <= 1 ? maxScroll : Math.max(target, 0);
      }

      this.scrollTrackTo(destination);
    }

    scrollTrackTo(left) {
      window.carouselScroll.to(this.track, left);
    }

    /* ---------------------------------------------------------------- dots */

    dotCount() {
      if (this.loop) return this.originals.length;
      const pageWidth = this.track.clientWidth;
      return pageWidth > 0 ? Math.ceil(this.track.scrollWidth / pageWidth) : 1;
    }

    buildDots() {
      if (!this.dotsContainer) return;
      const count = this.dotCount();

      this.dotsContainer.innerHTML = '';
      if (count <= 1) return;

      for (let i = 0; i < count; i += 1) {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'scroll-carousel_dot';
        dot.setAttribute('aria-label', `Go to ${this.loop ? 'slide' : 'page'} ${i + 1}`);
        dot.addEventListener('click', () => this.scrollTrackTo(this.offsetForDot(i, count)));
        this.dotsContainer.appendChild(dot);
      }

      this.updateActiveDot();
    }

    offsetForDot(index, count) {
      if (this.loop) {
        this.normaliseIndex();
        this.index = this.originals.length + index;
        return this.scrollOffsetOf(this.index);
      }
      const maxScroll = this.track.scrollWidth - this.track.clientWidth;
      return count > 1 ? (index / (count - 1)) * maxScroll : 0;
    }

    updateActiveDot() {
      if (!this.dotsContainer) return;
      const dots = Array.from(this.dotsContainer.children);
      if (dots.length === 0) return;

      let current;
      if (this.loop) {
        current = ((this.nearestIndex() % dots.length) + dots.length) % dots.length;
      } else {
        // Spread the dots over the distance the track can actually travel, so the
        // last dot lights up at the end of the scroll rather than a page beyond it.
        const maxScroll = this.track.scrollWidth - this.track.clientWidth;
        const progress = maxScroll > 0 ? this.track.scrollLeft / maxScroll : 0;
        current = Math.round(progress * (dots.length - 1));
      }

      dots.forEach((dot, i) => dot.classList.toggle('is-active', i === current));
    }
  }

  if (!customElements.get('scroll-carousel'))
    customElements.define('scroll-carousel', ScrollCarousel);
})();
