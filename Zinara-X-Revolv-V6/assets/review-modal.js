/* Opens the full review in a native <dialog>, so Esc, focus trapping and the
   theme's scroll-lock rule all come for free. */
class ReviewModal extends HTMLElement {
  connectedCallback() {
    this.dialog = this.querySelector('dialog');
    this.opener = this.querySelector('[data-review-open]');
    if (!this.dialog || !this.opener) return;

    this.opener.addEventListener('click', (event) => {
      event.preventDefault();
      this.dialog.showModal();
    });

    this.querySelector('[data-review-close]')?.addEventListener('click', () => this.dialog.close());

    // A click that lands on the dialog box itself is a click on the backdrop,
    // because the panel fills it.
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
  }
}

customElements.define('review-modal', ReviewModal);
