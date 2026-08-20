import sys, time, json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/index.html"
console_msgs = []
page_errors = []
failed_reqs = []

def on_console(msg):
    if msg.type in ("error", "warning"):
        console_msgs.append((msg.type, msg.text[:300]))

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("console", on_console)
    page.on("pageerror", lambda e: page_errors.append(str(e)[:300]))
    page.on("requestfailed", lambda r: failed_reqs.append(r.url + " :: " + str(r.failure)))

    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(800)

    # Basic DOM sanity
    print("title:", page.title())
    slides = page.locator(".slide")
    print("slide elements:", slides.count())
    active = page.evaluate("document.querySelector('.slide.active')?.id || document.querySelector('.slide.active')?.dataset.slide")
    print("active slide on load:", active, "| hash:", page.evaluate("location.hash"))

    # Navigate all 7 slides with ArrowRight
    seen = []
    for i in range(8):
        cur = page.evaluate("(() => { const s = document.querySelector('.slide.active'); return s ? (s.id || s.dataset.index || Array.from(document.querySelectorAll('.slide')).indexOf(s)) : null })()")
        seen.append(cur)
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(350)
    print("visited while pressing ArrowRight x8:", seen)

    # Dot navigation
    dots = page.locator(".dot, .nav-dot, [data-goto], .progress-dot")
    print("dot-like elements:", dots.count())

    # Grid modal (G)
    page.keyboard.press("g")
    page.wait_for_timeout(400)
    grid_visible = page.evaluate("(() => { const g = document.querySelector('.grid-modal, #grid-modal, .slide-grid, [class*=grid]'); return g ? {cls: g.className, visible: g.offsetParent !== null || getComputedStyle(g).display !== 'none'} : null })()")
    print("grid after G:", grid_visible)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    # Notes (N)
    page.keyboard.press("n")
    page.wait_for_timeout(300)
    notes = page.evaluate("(() => { const els = [...document.querySelectorAll('[class*=note]')]; const v = els.filter(e => e.offsetParent !== null); return v.length ? v[0].className : null })()")
    print("notes after N:", notes)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    # Command palette (Ctrl+K)
    page.keyboard.press("Control+k")
    page.wait_for_timeout(300)
    pal = page.evaluate("(() => { const els = [...document.querySelectorAll('[class*=palette], [id*=palette]')]; const v = els.filter(e => e.offsetParent !== null); return v.length ? v[0].className + '|' + v[0].id : null })()")
    print("palette after Ctrl+K:", pal)
    # try typing a slide jump
    inp = page.locator("[class*=palette] input, [id*=palette] input").first
    if inp.count():
        inp.fill("amd")
        page.wait_for_timeout(300)
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        print("after palette jump hash:", page.evaluate("location.hash"))
    else:
        print("palette input NOT FOUND")

    # Go to a chart slide (slide 2) and switch symbol chip
    page.keyboard.press("Escape")
    page.evaluate("location.hash = '#1'")
    page.wait_for_timeout(500)
    chips = page.locator("[class*=chip], [class*=symbol-strip] button, [data-symbol]")
    print("symbol chips on slide idx1:", chips.count())
    if chips.count() > 1:
        before = page.evaluate("location.hash")
        chips.nth(1).click()
        page.wait_for_timeout(400)
        print("chip click: hash before=", before, "after=", page.evaluate("location.hash"))

    # Drawing tools via keys H/T/M on a chart slide
    canvases = page.locator("canvas")
    print("canvases on page:", canvases.count())
    for key in ["h", "t", "m"]:
        page.keyboard.press(key)
        page.wait_for_timeout(150)
        tool = page.evaluate("(() => { const b = document.querySelector('[class*=tool][class*=active], button.active[class*=tool]'); return b ? b.className : 'no-active-tool-btn' })()")
        print(f"after '{key}': active tool btn =", tool)

    # Click-click place an hline on the main canvas
    box = canvases.first.bounding_box()
    if box:
        cx, cy = box["x"] + box["width"]/2, box["y"] + box["height"]/2
        page.keyboard.press("h")
        page.mouse.click(cx, cy)
        page.mouse.click(cx, cy + 30)
        page.wait_for_timeout(300)
        print("hline placed, checking console so far...")

    # Shift+drag zoom
    if box:
        page.keyboard.down("Shift")
        page.mouse.move(box["x"] + 100, box["y"] + box["height"]/2)
        page.mouse.down()
        page.mouse.move(box["x"] + 400, box["y"] + box["height"]/2, steps=5)
        page.mouse.up()
        page.keyboard.up("Shift")
        page.wait_for_timeout(400)
        print("shift+drag zoom done")

    # Toggle indicator button if present
    ind_btns = page.locator("[data-opt], [class*=toggle] button, button[aria-pressed]")
    print("indicator toggle buttons:", ind_btns.count())
    if ind_btns.count():
        ind_btns.first.click()
        page.wait_for_timeout(300)

    # Autoplay
    page.keyboard.press("a")
    page.wait_for_timeout(1000)
    ap = page.evaluate("(() => { const els=[...document.querySelectorAll('[class*=autoplay],[class*=ring]')]; const v=els.filter(e=>e.offsetParent!==null); return v.length? v[0].className : 'none-visible' })()")
    print("autoplay indicator after A:", ap)
    page.keyboard.press("a")  # stop

    # Export PNG: look for export button
    exp = page.locator("button:has-text('PNG'), [class*=export], [title*=PNG i]")
    print("export PNG buttons:", exp.count())

    # Full cycle through slides with dots
    browser.close()

print("\n=== CONSOLE errors/warnings ===")
for t, m in console_msgs:
    print(f"[{t}] {m}")
if not console_msgs:
    print("(none)")
print("\n=== PAGE ERRORS ===")
for e in page_errors:
    print(e)
if not page_errors:
    print("(none)")
print("\n=== FAILED REQUESTS ===")
for r in failed_reqs:
    print(r)
if not failed_reqs:
    print("(none)")
