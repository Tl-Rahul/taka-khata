import { describe, expect, it } from "vitest";
import { parseSms, isTransactionSms, suggestTransaction, splitMessages, smsHash } from "../smsParser";
import { account, category } from "./fixtures";

const S = {
  bkashReceived: "You have received Tk 1,500.00 from 01712345678. Ref rent. Fee Tk 0.00. Balance Tk 3,250.50. TrxID BJ12KLM34N at 12/10/2026 14:30",
  bkashSend: "Send Money Tk 500.00 to 01812345678 successful. Ref lunch. Fee Tk 5.00. Balance Tk 2,745.50. TrxID BJ12KLM99Z at 12/10/2026 15:01",
  bkashCashOut: "Cash Out Tk 1,000.00 to 01912345678 successful. Fee Tk 18.50. Balance Tk 1,727.00. TrxID BJC9XY1234 at 11/10/2026 10:15",
  bkashPayment: "Payment Tk 250.00 to Shwapno successful. Fee Tk 0.00. Balance Tk 1,477.00. TrxID BJP1234567 at 10/10/2026 19:45",
  bkashRecharge: "Mobile Recharge Tk 100.00 to 01712345678 successful. Balance Tk 1,377.00. TrxID BJR7654321 at 10/10/2026 09:00",
  nagadReceived: "Money Received. Amount: Tk 2,000.00 Sender: 01611111111 Ref: N/A TxnID: 7AB3CD9E Balance: Tk 4,500.00 09/10/2026 18:22",
  nagadCashOut: "Cash Out Tk 500.00 from 01600000000 successful. Fee: Tk 6.25 TxnID: 7XYZ1234 Balance: Tk 3,993.75 09/10/2026 20:00",
  bankDebit: "Your A/C XXXX4521 has been debited by BDT 5,000.00 on 08-Oct-2026 for ATM withdrawal. Avl Bal BDT 45,000.00. Ref 998877AB",
  bankCredit: "Dear Customer, your A/C **4521 is credited with BDT 60,000.00 on 01-10-2026 (SALARY OCT). Available Balance BDT 1,05,000.00",
  otp: "Your bKash verification code is 123456. Do not share it with anyone.",
  promo: "Get 20% cashback on bKash payment at Shwapno! Offer valid till 30 Oct.",
};

describe("sms parser", () => {
  it("filters out OTP and promotions", () => {
    expect(isTransactionSms(S.otp)).toBe(false);
    expect(isTransactionSms(S.promo)).toBe(false);
    expect(isTransactionSms(S.bkashSend)).toBe(true);
    expect(isTransactionSms(S.bankDebit)).toBe(true);
  });

  it("reads bKash messages", () => {
    const r = parseSms(S.bkashReceived);
    expect(r).toMatchObject({ provider: "bkash", kind: "received", direction: "in", amount: 1500_00, fee: 0, balance: 3250_50, trxId: "BJ12KLM34N", counterparty: "01712345678", date: "2026-10-12", confidence: "high" });
    expect(parseSms(S.bkashSend)).toMatchObject({ kind: "sent", direction: "out", amount: 500_00, fee: 5_00, balance: 2745_50 });
    expect(parseSms(S.bkashCashOut)).toMatchObject({ kind: "cash_out", amount: 1000_00, fee: 18_50, date: "2026-10-11" });
    expect(parseSms(S.bkashPayment)).toMatchObject({ kind: "payment", amount: 250_00, counterparty: "Shwapno" });
    expect(parseSms(S.bkashRecharge)).toMatchObject({ kind: "recharge", amount: 100_00 });
  });

  it("reads Nagad messages", () => {
    expect(parseSms(S.nagadReceived)).toMatchObject({ provider: "nagad", kind: "received", amount: 2000_00, balance: 4500_00, trxId: "7AB3CD9E", date: "2026-10-09" });
    expect(parseSms(S.nagadCashOut)).toMatchObject({ provider: "nagad", kind: "cash_out", amount: 500_00, fee: 6_25 });
  });

  it("reads bank alerts", () => {
    expect(parseSms(S.bankDebit)).toMatchObject({ provider: "bank", direction: "out", amount: 5000_00, balance: 45000_00, last4: "4521", date: "2026-10-08" });
    expect(parseSms(S.bankCredit)).toMatchObject({ provider: "bank", kind: "salary", direction: "in", amount: 60000_00, last4: "4521", date: "2026-10-01" });
  });

  it("reads Bangla digits", () => {
    expect(parseSms("You have received Tk ৫০০.০০ from 01712345678. TrxID ABC12345XY").amount).toBe(500_00);
  });

  it("splits pasted text with several SMS", () => {
    expect(splitMessages(`${S.bkashSend}\n\n${S.bkashCashOut}`)).toHaveLength(2);
  });

  it("suggests the right ledger entry", () => {
    const bkash = account({ name: "bKash", type: "bkash" });
    const cash = account({ name: "Cash", type: "cash" });
    const bank = account({ name: "DBBL", type: "bank", last4: "4521" });
    const cats = [
      category({ name: "Other income", kind: "income" }),
      category({ name: "Salary", kind: "income" }),
      category({ name: "Other expense" }),
      category({ name: "Mobile recharge" }),
    ];
    const ctx = { accounts: [bkash, cash, bank], categories: cats, today: "2026-10-12" };
    const co = suggestTransaction(parseSms(S.bkashCashOut), S.bkashCashOut, ctx)!;
    expect(co).toMatchObject({ type: "transfer", accountId: bkash.id, toAccountId: cash.id, amount: 1000_00, fee: 18_50 });
    const send = suggestTransaction(parseSms(S.bkashSend), S.bkashSend, ctx)!;
    expect(send).toMatchObject({ type: "expense", accountId: bkash.id, amount: 505_00 });
    const sal = suggestTransaction(parseSms(S.bankCredit), S.bankCredit, ctx)!;
    expect(sal).toMatchObject({ type: "income", accountId: bank.id, categoryId: cats[1].id });
    const rc = suggestTransaction(parseSms(S.bkashRecharge), S.bkashRecharge, ctx)!;
    expect(rc.categoryId).toBe(cats[3].id);
  });

  it("gives the same SMS the same hash (no double import)", () => {
    const p = parseSms(S.bkashSend);
    expect(smsHash(p, S.bkashSend)).toBe(smsHash(parseSms(S.bkashSend + "  "), S.bkashSend + "  "));
    expect(smsHash(p, S.bkashSend)).toBe("sms:bkash:BJ12KLM99Z");
  });
});
