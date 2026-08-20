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

    def goto(n):
        page.locator(".dot-btn").nth(n - 1).click()
        page.wait_for_timeout(450)
        return active()

    goto(5)  # AMD chart slide
    print("on:", active())
    canvas = page.locator("#chart-canvas-4")
    box = canvas.bounding_box()
    print("main canvas box:", box)

    # --- hline tool ---
    cx, cy = box["x"] + box["width"] * 0.5, box["y"] + box["height"] * 0.45
    page.keyboard.press("h")
    page.wait_for_timeout(150)
    toolbtn = page.evaluate("[...document.querySelectorAll('#slide-4 [class*=tool]')].filter(e=>/active/.test(e.className)).map(e=>e.className)")
    print("active tool btn after h:", toolbtn)
    page.mouse.click(cx - 100, cy)
    page.mouse.click(cx + 50, cy)
    page.wait_for_timeout(300)

    # --- trendline tool ---
    page.keyboard.press("t")
    page.mouse.click(cx - 250, cy + 90)
    page.mouse.click(cx + 200, cy - 70)
    page.wait_for_timeout(300)

    # --- measure tool ---
    page.keyboard.press("m")
    page.mouse.move(cx - 260, cy - 30)
    page.mouse.down()
    page.mouse.move(cx + 160, cy - 30, steps=8)
    page.wait_for_timeout(200)
    mid_meas = page.evaluate("[...document.querySelectorAll('#slide-4 [class*=measure]')].map(e=>e.className+':'+(e.innerText||'').slice(0,120))")
    page.mouse.up()
    page.wait_for_timeout(300)
    end_meas = page.evaluate("[...document.querySelectorAll('#slide-4 [class*=measure]')].map(e=>e.className+':'+(e.innerText||'').slice(0,120))")
    print("measure mid-drag:", mid_meas)
    print("measure after:", end_meas)
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)

    # --- shift+drag zoom ---
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

    # --- toolbar buttons on slide-4 ---
    tog = page.locator("#slide-4 .chart-toolbar button, #slide-4 [class*=toolbar] button")
    labels = [tog.nth(i).inner_text()[:24] for i in range(tog.count())]
    print("toolbar buttons:", tog.count(), labels)
    if tog.count():
        tog.first.click()
        page.wait_for_timeout(250)
        tog.first.click()
        page.wait_for_timeout(200)

    # --- autoplay ---
    print("slide before A:", active())
    page.keyboard.press("a")
    page.wait_for_timeout(400)
    auto_state = page.evaluate("[...document.querySelectorAll('[class*=autoplay],[class*=ring],[class*=countdown],[class*=dwell]')].map(e=>e.tagName+'.'+e.className)")
    print("autoplay els:", auto_state[:6])
    page.wait_for_timeout(6000)
    print("slide after ~6.4s autoplay:", active())
    page.keyboard.press("a")
    page.wait_for_timeout(250)

    # --- export PNG ---
    goto(5)
    exp = page.locator("#slide-4 button:has-text('PNG'), #slide-4 [class*=export], #slide-4 [title*=PNG i], #slide-4 [aria-label*=Export i]")
    print("export buttons:", exp.count(), [exp.nth(i).inner_text()[:30] for i in range(exp.count())])
    if exp.count():
        try:
            with page.expect_download(timeout=6000) as dl:
                exp.first.click()
            d = dl.value
            d.save_as("/tmp/export_test.png")
            print("PNG downloaded:", d.suggested_filename, os.path.getsize("/tmp/export_test.png"), "bytes")
        except Exception as e:
            print("PNG export FAILED:", str(e)[:300])

    # --- wheel zoom + drag pan sanity ---
    box = page.locator("#chart-canvas-4").bounding_box()
    page.mouse.move(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
    page.mouse.wheel(0, -240)
    page.wait_for_timeout(300)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"]/2 - 120, box["y"] + box["height"]/2, steps=5)
    page.mouse.up()
    page.wait_for_timeout(300)
    print("wheel+pan done")

    # --- deep link ---
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
