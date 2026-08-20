import os
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
        return page.evaluate("document.querySelector('.slide-card.active')?.id")

    def goto(n):  # n = 1-based slide number, navigate via dots
        page.locator(".dot-btn").nth(n - 1).click()
        page.wait_for_timeout(450)
        return active()

    # --- dot navigation ---
    print("dot count:", page.locator(".dot-btn").count())
    print("dot nav to slide 5:", goto(5), "| hash:", page.evaluate("location.hash"))

    # --- notes open/close via class ---
    page.keyboard.press("n")
    page.wait_for_timeout(250)
    print("notes class after n:", page.locator("#presenter-notes-panel").get_attribute("class"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(250)
    print("notes class after Esc:", page.locator("#presenter-notes-panel").get_attribute("class"))

    # --- grid modal close on card click (class-based) ---
    page.keyboard.press("g")
    page.wait_for_timeout(300)
    print("grid class after g:", page.locator("#grid-modal").get_attribute("class"))
    page.locator(".grid-slide-card").nth(4).click()
    page.wait_for_timeout(400)
    print("grid class after card click:", page.locator("#grid-modal").get_attribute("class"), "| active:", active())

    # --- palette fuzzy ranking for 'amd' ---
    page.keyboard.press("Control+k")
    page.wait_for_timeout(250)
    page.locator("#cmd-palette input").fill("amd")
    page.wait_for_timeout(300)
    results = page.evaluate("""[...document.querySelectorAll('#cmd-palette [class*=item], #cmd-palette li, #cmd-palette [role=option]')]
        .slice(0, 6).map(e => e.innerText.replace(/\\n/g, ' | ').slice(0, 90))""")
    print("palette 'amd' top results:")
    for r in results:
        print("   ", r)
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    print("palette Enter 'amd' ->", active(), page.evaluate("location.hash"))

    # --- symbol chip switch on slide-4 (AMD slide, now active if palette worked; else goto 5) ---
    if active() != "slide-4":
        goto(5)
    print("on slide:", active())
    slide = page.locator("#slide-4")
    chip = slide.locator("[data-symbol='TSLA']")
    chip.click()
    page.wait_for_timeout(500)
    print("chip TSLA clicked | hash:", page.evaluate("location.hash"),
          "| active chip:", slide.locator("[data-symbol].active").get_attribute("data-symbol"))
    # verify chart re-pointed: check engine via canvas title/legend
    legend = slide.locator("[class*=chart-title], [class*=legend], h2, h3").first
    print("slide header text:", legend.inner_text()[:80] if legend.count() else "n/a")
    # switch back to AMD
    slide.locator("[data-symbol='AMD']").click()
    page.wait_for_timeout(400)
    print("switched back, hash:", page.evaluate("location.hash"))

    # --- drawing tools on slide-4 canvas ---
    canvas = slide.locator("canvas").first
    box = canvas.bounding_box()
    print("canvas box:", box)
    if box:
        cx, cy = box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.45
        # hline: key h then two clicks
        page.keyboard.press("h")
        page.wait_for_timeout(120)
        page.mouse.click(cx - 100, cy)
        page.mouse.click(cx + 50, cy)
        page.wait_for_timeout(250)
        # trendline
        page.keyboard.press("t")
        page.mouse.click(cx - 200, cy + 80)
        page.mouse.click(cx + 200, cy - 60)
        page.wait_for_timeout(250)
        # measure: key m then drag
        page.keyboard.press("m")
        page.mouse.move(cx - 250, cy - 20)
        page.mouse.down()
        page.mouse.move(cx + 150, cy - 20, steps=6)
        page.mouse.up()
        page.wait_for_timeout(250)
        meas = page.evaluate("[...document.querySelectorAll('#slide-4 [class*=measure], #slide-4 [class*=tooltip]')].map(e=>e.className+':'+e.inner_text.slice(0,80))")
        print("measure/tooltip elements:", meas)
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)

    # --- shift+drag zoom, then dblclick reset ---
    if box:
        page.keyboard.down("Shift")
        page.mouse.move(box["x"] + 120, box["y"] + box["height"] * 0.55)
        page.mouse.down()
        page.mouse.move(box["x"] + 620, box["y"] + box["height"] * 0.55, steps=8)
        page.mouse.up()
        page.keyboard.up("Shift")
        page.wait_for_timeout(400)
        print("shift-drag zoom done")
        page.mouse.dblclick(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(300)
        print("dblclick reset done")

    # --- indicator toggles ---
    tog = slide.locator(".toolbar button, [class*=toolbar] button, [class*=toggle]")
    print("toolbar buttons:", tog.count(), [tog.nth(i).inner_text()[:20] for i in range(min(tog.count(), 10))])
    if tog.count():
        tog.first.click()
        page.wait_for_timeout(250)
        tog.first.click()
        page.wait_for_timeout(200)

    # --- autoplay ---
    print("slide before A:", active())
    page.keyboard.press("a")
    page.wait_for_timeout(300)
    auto_state = page.evaluate("[...document.querySelectorAll('[class*=autoplay],[class*=ring],[class*=countdown]')].map(e=>e.className)")
    print("autoplay els:", auto_state[:5])
    page.wait_for_timeout(6500)
    print("slide after 6.5s (autoplay on):", active())
    page.keyboard.press("a")
    page.wait_for_timeout(300)
    print("after A off, slide:", active())

    # --- export PNG ---
    goto(5)
    exp = page.locator("#slide-4 button:has-text('PNG'), #slide-4 [class*=export], #slide-4 [title*=PNG], #slide-4 [title*=Export], #slide-4 [aria-label*=Export i]")
    print("export buttons:", exp.count(), [exp.nth(i).inner_text()[:30] for i in range(exp.count())])
    if exp.count():
        try:
            with page.expect_download(timeout=5000) as dl:
                exp.first.click()
            d = dl.value
            d.save_as("/tmp/export_test.png")
            print("PNG downloaded:", d.suggested_filename, os.path.getsize("/tmp/export_test.png"), "bytes")
        except Exception as e:
            print("PNG export FAILED:", str(e)[:200])

    # --- deep link parse ---
    page2 = ctx.new_page()
    page2.on("console", on_console)
    page2.on("pageerror", lambda e: page_errors.append("page2: " + str(e)[:300]))
    page2.goto(URL + "#5/NVDA", wait_until="networkidle")
    page2.wait_for_timeout(900)
    print("deep link #5/NVDA -> active:", page2.evaluate("document.querySelector('.slide-card.active')?.id"),
          "| active chip:", page2.evaluate("document.querySelector('.slide-card.active [data-symbol].active')?.dataset.symbol"),
          "| hash:", page2.evaluate("location.hash"))
    page2.close()
    browser.close()

print("\n=== CONSOLE errors/warnings ===")
print("\n".join(f"[{t}] {m}" for t, m in console_msgs) or "(none)")
print("=== PAGE ERRORS ===")
print("\n".join(page_errors) or "(none)")
print("=== FAILED REQUESTS ===")
print("\n".join(failed_reqs) or "(none)")
