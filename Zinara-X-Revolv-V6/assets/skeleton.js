/*
 * Clears the loading placeholders once the page has finished arriving.
 *
 * `complete` is the useful signal here rather than DOMContentLoaded: the markup
 * under a skeleton is already server-rendered, so what the placeholder is
 * covering is the stretch where stylesheets and images are still landing and
 * the layout is still moving. Waiting for `complete` means the cover lifts on a
 * settled page.
 *
 * Interactive pages clear earlier on their own, from the `:defined` rules in
 * their stylesheets, and skeleton.css holds a 2.5s CSS timeout behind both - so
 * this script failing to run is not able to strand anyone.
 */
(() => {
  function clear() {
    document.querySelectorAll('[data-skeleton]').forEach((el) => el.remove());
  }

  if (document.readyState === 'complete') {
    clear();
  } else {
    window.addEventListener('load', clear, { once: true });
  }

  /* In the theme editor a section re-renders without a fresh page load, so the
     placeholder would otherwise come back and stay. */
  if (window.Shopify && window.Shopify.designMode) {
    document.addEventListener('shopify:section:load', clear);
  }
})();
