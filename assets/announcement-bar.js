class AnnouncementBarCarousel extends HTMLElement {
  connectedCallback() {
    this.slides = Array.from(this.querySelectorAll('.announcement-bar_wrapper_track_slide'));
    this.prevButton = this.querySelector('.announcement-bar_wrapper_prev');
    this.nextButton = this.querySelector('.announcement-bar_wrapper_next');
    this.currentIndex = 0;
    this.autoplay = this.dataset.autoplay === 'true';
    this.autoplaySpeed = Number(this.dataset.autoplaySpeed) || 4000;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (this.slides.length < 2) return;

    this.slides.forEach((slide) => slide.removeAttribute('hidden'));
    this.updateSlideState();

    this.prevButton?.addEventListener('click', () => this.goTo(this.currentIndex - 1, true));
    this.nextButton?.addEventListener('click', () => this.goTo(this.currentIndex + 1, true));
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

customElements.define('announcement-bar-carousel', AnnouncementBarCarousel);
