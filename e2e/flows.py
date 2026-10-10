"""
End-to-end test: drives the real UI in a headless browser against the local stack
(real Postgres + RLS) and checks that every number matches the accounting rules.

  python3 e2e/flows.py            # needs: local stack on :54321, app on :3000
"""
import asyncio, json, os, re, sys, datetime as dt
from playwright.async_api import async_playwright, expect, Page

BASE = os.environ.get("BASE", "http://localhost:3000")
SHOTS = os.environ.get("SHOTS", "/tmp/shots")
os.makedirs(SHOTS, exist_ok=True)
TODAY = dt.date.today()
EMAIL = f"e2e{int(dt.datetime.now().timestamp())}@test.local"
failures = []


def check(cond, label):
    print(("  ✓ " if cond else "  ✗ ") + label)
    if not cond:
        failures.append(label)


def tk(n):
    """format like the app in English: ৳1,23,456 (lakh grouping)"""
    neg = n < 0
    n = abs(n)
    whole = int(n)
    frac = round((n - whole) * 100)
    s = str(whole)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", head)
        s = head + "," + tail
    out = f"৳{s}" + (f".{frac:02d}" if frac else "")
    return ("-" if neg else "") + out


async def select_text(page: Page, selector: str, text: str):
    """choose the <option> whose text contains `text`"""
    value = await page.eval_on_selector(
        selector,
        "(el, t) => { const o = [...el.options].find(o => o.textContent.includes(t)); return o ? o.value : null }",
        text,
    )
    assert value is not None, f"option '{text}' not found in {selector}"
    await page.select_option(selector, value)


async def click_center(loc):
    """scroll to the middle of the screen first, so sticky headers don't cover the target"""
    await loc.evaluate("el => el.scrollIntoView({block: 'center'})")
    await loc.click()


async def dialog(page):
    d = page.get_by_role("dialog").last
    await d.wait_for()
    return d


async def save_dialog(page, button_text=None):
    d = page.get_by_role("dialog").last
    if button_text:
        await d.get_by_role("button", name=button_text, exact=True).click()
    else:
        await d.locator("button[type=submit]").click()
    try:
        await expect(d).to_be_hidden(timeout=10000)
    except AssertionError:
        await page.screenshot(path=f"{SHOTS}/dbg_dialog.png")
        print("DIALOG TEXT:", (await d.inner_text())[-600:])
        raise


async def quick(page, label):
    await page.get_by_role("button", name="Quick add").first.click()
    d = await dialog(page)
    await d.get_by_role("button", name=label, exact=True).click()
    return await dialog(page)


async def add_account(page, typ, name, opening):
    await page.goto(f"{BASE}/accounts")
    await page.get_by_role("button", name="Add account").first.click()
    await dialog(page)
    await page.select_option("#acc-type", typ)
    await page.fill("#acc-name", name)
    await page.fill("#acc-ob", str(opening))
    await save_dialog(page)
    await expect(page.get_by_text(name, exact=True).first).to_be_visible()


async def text_of(page, url):
    await page.goto(url)
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(300)
    return await page.inner_text("main")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_TUNNEL" not in m.text else None)

        print("auth")
        await page.goto(BASE)
        await page.wait_for_url("**/login")
        await page.get_by_role("radio", name="EN").click()
        await page.get_by_role("button", name="Create an account").click()
        await page.fill("#email", EMAIL)
        await page.fill("#password", "short")
        await page.get_by_role("button", name="Create account").click()
        await expect(page.get_by_text("at least 8 characters").first).to_be_visible()
        await page.fill("#password", "password123")
        await page.get_by_role("button", name="Create account").click()
        await page.wait_for_url(BASE + "/")
        check(True, "sign up lands on dashboard")

        print("settings: English, Latin digits")
        await page.goto(f"{BASE}/settings")
        await page.get_by_role("radio", name="English").click()
        await expect(page.get_by_text("Preferences")).to_be_visible()
        check(True, "language switched to English")

        print("accounts")
        await add_account(page, "cash", "Cash", 5000)
        await add_account(page, "bank", "DBBL", 50000)
        await add_account(page, "bkash", "bKash", 2000)
        await add_account(page, "credit_card", "Visa", 3000)
        await add_account(page, "fixed_deposit", "FDR", 100000)
        t = await page.inner_text("main")
        check(tk(57000) in t, f"available after openings = {tk(57000)}")
        check(tk(-3000) in t, "credit card opening stored as owed (-3,000)")
        await page.screenshot(path=f"{SHOTS}/10_accounts.png", full_page=True)

        print("transactions")
        d = await quick(page, "Expense")
        await page.fill("#tx-amount", "450")
        await select_text(page, "#tx-cat", "Groceries")
        await select_text(page, "#tx-account", "Cash")
        await page.fill("#tx-desc", "Bazar")
        await page.screenshot(path=f"{SHOTS}/11_expense_form.png")
        await save_dialog(page)

        d = await quick(page, "Income")
        await page.fill("#tx-amount", "60,000")
        await select_text(page, "#tx-cat", "Salary")
        await select_text(page, "#tx-account", "DBBL")
        await save_dialog(page)

        d = await quick(page, "Transfer")
        await page.fill("#tx-amount", "10000")
        await select_text(page, "#tx-account", "DBBL")
        await select_text(page, "#tx-to", "bKash")
        await d.get_by_role("button", name="+ Add a charge or fee").click()
        await page.fill("#tx-fee", "15")
        await save_dialog(page)

        d = await quick(page, "Money borrowed")
        await page.fill("#tx-amount", "20000")
        await page.fill("#loan-person", "Karim")
        await page.fill("#loan-due", (TODAY + dt.timedelta(days=90)).isoformat())
        await page.select_option("#loan-int", "simple_annual")
        await page.fill("#loan-rate", "12")
        await select_text(page, "#tx-account", "DBBL")
        await save_dialog(page)

        d = await quick(page, "Debt repayment")
        await select_text(page, "#tx-loan", "Karim")
        await page.fill("#tx-amount", "5000")
        await page.fill("#tx-interest", "200")
        await select_text(page, "#tx-account", "DBBL")
        await save_dialog(page)

        d = await quick(page, "Money lent")
        await page.fill("#tx-amount", "3000")
        await page.fill("#loan-person", "Rahim")
        await select_text(page, "#tx-account", "Cash")
        await save_dialog(page)

        d = await quick(page, "Money collected")
        await select_text(page, "#tx-loan", "Rahim")
        await page.fill("#tx-amount", "1000")
        await page.fill("#tx-interest", "50")
        await select_text(page, "#tx-account", "bKash")
        await save_dialog(page)

        d = await quick(page, "Expense")
        await page.fill("#tx-amount", "2000")
        await select_text(page, "#tx-cat", "Clothing")
        await select_text(page, "#tx-account", "Visa")
        await page.fill("#tx-desc", "Panjabi")
        await save_dialog(page)

        d = await quick(page, "Refund")
        await select_text(page, "#tx-refund", "Panjabi")
        await page.fill("#tx-amount", "500")
        await save_dialog(page)

        # duplicate warning, then save anyway, then delete it
        d = await quick(page, "Expense")
        await page.fill("#tx-amount", "450")
        await select_text(page, "#tx-cat", "Groceries")
        await select_text(page, "#tx-account", "Cash")
        await d.locator("button[type=submit]").click()
        await expect(d.get_by_text("already exists")).to_be_visible()
        check(True, "duplicate warning shown before saving")
        await d.get_by_role("button", name="Save anyway").click()
        await expect(d).to_be_hidden()

        await page.goto(f"{BASE}/transactions")
        await expect(page.get_by_text("Bazar").first).to_be_visible()
        rows = page.locator("main li").filter(has_text="Groceries")
        check(await rows.count() >= 1, "list shows groceries rows")
        # delete the duplicate (the one without description)
        await click_center(page.locator("main li").filter(has_text="Food & Dining › Groceries").filter(has_not_text="Bazar").first.locator("button").first)
        d = await dialog(page)
        await d.get_by_role("button", name="Delete").click()
        conf = page.get_by_role("dialog").last
        await conf.get_by_role("button", name="Delete").click()
        await page.wait_for_timeout(500)

        # edit Bazar 450 -> 400
        await click_center(page.get_by_text("Bazar").first)
        await dialog(page)
        await page.fill("#tx-amount", "400")
        await save_dialog(page)

        # reconcile cash to 1,500
        d = await quick(page, "Fix a balance")
        await select_text(page, "#tx-account", "Cash")
        cur = await d.inner_text()
        check(tk(1600) in cur, f"reconcile shows current cash {tk(1600)}")
        await page.fill("#tx-target", "1500")
        await save_dialog(page)

        print("bills")
        await page.goto(f"{BASE}/bills")
        await page.get_by_role("button", name="Add schedule").first.click()
        await dialog(page)
        await page.fill("#r-name", "Internet")
        await page.fill("#r-amt", "1200")
        await select_text(page, "#r-cat", "Internet")
        await select_text(page, "#r-acc", "bKash")
        await page.fill("#r-start", (TODAY - dt.timedelta(days=5)).isoformat())
        await save_dialog(page)
        main_txt = await page.inner_text("main")
        check("Overdue" in main_txt, "bill past its date shows as overdue (not auto-paid)")
        nwt = await text_of(page, f"{BASE}/net-worth")
        check(tk(1200) in nwt, "overdue bill counted as a liability")
        await page.goto(f"{BASE}/bills")
        await page.get_by_role("button", name="Record payment").first.click()
        d = await dialog(page)
        await save_dialog(page)
        main_txt = await page.inner_text("main")
        check("Paid " in main_txt, "bill marked paid only after recording payment")
        await page.screenshot(path=f"{SHOTS}/12_bills.png", full_page=True)

        print("budgets")
        await page.goto(f"{BASE}/budgets")
        await page.get_by_role("button", name="Set budget").first.click()
        await dialog(page)
        await page.fill("#b-amt", "3000")
        await save_dialog(page)
        await page.get_by_role("button", name="Add category budget").first.click()
        await dialog(page)
        await select_text(page, "#b-cat", "Groceries")
        await page.fill("#b-amt", "500")
        await save_dialog(page)
        bt = await page.inner_text("main")
        check("Over budget" in bt, "overall budget over 100% flagged")
        check("75% used" in bt, "groceries 400/500 flagged at 75%")
        await page.screenshot(path=f"{SHOTS}/13_budgets.png", full_page=True)

        print("goals")
        await page.goto(f"{BASE}/goals")
        await page.get_by_role("button", name="New goal").first.click()
        await dialog(page)
        await page.fill("#g-name", "Emergency fund")
        await page.fill("#g-target", "50000")
        await save_dialog(page)
        await page.get_by_role("button", name="Add money").first.click()
        await dialog(page)
        await page.fill("#ge-amt", "10000")
        await save_dialog(page)
        gt = await page.inner_text("main")
        check(tk(10000) in gt and "20%" in gt, "goal progress 10,000 of 50,000 (20%)")

        print("holdings")
        await page.goto(f"{BASE}/net-worth")
        await page.get_by_role("button", name="Add asset").first.click()
        await dialog(page)
        await page.fill("#h-name", "Gold")
        await page.select_option("#h-cat", "gold")
        await page.fill("#h-val", "80000")
        await save_dialog(page)

        print("verify numbers")
        income, expense = 60050, 400 + 15 + 200 + 2000 - 500 + 1200
        cash, bank, bkash, visa, fdr = 1500, 114785, 11850, -4500, 100000
        available = cash + bank + bkash
        assets = available + fdr + 2000 + 80000
        liabilities = 4500 + 15000
        net = assets - liabilities

        t = await text_of(page, f"{BASE}/accounts")
        for name, v in [("Cash", cash), ("DBBL", bank), ("bKash", bkash), ("Visa", visa), ("FDR", fdr)]:
            check(tk(v) in t, f"{name} balance {tk(v)}")
        check(tk(available) in t, f"available {tk(available)}")

        t = await text_of(page, f"{BASE}/net-worth")
        check(tk(net) in t, f"net worth {tk(net)} (goal not double-counted)")
        check(tk(assets) in t, f"total assets {tk(assets)}")
        check(tk(liabilities) in t, f"total liabilities {tk(liabilities)}")
        check(tk(2000) in t, "receivable outstanding 2,000")
        check(tk(15000) in t, "debt principal outstanding 15,000")
        await page.screenshot(path=f"{SHOTS}/14_networth.png", full_page=True)

        t = await text_of(page, f"{BASE}/")
        check(tk(income) in t, f"dashboard income {tk(income)} (borrowing, collections principal excluded)")
        check(tk(expense) in t, f"dashboard expenses {tk(expense)} (repayment principal & transfers excluded; refund deducted)")
        check(tk(income - expense) in t, f"savings {tk(income - expense)}")
        await page.screenshot(path=f"{SHOTS}/15_dashboard.png", full_page=True)

        t = await text_of(page, f"{BASE}/debts")
        check("Karim" in t and tk(15000) in t, "debt to Karim outstanding 15,000")
        await page.locator("main a[href^='/debts/']").first.click()
        await page.wait_for_url(re.compile(r"/debts/"))
        t = await page.inner_text("main")
        check(tk(5000) in t and tk(200) in t, "repayment history separates principal 5,000 and interest 200")
        await page.screenshot(path=f"{SHOTS}/16_debt_detail.png", full_page=True)

        t = await text_of(page, f"{BASE}/receivables")
        check("Rahim" in t and tk(2000) in t, "Rahim owes 2,000 after partial collection")

        t = await text_of(page, f"{BASE}/expenses")
        check(tk(expense) in t, "expenses page total matches")
        t = await text_of(page, f"{BASE}/reports")
        check(tk(income) in t and tk(expense) in t, "report totals match")
        await page.screenshot(path=f"{SHOTS}/17_reports.png", full_page=True)

        print("filters & search")
        await page.goto(f"{BASE}/transactions")
        await page.fill("input[aria-label=Search]", "panjabi")
        await page.wait_for_timeout(300)
        t = await page.inner_text("main")
        check("Panjabi" in t and "Salary" not in t, "search filters list")

        print("exports")
        await page.goto(f"{BASE}/transactions")
        await page.get_by_role("button", name="Export").click()
        async with page.expect_download() as dl:
            await page.get_by_role("button", name="CSV").click()
        path = await (await dl.value).path()
        csv = open(path, encoding="utf-8-sig").read()
        check("Panjabi" in csv and "Amount (BDT)" in csv, "CSV export contains data")
        await page.get_by_role("button", name="Export").click()
        async with page.expect_download() as dl:
            await page.get_by_role("button", name="Excel (.xlsx)").click()
        x = await (await dl.value).path()
        check(os.path.getsize(x) > 1000, "Excel export produced a file")

        print("csv import with preview + duplicate detection")
        imp = "/tmp/import_test.csv"
        open(imp, "w").write(f"Date,Amount,Account,Category,Description\n{TODAY.isoformat()},-400,Cash,Groceries,Bazar\n{TODAY.isoformat()},-120,Cash,Transport,Rickshaw\nbad,x,Nope,,\n")
        await page.goto(f"{BASE}/import")
        await page.set_input_files("input[type=file]", imp)
        await expect(page.get_by_text("1 ready")).to_be_visible()
        t = await page.inner_text("main")
        check("Already exists" in t, "existing transaction flagged as duplicate")
        check("Unrecognised date" in t, "invalid row flagged with reason")
        await page.screenshot(path=f"{SHOTS}/18_import.png", full_page=True)
        await page.get_by_role("button", name="Import 1").click()
        conf = page.get_by_role("dialog").last
        await conf.get_by_role("button", name="Import", exact=True).click()
        await expect(page.get_by_text("1 transactions imported")).to_be_visible()
        t = await text_of(page, f"{BASE}/accounts")
        check(tk(cash - 120) in t, "imported expense updated cash balance")

        print("backup & restore")
        await page.goto(f"{BASE}/settings")
        async with page.expect_download() as dl:
            await page.get_by_role("button", name="Full backup (JSON)").click()
        bpath = await (await dl.value).path()
        backup = json.load(open(bpath))
        check(backup["app"] == "personal-finance" and len(backup["transactions"]) >= 10, "backup contains all transactions")
        n_before = len(backup["transactions"])
        # delete one transaction, then restore
        await page.goto(f"{BASE}/transactions")
        await click_center(page.get_by_text("Rickshaw").first)
        d = await dialog(page)
        await d.get_by_role("button", name="Delete").click()
        await page.get_by_role("dialog").last.get_by_role("button", name="Delete").click()
        await page.wait_for_timeout(400)
        await page.goto(f"{BASE}/settings")
        await page.set_input_files("#data input[type=file]", bpath)
        conf = page.get_by_role("dialog").last
        await conf.get_by_role("button", name="Replace and restore").click()
        try:
            await expect(page.get_by_text("Backup restored")).to_be_visible(timeout=15000)
        except AssertionError:
            await page.screenshot(path=f"{SHOTS}/dbg_restore.png")
            raise
        t = await text_of(page, f"{BASE}/transactions")
        check(f"{n_before} transactions" in t, f"restore brings back {n_before} transactions")
        t = await text_of(page, f"{BASE}/accounts")
        check(tk(cash - 120) in t, "balances identical after restore")

        print("isolation: a second user sees nothing")
        ctx2 = await browser.new_context()
        p2 = await ctx2.new_page()
        await p2.goto(f"{BASE}/login")
        await p2.get_by_role("radio", name="EN").click()
        await p2.get_by_role("button", name="Create an account").click()
        await p2.fill("#email", "other" + EMAIL)
        await p2.fill("#password", "password123")
        await p2.get_by_role("button", name="Create account").click()
        await p2.wait_for_url(BASE + "/")
        await p2.goto(f"{BASE}/transactions")
        await p2.wait_for_timeout(800)
        t2 = await p2.inner_text("main")
        check("Panjabi" not in t2 and "Karim" not in t2, "other user cannot see first user's data")
        await ctx2.close()

        print("Bangla + dark + mobile screenshots")
        await page.goto(f"{BASE}/settings")
        await page.get_by_role("radio", name="বাংলা").click()
        await page.wait_for_timeout(400)
        await page.get_by_role("radio", name="ডার্ক").click()
        await page.wait_for_timeout(400)
        mob = await browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, storage_state=await ctx.storage_state())
        m = await mob.new_page()
        for path_, name in [("/", "20_m_dashboard"), ("/transactions", "21_m_tx"), ("/accounts", "22_m_accounts"), ("/debts", "23_m_debts")]:
            await m.goto(BASE + path_)
            await m.wait_for_load_state("networkidle")
            await m.wait_for_timeout(600)
            await m.screenshot(path=f"{SHOTS}/{name}.png", full_page=True)
        await m.get_by_role("button", name="দ্রুত যোগ করুন").click()
        await m.wait_for_timeout(300)
        await m.screenshot(path=f"{SHOTS}/24_m_quickadd.png")
        await m.get_by_role("dialog").get_by_role("button", name="খরচ", exact=True).click()
        await m.wait_for_timeout(300)
        await m.screenshot(path=f"{SHOTS}/25_m_expense.png")
        await page.goto(f"{BASE}/")
        await page.wait_for_timeout(600)
        await page.screenshot(path=f"{SHOTS}/26_dark_dashboard.png", full_page=True)
        await page.get_by_role("radio", name="লাইট").count()

        print("page errors:", errors[:10])
        check(not errors, "no JavaScript errors")
        await browser.close()

    print("\nFAILED:" if failures else "\nALL E2E CHECKS PASSED", failures if failures else "")
    sys.exit(1 if failures else 0)


asyncio.run(main())
