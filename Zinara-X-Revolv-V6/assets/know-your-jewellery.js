class FlipCard extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', () => this.classList.toggle('is-flipped'));
    this.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.classList.toggle('is-flipped');
      }
    });
  }
}

customElements.define('flip-card', FlipCard);

class CardStack extends HTMLElement {
  connectedCallback() {
    this.items = Array.from(this.querySelectorAll('[data-stack-item]'));
    this.dotsContainer = this.querySelector('[data-dots]');
    this.activeIndex = this.items.findIndex((item) => item.classList.contains('is-active'));
    if (this.activeIndex < 0) this.activeIndex = 0;

    this.items.forEach((item, index) => {
      item.addEventListener('click', () => {
        if (index !== this.activeIndex) this.goTo(index);
      });
    });

    this.querySelectorAll('[data-prev]').forEach((button) =>
      button.addEventListener('click', () => this.goTo(this.activeIndex - 1)),
    );
    this.querySelectorAll('[data-next]').forEach((button) =>
      button.addEventListener('click', () => this.goTo(this.activeIndex + 1)),
    );

    this.buildDots();
    this.updateDepths();
  }

  goTo(index) {
    const total = this.items.length;
    const next = (index + total) % total;

    this.items.forEach((item) => item.classList.remove('is-flipped'));
    this.activeIndex = next;
    this.updateDepths();

    if (this.dotsContainer) {
      Array.from(this.dotsContainer.children).forEach((dot, i) => dot.classList.toggle('is-active', i === next));
    }
  }

  /* Depth 0 is the front card; 1 and 2 peek out below it, anything deeper hides. */
  updateDepths() {
    const total = this.items.length;
    this.items.forEach((item, i) => {
      const depth = (i - this.activeIndex + total) % total;
      item.dataset.depth = String(Math.min(depth, 3));
      item.classList.toggle('is-active', depth === 0);
    });
  }

  buildDots() {
    if (!this.dotsContainer || this.items.length < 2) return;
    this.dotsContainer.innerHTML = '';
    this.items.forEach((_, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'scroll-carousel_dot';
      if (index === this.activeIndex) dot.classList.add('is-active');
      dot.setAttribute('aria-label', `Show card ${index + 1}`);
      dot.addEventListener('click', () => this.goTo(index));
      this.dotsContainer.appendChild(dot);
    });
  }
}

customElements.define('card-stack', CardStack);
