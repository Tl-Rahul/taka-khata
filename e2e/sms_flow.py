"""E2E for SMS import: paste, share-target URL, approve, edit, ignore, dedupe."""
import asyncio, os, re, sys, datetime as dt
from urllib.parse import quote
from playwright.async_api import async_playwright, expect

BASE = os.environ.get("BASE", "http://localhost:3000")
SHOTS = os.environ.get("SHOTS", "/tmp/shots")
EMAIL = f"sms{int(dt.datetime.now().timestamp())}@test.local"
fails = []


def check(c, label):
    print(("  ✓ " if c else "  ✗ ") + label)
    if not c:
        fails.append(label)


SEND = "Send Money Tk 500.00 to 01812345678 successful. Ref lunch. Fee Tk 5.00. Balance Tk 2,745.50. TrxID BJ12KLM99Z at 12/10/2026 15:01"
CASHOUT = "Cash Out Tk 1,000.00 to 01912345678 successful. Fee Tk 18.50. Balance Tk 1,727.00. TrxID BJC9XY1234 at 11/10/2026 10:15"
RECV = "You have received Tk 1,500.00 from 01712345678. Ref rent. Fee Tk 0.00. Balance Tk 3,250.50. TrxID BJ12KLM34N at 12/10/2026 14:30"
OTP = "Your bKash verification code is 123456."
BANK = "Your A/C XXXX9999 has been debited by BDT 2,000.00 on 08-Oct-2026 for POS purchase. Avl Bal BDT 45,000.00."


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1280, "height": 900})
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))

        # share link before login: must survive the login redirect
        await page.goto(f"{BASE}/sms?text={quote(RECV)}")
        await page.wait_for_url(re.compile(r"/login"))
        check("next=%2Fsms%3Ftext" in page.url, "login keeps the shared SMS in the redirect")
        await page.get_by_role("radio", name="EN").click()
        await page.get_by_role("button", name="Create an account").click()
        await page.fill("#email", EMAIL)
        await page.fill("#password", "password123")
        await page.get_by_role("button", name="Create account").click()
        await page.wait_for_url(BASE + "/")
        await page.goto(f"{BASE}/settings")
        await page.get_by_role("radio", name="English").click()
        await page.wait_for_timeout(500)

        for typ, name, ob in [("cash", "Cash", "2000"), ("bkash", "bKash", "5000")]:
            await page.goto(f"{BASE}/accounts")
            await page.get_by_role("button", name="Add account").first.click()
            await page.select_option("#acc-type", typ)
            await page.fill("#acc-name", name)
            await page.fill("#acc-ob", ob)
            await page.get_by_role("dialog").locator("button[type=submit]").click()
            await expect(page.get_by_role("dialog")).to_be_hidden()

        # share target
        await page.goto(f"{BASE}/sms?text={quote(RECV)}")
        await expect(page.get_by_text("1 SMS added")).to_be_visible(timeout=10000)
        try:
            await page.wait_for_url(BASE + "/sms", timeout=5000)
        except Exception:
            pass
        check("/sms?" not in page.url, "share link cleaned up after import")

        # paste several (with OTP and a duplicate of the shared one)
        await page.fill("#sms-paste", f"{SEND}\n\n{CASHOUT}\n\n{OTP}\n\n{RECV}\n\n{BANK}")
        await page.get_by_role("button", name="Read messages").click()
        await expect(page.get_by_text("3 SMS added")).to_be_visible(timeout=10000)
        t = await page.inner_text("main")
        check("To review (4)" in t, "4 pending (OTP skipped, duplicate skipped)")
        check("Review & add" in t, "bank SMS without a matching account needs review")
        await page.screenshot(path=f"{SHOTS}/30_sms_inbox.png", full_page=True)

        # add all ready ones (3 bKash)
        await page.get_by_role("button", name=re.compile(r"Add 3 ready")).click()
        await expect(page.get_by_text("3 transactions added")).to_be_visible(timeout=15000)

        # ignore the bank one
        await page.locator("main li").filter(has_text="Bank").get_by_role("button", name="Ignore").click()
        await page.wait_for_timeout(500)
        t = await page.inner_text("main")
        check("To review (0)" in t, "inbox empty after approve + ignore")

        await page.goto(f"{BASE}/accounts")
        await page.wait_for_timeout(800)
        t = await page.inner_text("main")
        # bKash 5000 + 1500 - 505 - 1018.50 = 4976.50 ; Cash 2000 + 1000 = 3000
        check("৳4,976.50" in t, "bKash balance 4,976.50 (receive, send+fee, cash-out+fee)")
        check("৳3,000" in t, "cash-out moved 1,000 to Cash in hand")

        # same SMS again: no double count
        await page.goto(f"{BASE}/sms")
        await page.fill("#sms-paste", SEND)
        await page.get_by_role("button", name="Read messages").click()
        await expect(page.get_by_text("already in the list")).to_be_visible(timeout=10000)
        check(True, "re-pasting an imported SMS does nothing")

        await page.get_by_role("radio", name="History").click()
        await page.wait_for_timeout(300)
        await page.screenshot(path=f"{SHOTS}/31_sms_history.png", full_page=True)

        # mobile look
        m = await (await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, storage_state=await ctx.storage_state())).new_page()
        await m.goto(f"{BASE}/sms")
        await m.fill("#sms-paste", BANK.replace("9999", "1111").replace("2,000.00", "750.00"))
        await m.get_by_role("button", name="Read messages").click()
        await m.wait_for_timeout(1200)
        await m.screenshot(path=f"{SHOTS}/32_sms_mobile.png", full_page=True)
        # complete it via the form
        await m.get_by_role("button", name="Review & add").click()
        d = m.get_by_role("dialog").last
        await d.wait_for()
        v = await m.eval_on_selector("#tx-account", "el => [...el.options].find(o => o.textContent.includes('Cash')).value")
        await m.select_option("#tx-account", v)
        v = await m.eval_on_selector("#tx-cat", "el => [...el.options].find(o => o.textContent.includes('Shopping')).value")
        await m.select_option("#tx-cat", v)
        await d.locator("button[type=submit]").click()
        await expect(d).to_be_hidden(timeout=10000)
        await m.wait_for_timeout(600)
        t = await m.inner_text("main")
        check("(0)" in t, "edited SMS marked as added after saving the form")

        check(not errs, f"no page errors {errs[:3]}")
        await b.close()
    print("\nALL SMS CHECKS PASSED" if not fails else f"\nFAILED: {fails}")
    sys.exit(1 if fails else 0)


asyncio.run(main())
