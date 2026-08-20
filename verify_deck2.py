import json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/index.html"
console_msgs, page_errors, failed_reqs = [], [], []

def on_console(msg):
    if msg.type in ("error", "warning"):
        console_msgs.append((msg.type, msg.text[:400]))

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    page = ctx.new_page()
    page.on("console", on_console)
    page.on("pageerror", lambda e: page_errors.append(str(e)[:400]))
    page.on("requestfailed", lambda r: failed_reqs.append(r.url + " :: " + str(r.failure)))
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(800)

    def active():
        return page.evaluate("(() => { const s = document.querySelector('.slide-card.active'); return s ? s.id : null })()")

    # --- 1. Navigate all 7 slides via ArrowRight ---
    seq = [active()]
    for i in range(7):
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(300)
        seq.append(active())
    print("ArrowRight sequence:", seq)
    for i in range(7):
        page.keyboard.press("ArrowLeft")
        page.wait_for_timeout(200)
    print("back to:", active(), "| hash:", page.evaluate("location.hash"))

    # --- dot navigation ---
    dots = page.locator(".dot")
    print("dots:", dots.count())
    if dots.count() >= 5:
        dots.nth(4).click()
        page.wait_for_timeout(400)
        print("after dot4 click:", active(), page.evaluate("location.hash"))

    # --- 2. Grid modal ---
    page.keyboard.press("g")
    page.wait_for_timeout(400)
    gm = page.locator("#grid-modal")
    print("grid open:", gm.is_visible(), "| cards:", page.locator("#grid-cards-container > *").count(),
          "| thumb canvases:", page.locator("#grid-cards-container canvas").count())
    page.locator("#grid-cards-container > *").nth(1).click()  # jump to slide 2 via grid
    page.wait_for_timeout(400)
    print("after grid card click:", active(), "| grid still visible:", gm.is_visible())

    # --- 3. Notes ---
    page.keyboard.press("n")
    page.wait_for_timeout(300)
    print("notes open:", page.locator("#presenter-notes-panel").is_visible(),
          "| content len:", len(page.locator("#notes-content").inner_text()))
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    print("notes closed:", not page.locator("#presenter-notes-panel").is_visible())

    # --- 4. Command palette ---
    page.keyboard.press("Control+k")
    page.wait_for_timeout(300)
    pal = page.locator("#cmd-palette")
    print("palette open:", pal.is_visible())
    pin = page.locator("#cmd-palette input")
    print("palette input:", pin.count())
    pin.fill("amd")
    page.wait_for_timeout(300)
    items = page.locator("#cmd-palette [class*=item], #cmd-palette li, #cmd-palette [role=option]")
    print("palette results for 'amd':", items.count(), "| first:", items.first.inner_text()[:80] if items.count() else None)
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    print("after palette Enter:", active(), page.evaluate("location.hash"))

    # --- 5. Symbol chip switch on AMD chart slide (slide-4) ---
    slide = page.locator("#slide-4")
    chips = slide.locator("[data-symbol]")
    print("chips on slide-4:", chips.count())
    if chips.count() > 1:
        chip2 = chips.nth(2)
        sym = chip2.get_attribute("data-symbol")
        chip2.click()
        page.wait_for_timeout(500)
        print("clicked chip", sym, "| hash:", page.evaluate("location.hash"),
              "| active chip:", slide.locator("[data-symbol].active").get_attribute("data-symbol"))

    # --- 6. Drawing tools: hline via H key, click-click ---
    canvas = slide.locator("canvas").first
    box = canvas.bounding_box()
    print("canvas box:", box)
    def engine_state():
        return page.evaluate("""(() => {
          // find engine instances on window or via app's registry
          const keys = Object.keys(window).filter(k => /engine|chart|deck/i.test(k));
          return keys;
        })()""")
    print("window chart-ish globals:", engine_state())

    if box:
        cx, cy = box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.5
        page.keyboard.press("h")
        page.wait_for_timeout(150)
        page.mouse.click(cx, cy)
        page.mouse.click(cx, cy - 40)
        page.wait_for_timeout(300)
        # count drawings via toolbar state or console probe
        # trend line
        page.keyboard.press("t")
        page.mouse.click(cx - 150, cy + 60)
        page.mouse.click(cx + 150, cy - 80)
        page.wait_for_timeout(300)
        # measure tool
        page.keyboard.press("m")
        page.mouse.move(cx - 200, cy)
        page.mouse.down()
        page.mouse.move(cx + 100, cy, steps=5)
        page.mouse.up()
        page.wait_for_timeout(300)
        meas = slide.locator("[class*=measure]")
        print("measure overlay visible:", meas.count(), meas.first.inner_text()[:100] if meas.count() else "")
        page.keyboard.press("Escape")

    # --- 7. Shift+drag zoom ---
    if box:
        page.keyboard.down("Shift")
        page.mouse.move(box["x"] + 150, box["y"] + box["height"] * 0.6)
        page.mouse.down()
        page.mouse.move(box["x"] + 500, box["y"] + box["height"] * 0.6, steps=6)
        page.mouse.up()
        page.keyboard.up("Shift")
        page.wait_for_timeout(400)
        print("shift-drag zoom done; hash:", page.evaluate("location.hash"))
        # dblclick reset
        page.mouse.dblclick(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
        page.wait_for_timeout(300)

    # --- 8. Indicator toggles ---
    tog = slide.locator("[data-opt], .chart-toggle, [class*=ind-toggle] button, .toolbar button")
    print("toolbar buttons on slide-4:", tog.count())
    if tog.count():
        label = tog.first.inner_text()
        tog.first.click()
        page.wait_for_timeout(300)
        print("toggled:", label[:40])
        tog.first.click()
        page.wait_for_timeout(200)

    # --- 9. Autoplay ---
    page.keyboard.press("a")
    page.wait_for_timeout(300)
    ring = page.locator("[class*=ring], [class*=autoplay], [class*=countdown]")
    vis = [i for i in range(ring.count()) if ring.nth(i).is_visible()]
    print("autoplay indicators visible:", vis, ring.first.get_attribute("class") if ring.count() else None)
    print("slide before autoplay wait:", active())
    page.wait_for_timeout(6500)
    print("slide after 6.5s autoplay:", active())
    page.keyboard.press("a")
    page.wait_for_timeout(200)

    # --- 10. Export PNG ---
    exp = slide.locator("button:has-text('PNG'), [class*=export], [title*=PNG], [title*=Export]")
    print("export buttons on slide-4:", exp.count())
    if exp.count():
        with page.expect_download(timeout=5000) as dl:
            exp.first.click()
        d = dl.value
        path = "/tmp/export_test.png"
        d.save_as(path)
        import os
        print("downloaded:", d.suggested_filename, os.path.getsize(path), "bytes")

    # --- 11. deep link parse on load ---
    page2 = ctx.new_page()
    page2.on("console", on_console)
    page2.on("pageerror", lambda e: page_errors.append("page2: "+str(e)[:300]))
    page2.goto(URL + "#5/NVDA", wait_until="networkidle")
    page2.wait_for_timeout(800)
    print("deep link #5/NVDA -> active:", page2.evaluate("document.querySelector('.slide-card.active')?.id"),
          "| active chip:", page2.evaluate("document.querySelector('#slide-4 [data-symbol].active, .slide-card.active [data-symbol].active')?.dataset.symbol"))
    page2.close()

    browser.close()

print("\n=== CONSOLE errors/warnings ===")
print("\n".join(f"[{t}] {m}" for t, m in console_msgs) or "(none)")
print("=== PAGE ERRORS ===")
print("\n".join(page_errors) or "(none)")
print("=== FAILED REQUESTS ===")
print("\n".join(failed_reqs) or "(none)")
