
def fill_modal(page, text=None, ok=True, timeout=5000):
    """Drive the in-app <dialog id=appModal> (replaces window.prompt/confirm)."""
    page.wait_for_selector("#appModal[open]", timeout=timeout)
    if text is not None:
        page.wait_for_selector("#appModalInput:not([hidden])", timeout=timeout)
        page.fill("#appModalInput", text)
    btn = "#appModalOk" if ok else "#appModalCancel"
    page.click(btn)
    # No wait_for_function: the app's CSP forbids string eval. A chained confirm may reopen
    # the dialog at once, so a short settle is enough rather than waiting for it to close.
    try:
        page.wait_for_selector("#appModal:not([open])", state="attached", timeout=min(timeout, 600))
    except Exception:
        pass

def auto_accept_modals(page):
    """Click OK on any app modal that opens (confirms during scripted runs)."""
    page.evaluate("""() => {
      if (window.__ssAutoModal) return;
      window.__ssAutoModal = setInterval(() => {
        const dlg = document.getElementById('appModal');
        if (!dlg || !dlg.open) return;
        const ok = document.getElementById('appModalOk');
        if (ok) ok.click();
      }, 40);
    }""")

def reveal_click(page, sel):
    """Click a control that the desktop layout hides until hover (zone rows) or behind the ⋯ menu (<=1366px)."""
    loc = page.locator(sel).first
    if not loc.is_visible():
        zone = loc.locator("xpath=ancestor::*[contains(concat(' ', @class, ' '), ' zone ')][1]")
        if zone.count():
            zone.locator(".zone-head").first.scroll_into_view_if_needed()
            zone.locator(".zone-head").first.hover()
        elif page.locator(".more-btn").is_visible():
            page.click(".more-btn")
    loc.click()
