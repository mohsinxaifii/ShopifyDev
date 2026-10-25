class AnnouncementBarCarousel extends HTMLElement {
  connectedCallback() {
    this.allSlides = Array.from(this.querySelectorAll('.announcement-bar_wrapper_track_slide'));
    this.prevButton = this.querySelector('.announcement-bar_wrapper_prev');
    this.nextButton = this.querySelector('.announcement-bar_wrapper_next');
    this.currentIndex = 0;
    this.autoplay = this.dataset.autoplay === 'true';
    this.autoplaySpeed = Number(this.dataset.autoplaySpeed) || 4000;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.prevButton?.addEventListener('click', () => this.goTo(this.currentIndex - 1, true));
    this.nextButton?.addEventListener('click', () => this.goTo(this.currentIndex + 1, true));
    // Drag with a mouse or swipe with a finger to change message (assets/swipe.js).
    window.zinaraSwipe?.(this, {
      threshold: 30,
      onSwipe: (direction) => this.goTo(this.currentIndex + direction, true),
    });
    this.addEventListener('mouseenter', () => this.stopAutoplay());
    this.addEventListener('mouseleave', () => this.startAutoplay());
    this.addEventListener('focusin', () => this.stopAutoplay());
    this.addEventListener('focusout', () => this.startAutoplay());

    // ZNow slides come and go with the shopper's pincode (assets/location.js).
    this.onLocation = () => this.refresh();
    document.addEventListener('zinara:location', this.onLocation);
    this.refresh();
  }

  disconnectedCallback() {
    this.stopAutoplay();
    document.removeEventListener('zinara:location', this.onLocation);
  }

  /* The slides this shopper can see: ZNow ones only where same-day delivery
     is served (<html class="is-znow">, set by snippets/location). */
  refresh() {
    const znow = document.documentElement.classList.contains('is-znow');
    const current = this.slides?.[this.currentIndex];
    this.slides = this.allSlides.filter((slide) => znow || !slide.hasAttribute('data-znow-only'));
    this.allSlides.forEach((slide) => {
      if (!this.slides.includes(slide)) {
        slide.hidden = true;
        slide.classList.remove('is-active');
      } else if (this.slides.length > 1) {
        slide.hidden = false;
      }
    });
    this.currentIndex = Math.max(0, this.slides.indexOf(current));
    if (this.slides.length === 1) this.slides[0].hidden = false;

    // Nothing left to show (only ZNow messages, shopper outside the area).
    this.hidden = !this.slides.length;
    const single = this.slides.length < 2;
    if (this.prevButton) this.prevButton.hidden = single;
    if (this.nextButton) this.nextButton.hidden = single;

    this.updateSlideState();
    if (single) this.stopAutoplay();
    else this.startAutoplay();
  }

  goTo(index, isManual = false) {
    if (!this.slides.length) return;
    this.currentIndex = (index + this.slides.length) % this.slides.length;
    this.updateSlideState();
    if (isManual) {
      this.stopAutoplay();
      if (this.autoplay && !this.reducedMotion) this.startAutoplay();
    }
  }

  updateSlideState() {
    this.slides.forEach((slide, index) => {
      const isActive = index === this.currentIndex;
      slide.classList.toggle('is-active', isActive);
      slide.setAttribute('aria-hidden', String(!isActive));
      const link = slide.querySelector('a');
      if (link) link.tabIndex = isActive ? 0 : -1;
    });
    // The bar takes the ZNow gradient while a ZNow message is showing.
    const active = this.slides[this.currentIndex];
    this.classList.toggle('is-znow', Boolean(active?.hasAttribute('data-znow-only')));
  }

  startAutoplay() {
    if (!this.autoplay || this.reducedMotion || !this.slides || this.slides.length < 2) return;
    this.stopAutoplay();
    this.timer = window.setInterval(() => this.goTo(this.currentIndex + 1), this.autoplaySpeed);
  }

  stopAutoplay() {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

customElements.define('announcement-bar-carousel', AnnouncementBarCarousel);
