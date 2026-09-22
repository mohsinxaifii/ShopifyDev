class HeroBannerSlideshow extends HTMLElement {
  connectedCallback() {
    this.slides = Array.from(this.querySelectorAll('.hero-banner_wrapper_track_slide'));
    this.dots = Array.from(this.querySelectorAll('.hero-banner_wrapper_dots_dot'));
    this.prevButton = this.querySelector('.hero-banner_wrapper_prev');
    this.nextButton = this.querySelector('.hero-banner_wrapper_next');
    this.currentIndex = 0;
    this.autoplay = this.dataset.autoplay === 'true';
    this.autoplaySpeed = Number(this.dataset.autoplaySpeed) || 6000;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (this.slides.length < 2) return;

    this.prevButton?.addEventListener('click', () => this.goTo(this.currentIndex - 1, true));
    this.nextButton?.addEventListener('click', () => this.goTo(this.currentIndex + 1, true));
    this.dots.forEach((dot, index) => {
      dot.addEventListener('click', () => this.goTo(index, true));
    });
    this.addEventListener('mouseenter', () => this.stopAutoplay());
    this.addEventListener('mouseleave', () => this.startAutoplay());
    this.addEventListener('focusin', () => this.stopAutoplay());
    this.addEventListener('focusout', () => this.startAutoplay());

    if (this.autoplay && !this.reducedMotion) this.startAutoplay();
  }

  disconnectedCallback() {
    this.stopAutoplay();
  }

  goTo(index, isManual = false) {
    this.currentIndex = (index + this.slides.length) % this.slides.length;
    this.slides.forEach((slide, i) => {
      slide.classList.toggle('is-active', i === this.currentIndex);
      const link = slide.querySelector('a');
      if (link) link.tabIndex = i === this.currentIndex ? 0 : -1;
    });
    this.dots.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === this.currentIndex);
      dot.setAttribute('aria-selected', String(i === this.currentIndex));
    });

    if (isManual) {
      this.stopAutoplay();
      if (this.autoplay && !this.reducedMotion) this.startAutoplay();
    }
  }

  startAutoplay() {
    if (!this.autoplay || this.reducedMotion || this.slides.length < 2) return;
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

customElements.define('hero-banner-slideshow', HeroBannerSlideshow);
