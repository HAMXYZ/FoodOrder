import { test, expect, type Page, type Locator } from "@playwright/test"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { ApiDish } from "../../lib/menu-api"
import { formatVND, SHIPPING_FEE } from "../../lib/menu-data"

test.use({ actionTimeout: 10_000 })
const origin = "http://127.0.0.1:3000"
const project = resolve(__dirname, "../../..")
const addEndpoint = "/api/interactions/add-to-cart"
type Customer = { name: string; email: string; password: string }
type Audit = { base: Record<string, string>; events: Record<string, string>; totals: Record<string, number> }
let customer: Customer
let dishes: ApiDish[]
let initial: Audit
let setupAdds = 0

function audit(): Audit {
  const result = execFileSync(join(project, "BE/.venv/bin/python"), ["-B", "-c", `
import asyncio, hashlib, json, sys
from sqlalchemy import select, func
import models
from database import engine
from init_database import validate_target, verify_connection
async def run():
 try:
  validate_target(engine.url, models.Base.metadata)
  async with engine.connect() as connection:
   await verify_connection(connection)
   result = {"base": {}, "events": {}}
   for table in models.Base.metadata.sorted_tables:
    rows = (await connection.execute(select(table).order_by(*table.primary_key.columns))).all()
    if table.name == "user_interactions":
     result["events"] = {str(row.event_id): hashlib.sha256(json.dumps(list(row), default=str).encode()).hexdigest() for row in rows}
    else: result["base"][table.name] = hashlib.sha256(json.dumps([list(row) for row in rows], default=str).encode()).hexdigest()
   result["totals"] = dict((await connection.execute(select(models.UserInteraction.event_type, func.count()).group_by(models.UserInteraction.event_type))).all())
   print(json.dumps(result))
 finally: await engine.dispose()
try: asyncio.run(run())
except Exception: sys.exit(1)
`], { cwd: join(project, "BE"), stdio: "pipe" })
  return JSON.parse(result.toString())
}

test.beforeAll(async () => {
  initial = audit() // Read-only verification of foodorder_dev before any live test action.
  const directory = join(homedir(), ".cache", "foodorder-auth-e2e", createHash("sha256").update(project).digest("hex").slice(0, 12))
  customer = JSON.parse(readFileSync(join(directory, "accounts.json"), "utf8"))[0]
  const response = await fetch("http://127.0.0.1:8000/api/dishes")
  expect(response.status).toBe(200)
  dishes = await response.json()
  expect(dishes.length).toBeGreaterThanOrEqual(2)
})

test.afterAll(() => {
  if (!initial) return
  const final = audit()
  expect(final.base).toEqual(initial.base)
  for (const [id, digest] of Object.entries(initial.events)) expect(final.events[id]).toBe(digest)
  expect(final.totals.view || 0).toBe(initial.totals.view || 0)
  expect(final.totals.purchase || 0).toBe(initial.totals.purchase || 0)
  expect((final.totals.add_to_cart || 0) - (initial.totals.add_to_cart || 0)).toBe(setupAdds)
  console.log(`US3.2: quantity edits emitted no events; authenticated setup adds=${setupAdds}; all 8 base tables and ${Object.keys(initial.events).length} original events unchanged.`)
})

function scenario(title: string, work: (page: Page) => Promise<void>) {
  test(title, async ({ page }) => {
    try { await work(page) }
    catch (error) {
      let message = error instanceof Error ? error.message : "Unknown failure"
      if (customer?.password) message = message.split(customer.password).join("[redacted]")
      throw new Error(`US3.2: ${message}`)
    }
  })
}

async function guest(page: Page) {
  await page.goto(origin, { waitUntil: "networkidle" })
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible()
}
const badge = (page: Page, count: number) => page.getByRole("button", { name: `Giỏ hàng, ${count} món`, exact: true })
const addButton = (page: Page, dish = dishes[0]) => page.locator("#popular").getByRole("button", { name: `Thêm ${dish.name} vào giỏ`, exact: true })
async function add(page: Page, dish: ApiDish, count: number) {
  await addButton(page, dish).click()
  await expect(badge(page, count)).toBeVisible()
  await expect(addButton(page, dish)).toBeEnabled()
}
async function cart(page: Page, count: number) {
  await badge(page, count).click()
  return page.getByRole("dialog", { name: /^Giỏ hàng/ })
}
const lines = (drawer: Locator) => drawer.locator('section[aria-label="Món đã chọn"] > div')
const quantity = (line: Locator) => line.locator('[aria-live="polite"]')
const up = (line: Locator) => line.getByRole("button", { name: "Tăng số lượng", exact: true })
const down = (line: Locator) => line.getByRole("button", { name: "Giảm số lượng", exact: true })
async function summary(drawer: Locator, subtotal: number, shipping: number, discount = 0) {
  const amount = (label: string) => drawer.getByText(label, { exact: true }).locator("..").locator("dd")
  await expect(amount("Tạm tính")).toHaveText(formatVND(subtotal))
  await expect(amount("Phí giao hàng")).toHaveText(shipping === 0 ? "Miễn phí" : formatVND(shipping))
  if (discount) await expect(amount("Giảm giá")).toHaveText(`-${formatVND(discount)}`)
  await expect(amount("Tổng cộng")).toHaveText(formatVND(subtotal + shipping - discount))
}
async function clicks(button: Locator, count: number) {
  // A burst in a single JS task exposes stale-prop updates hidden by awaited clicks.
  await button.evaluate((element, times) => {
    for (let i = 0; i < times; i++) (element as HTMLButtonElement).click()
  }, count)
}
function observe(page: Page) {
  const requests: string[] = []
  page.on("request", request => {
    const path = new URL(request.url()).pathname
    if (path.startsWith("/api/dishes/") || path.startsWith("/api/interactions/")) requests.push(path)
  })
  return requests
}

scenario("1 -> 2 -> 1 updates line price, subtotal, total and badge without changing another dish", async page => {
  await guest(page)
  await add(page, dishes[0], 1)
  await add(page, dishes[1], 2)
  const drawer = await cart(page, 2)
  const first = lines(drawer).filter({ hasText: dishes[0].name })
  const other = lines(drawer).filter({ hasText: dishes[1].name })
  const requests = observe(page)
  for (const count of [2, 1]) {
    await (count === 2 ? up(first) : down(first)).click()
    await expect(quantity(first)).toHaveText(String(count))
    await expect(first.getByText(formatVND(dishes[0].base_price * count), { exact: true })).toBeVisible()
    await expect(quantity(other)).toHaveText("1")
    await expect(other.getByText(formatVND(dishes[1].base_price), { exact: true })).toBeVisible()
    await expect(badge(page, count + 1)).toBeVisible()
    await expect(drawer.getByRole("heading")).toContainText(`(${count + 1})`)
    const subtotal = dishes[0].base_price * count + dishes[1].base_price
    await summary(drawer, subtotal, subtotal >= 150000 ? 0 : SHIPPING_FEE)
  }
  await expect(lines(drawer)).toHaveCount(2)
  expect(requests).toHaveLength(0)
})

scenario("different option sets of the same dish keep independent quantities and unit prices", async page => {
  await guest(page)
  await add(page, dishes[0], 1)
  await page.locator("#popular").getByRole("button", { name: dishes[0].name, exact: true }).click()
  const detail = page.getByRole("dialog")
  await expect(detail.getByRole("button", { name: /Thêm vào giỏ hàng/ })).toBeEnabled()
  await detail.getByText("Lớn", { exact: true }).click()
  await detail.getByText("Trứng ốp la", { exact: true }).click()
  await detail.getByText("Phô mai", { exact: true }).click()
  await detail.getByLabel("Ghi chú cho bếp").fill("Ít cay")
  await detail.getByRole("button", { name: /Thêm vào giỏ hàng/ }).click()
  await expect(detail).toHaveCount(0)
  const drawer = await cart(page, 2)
  const plain = lines(drawer).filter({ hasText: "Size S" })
  const custom = lines(drawer).filter({ hasText: "Ít cay" })
  await up(custom).click()
  await expect(quantity(custom)).toHaveText("2")
  await expect(quantity(plain)).toHaveText("1")
  const unit = dishes[0].base_price + 20000 + 7000 + 10000
  await expect(custom.getByText(formatVND(unit * 2), { exact: true })).toBeVisible()
  await up(plain).click()
  await expect(quantity(plain)).toHaveText("2")
  await expect(quantity(custom)).toHaveText("2")
  await expect(badge(page, 4)).toBeVisible()
  const subtotal = (unit + dishes[0].base_price) * 2
  await summary(drawer, subtotal, subtotal >= 150000 ? 0 : SHIPPING_FEE)
  await expect(lines(drawer)).toHaveCount(2)
})

scenario("decrement at 1 never removes the line; increment at 99 never overflows", async page => {
  await guest(page)
  await page.locator("#popular").getByRole("button", { name: dishes[0].name, exact: true }).click()
  const detail = page.getByRole("dialog")
  await expect(detail.getByRole("button", { name: /Thêm vào giỏ hàng/ })).toBeEnabled()
  await up(detail).evaluate(async element => {
    const counter = element.parentElement!.querySelector("span")!
    for (let value = 2; value <= 99; value++) {
      ;(element as HTMLButtonElement).click()
      while (counter.textContent !== String(value)) await new Promise(requestAnimationFrame)
    }
  })
  await detail.getByRole("button", { name: /Thêm vào giỏ hàng/ }).click()
  await expect(detail).toHaveCount(0)
  const drawer = await cart(page, 99)
  const line = lines(drawer)
  await expect(up(line)).toBeDisabled()
  await clicks(up(line), 3)
  await expect(quantity(line)).toHaveText("99")
  await down(line).click()
  await expect(quantity(line)).toHaveText("98")
  await expect(up(line)).toBeEnabled()
  await up(line).click()
  await expect(quantity(line)).toHaveText("99")
  await clicks(down(line), 120)
  await expect(quantity(line)).toHaveText("1")
  await expect(down(line)).toBeDisabled()
  await clicks(down(line), 3)
  await expect(lines(drawer)).toHaveCount(1)
  await expect(quantity(line)).toHaveText("1")
  await expect(badge(page, 1)).toBeVisible()
})

scenario("rapid batched increments and decrements retain every update and other lines", async page => {
  await guest(page)
  await add(page, dishes[0], 1)
  await add(page, dishes[1], 2)
  const drawer = await cart(page, 2)
  const first = lines(drawer).filter({ hasText: dishes[0].name })
  const other = lines(drawer).filter({ hasText: dishes[1].name })
  await clicks(up(first), 30)
  await expect(quantity(first)).toHaveText("31")
  await clicks(down(first), 10)
  await expect(quantity(first)).toHaveText("21")
  await expect(quantity(other)).toHaveText("1")
  await expect(badge(page, 22)).toBeVisible()
  const subtotal = dishes[0].base_price * 21 + dishes[1].base_price
  await summary(drawer, subtotal, 0)
})

scenario("quantity edits work offline without catalog requests or telemetry", async page => {
  await guest(page)
  await add(page, dishes[0], 1)
  const drawer = await cart(page, 1)
  const line = lines(drawer)
  const requests = observe(page)
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.context().setOffline(true)
  try {
    await up(line).click()
    await expect(quantity(line)).toHaveText("2")
    await down(line).click()
    await expect(quantity(line)).toHaveText("1")
    await expect(badge(page, 1)).toBeVisible()
    await summary(drawer, dishes[0].base_price, SHIPPING_FEE)
    expect(requests).toHaveLength(0)
    expect(errors).toHaveLength(0)
  } finally { await page.context().setOffline(false) }
})

scenario("authenticated quantity edits never emit add_to_cart or alter the original event", async page => {
  await guest(page)
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  const auth = page.getByRole("dialog")
  await auth.getByLabel("Email", { exact: true }).fill(customer.email)
  await auth.getByLabel("Mật khẩu", { exact: true }).fill(customer.password)
  await auth.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await expect(page.getByRole("button", { name: customer.name, exact: true })).toBeVisible()
  const committed = page.waitForResponse(response => new URL(response.url()).pathname === addEndpoint && response.status() === 201)
  await add(page, dishes[0], 1)
  await committed
  setupAdds++
  const before = audit()
  const drawer = await cart(page, 1)
  const requests = observe(page)
  await clicks(up(lines(drawer)), 20)
  await expect(quantity(lines(drawer))).toHaveText("21")
  await clicks(down(lines(drawer)), 20)
  await expect(quantity(lines(drawer))).toHaveText("1")
  await page.waitForTimeout(600)
  expect(requests).toHaveLength(0)
  expect(audit()).toEqual(before)
})

scenario("an async add finishing later preserves quantities edited while it was pending", async page => {
  await guest(page)
  await add(page, dishes[1], 1)
  let release!: () => void
  let entered!: () => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/api/dishes/${dishes[0].id}`, async route => {
    const response = await route.fetch()
    entered()
    await gate
    await route.fulfill({ response })
  })
  try {
    await addButton(page).click()
    await waiting
    const drawer = await cart(page, 1)
    await clicks(up(lines(drawer)), 4)
    await expect(quantity(lines(drawer))).toHaveText("5")
    release()
    await expect(badge(page, 6)).toBeVisible()
    await expect(lines(drawer)).toHaveCount(2)
    await expect(quantity(lines(drawer).filter({ hasText: dishes[1].name }))).toHaveText("5")
    await expect(quantity(lines(drawer).filter({ hasText: dishes[0].name }))).toHaveText("1")
  } finally { release() }
})

scenario("shipping thresholds and an existing voucher recalculate as quantities change", async page => {
  await guest(page)
  await add(page, dishes[0], 1)
  const drawer = await cart(page, 1)
  await drawer.getByLabel("Mã giảm giá", { exact: true }).fill("FOODAI20")
  await drawer.getByRole("button", { name: "Áp dụng", exact: true }).click()
  const base = dishes[0].base_price
  await summary(drawer, base, SHIPPING_FEE, Math.round(base * 0.2))
  await clicks(up(lines(drawer)), 15)
  await expect(quantity(lines(drawer))).toHaveText("16")
  await summary(drawer, base * 16, 0, 30000)
  await clicks(down(lines(drawer)), 15)
  await expect(quantity(lines(drawer))).toHaveText("1")
  await summary(drawer, base, SHIPPING_FEE, Math.round(base * 0.2))
  await expect(badge(page, 1)).toBeVisible()
})
