import hashlib
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/index.html"
console_msgs, page_errors = [], []

def on_console(msg):
    if msg.type in ("error", "warning"):
        console_msgs.append((msg.type, msg.text[:300]))

def canvas_hash(page, cid="chart-canvas-4"):
    return page.evaluate(f"(() => {{ const c = document.getElementById('{cid}'); return c ? c.toDataURL().length + ':' + c.toDataURL().slice(-64) : null }})()")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.on("console", on_console)
    page.on("pageerror", lambda e: page_errors.append(str(e)[:300]))
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(900)
    page.locator(".dot-btn").nth(4).click()
    page.wait_for_timeout(1500)  # let draw-on animation finish
    h0 = canvas_hash(page)
    box = page.locator("#chart-canvas-4").bounding_box()
    cx, cy = box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.45

    # hline draw changes canvas?
    page.keyboard.press("h"); page.wait_for_timeout(120)
    page.mouse.click(cx - 100, cy); page.mouse.click(cx + 50, cy)
    page.wait_for_timeout(400)
    h1 = canvas_hash(page)
    print("canvas changed after hline:", h0 != h1)

    # measure drag changes canvas mid-drag?
    page.keyboard.press("m"); page.wait_for_timeout(120)
    page.mouse.move(cx - 260, cy - 30); page.mouse.down()
    page.mouse.move(cx + 160, cy - 30, steps=8)
    page.wait_for_timeout(250)
    h2 = canvas_hash(page)
    page.mouse.up(); page.wait_for_timeout(250)
    h3 = canvas_hash(page)
    print("canvas changed during measure drag:", h1 != h2, "| after commit vs base:", h1 != h3)
    page.keyboard.press("Escape")

    # shift-drag zoom changes canvas?
    page.keyboard.down("Shift")
    page.mouse.move(box["x"] + 120, box["y"] + box["height"] * 0.55)
    page.mouse.down()
    page.mouse.move(box["x"] + 620, box["y"] + box["height"] * 0.55, steps=8)
    page.mouse.up()
    page.keyboard.up("Shift")
    page.wait_for_timeout(500)
    h4 = canvas_hash(page)
    print("canvas changed after shift-drag zoom:", h3 != h4)

    # dblclick reset restores?
    page.mouse.dblclick(cx, cy)
    page.wait_for_timeout(500)
    h5 = canvas_hash(page)
    print("canvas after dblclick reset == pre-zoom:", h5 == h3)

    # RS vs SPY toggle changes canvas?
    page.locator("#slide-4 button:has-text('RS vs SPY')").click()
    page.wait_for_timeout(500)
    h6 = canvas_hash(page)
    print("canvas changed after RS toggle:", h5 != h6)
    page.locator("#slide-4 button:has-text('RS vs SPY')").click()
    page.wait_for_timeout(300)

    # Clear drawings
    page.locator("#slide-4 button:has-text('Clear')").click()
    page.wait_for_timeout(400)

    # symbol chip switch changes canvas + sparkline chips show %
    chips = page.locator("#slide-4 [data-symbol]")
    print("chip count:", chips.count(), "| chip text sample:", chips.nth(1).inner_text().replace("\n", " ")[:60])
    page.locator("#slide-4 [data-symbol='BTC-USD']").click()
    page.wait_for_timeout(1500)
    h7 = canvas_hash(page)
    print("canvas changed after BTC-USD switch:", h6 != h7, "| hash:", page.evaluate("location.hash"))
    # Fib/risk buttons disabled for non-primary symbol?
    fib = page.locator("#slide-4 [data-toggle='showFib'], #slide-4 button:has-text('Fib')").first
    print("fib btn disabled on BTC:", fib.get_attribute("disabled"), "| class:", fib.get_attribute("class"))

    # autoplay: dwell for slide-4 is 30s; start and wait 34s
    page.locator(".dot-btn").nth(0).click()  # slide 1 dwell=26
    page.wait_for_timeout(400)
    print("autoplay test start on:", page.evaluate("document.querySelector('.slide-card.active')?.id"))
    page.keyboard.press("a")
    page.wait_for_timeout(2000)
    ring = page.evaluate("(() => { const b = document.querySelector('.deck-nav-btn.next'); return b ? b.className : null })()")
    print("next btn class during autoplay:", ring)
    page.wait_for_timeout(26000)
    print("after ~28s autoplay on slide-1 (dwell 26):", page.evaluate("document.querySelector('.slide-card.active')?.id"))
    page.keyboard.press("a")
    browser.close()

print("=== CONSOLE ===")
print("\n".join(f"[{t}] {m}" for t, m in console_msgs) or "(none)")
print("=== PAGE ERRORS ===")
print("\n".join(page_errors) or "(none)")
