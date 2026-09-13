from __future__ import annotations

import contextlib
import sys
from collections.abc import Iterator
from dataclasses import dataclass

from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright


@dataclass
class BrowserSession:
    playwright: Playwright
    browser: Browser
    context: BrowserContext
    page: Page

    def close(self) -> None:
        with contextlib.suppress(Exception):
            self.context.close()
        with contextlib.suppress(Exception):
            self.browser.close()
        with contextlib.suppress(Exception):
            self.playwright.stop()


def launch_session(*, headed: bool = False, timeout_ms: int = 30_000) -> BrowserSession:
    playwright = sync_playwright().start()
    launch_kwargs: dict = {"headless": not headed}
    browser: Browser | None = None
    if sys.platform == "win32":
        try:
            browser = playwright.chromium.launch(channel="msedge", **launch_kwargs)
        except Exception:
            browser = None
    if browser is None:
        browser = playwright.chromium.launch(**launch_kwargs)
    context = browser.new_context(viewport={"width": 1366, "height": 768})
    page = context.new_page()
    page.set_default_timeout(timeout_ms)
    return BrowserSession(playwright=playwright, browser=browser, context=context, page=page)


@contextlib.contextmanager
def browser_page(*, headed: bool = False) -> Iterator[Page]:
    session = launch_session(headed=headed)
    try:
        yield session.page
    finally:
        session.close()
