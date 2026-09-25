/* Opens the full review in a native <dialog>, so Esc, focus trapping and the
   theme's scroll-lock rule all come for free. The motion is CSS transitions on
   `.is-open`: a centred popup on desktop, a bottom sheet that slides up and back
   down on phones. Closing waits for the panel to finish leaving before the
   dialog is actually closed. */
class ReviewModal extends HTMLElement {
  connectedCallback() {
    this.dialog = this.querySelector('dialog');
    this.panel = this.dialog?.querySelector('.review-dialog_panel');
    this.opener = this.querySelector('[data-review-open]');
    if (!this.dialog || !this.panel || !this.opener) return;

    this.opener.addEventListener('click', (event) => {
      event.preventDefault();
      this.open();
    });

    this.querySelector('[data-review-close]')?.addEventListener('click', () => this.close());

    // A click that lands on the dialog box itself is a click on the backdrop,
    // because the panel fills it.
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close();
    });

    // Esc would close instantly; run the same exit instead.
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });

    this.dialog.addEventListener('close', () => {
      this.dialog.classList.remove('is-open');
      this.closing = false;
    });
  }

  open() {
    if (this.dialog.open) return;
    this.closing = false;
    this.dialog.showModal();
    // Commit the off-screen start position before transitioning to rest.
    void this.panel.offsetHeight;
    this.dialog.classList.add('is-open');
  }

  close() {
    if (!this.dialog.open || this.closing) return;
    this.closing = true;
    this.dialog.classList.remove('is-open');

    const finish = () => {
      clearTimeout(timer);
      this.panel.removeEventListener('transitionend', onEnd);
      if (this.closing) this.dialog.close();
    };
    const onEnd = (event) => {
      if (event.target === this.panel && event.propertyName === 'transform') finish();
    };
    this.panel.addEventListener('transitionend', onEnd);
    const timer = setTimeout(finish, 500);
  }
}

customElements.define('review-modal', ReviewModal);
