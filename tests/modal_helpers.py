
def fill_modal(page, text=None, ok=True, timeout=5000):
    """Drive the in-app <dialog id=appModal> (replaces window.prompt/confirm)."""
    page.wait_for_selector("#appModal[open]", timeout=timeout)
    if text is not None:
        page.wait_for_selector("#appModalInput:not([hidden])", timeout=timeout)
        page.fill("#appModalInput", text)
    btn = "#appModalOk" if ok else "#appModalCancel"
    page.click(btn)
    page.wait_for_function("() => !document.getElementById('appModal')?.open", timeout=timeout)

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
