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
let setupViews = 0

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
  expect(dishes.length).toBeGreaterThanOrEqual(3)
})

test.afterAll(() => {
  if (!initial) return
  const final = audit()
  expect(final.base).toEqual(initial.base)
  for (const [id, digest] of Object.entries(initial.events)) expect(final.events[id]).toBe(digest)
  expect((final.totals.view || 0) - (initial.totals.view || 0)).toBe(setupViews)
  expect(final.totals.purchase || 0).toBe(initial.totals.purchase || 0)
  expect((final.totals.add_to_cart || 0) - (initial.totals.add_to_cart || 0)).toBe(setupAdds)
  console.log(`US3.3: removals emitted no events; authenticated setup adds=${setupAdds}, setup views=${setupViews}; all 8 base tables and ${Object.keys(initial.events).length} original events unchanged.`)
})

function scenario(title: string, work: (page: Page) => Promise<void>) {
  test(title, async ({ page }) => {
    try { await work(page) }
    catch (error) {
      let message = error instanceof Error ? error.message : "Unknown failure"
      if (customer?.password) message = message.split(customer.password).join("[redacted]")
      throw new Error(`US3.3: ${message}`)
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

async function login(page: Page) {
  await guest(page)
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Email", { exact: true }).fill(customer.email)
  await dialog.getByLabel("Mật khẩu", { exact: true }).fill(customer.password)
  await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await expect(page.getByRole("button", { name: customer.name, exact: true })).toBeVisible()
}
const recorded = (page: Page, path = addEndpoint, status = 201) => page.waitForResponse(response =>
  new URL(response.url()).pathname === path && response.status() === status)
async function authenticatedAdd(page: Page, dish: ApiDish, count: number) {
  const response = recorded(page)
  await add(page, dish, count)
  await response
  setupAdds++
}
const remove = (line: Locator) => line.getByRole("button", { name: /^Xoá / })
async function openDish(page: Page, dish = dishes[0]) {
  await page.locator("#popular").getByRole("button", { name: dish.name, exact: true }).click()
  const detail = page.getByRole("dialog")
  await expect(detail.getByRole("button", { name: /Thêm vào giỏ hàng/ })).toBeEnabled()
  return detail
}
async function variant(page: Page, size: "L" | "M", note: string, count: number) {
  const detail = await openDish(page)
  await detail.getByText(size === "L" ? "Lớn" : "Vừa", { exact: true }).click()
  if (size === "L") await detail.getByText("Trứng ốp la", { exact: true }).click()
  await detail.getByLabel("Ghi chú cho bếp").fill(note)
  if (size === "L") await up(detail).click()
  await detail.getByRole("button", { name: /Thêm vào giỏ hàng/ }).click()
  await expect(detail).toHaveCount(0)
  await expect(badge(page, count)).toBeVisible()
}
function traffic(page: Page) {
  type Interaction = { event_id: string; dish_id: string }
  const adds: Interaction[] = []
  const views: Interaction[] = []
  page.on("request", request => {
    const path = new URL(request.url()).pathname
    if (request.method() !== "POST") return
    if (path === addEndpoint) adds.push(request.postDataJSON())
    if (path === "/api/interactions/views") views.push(request.postDataJSON())
  })
  return { adds, views }
}
async function holdCatalog(page: Page, dish: ApiDish, cancellationExpected = false) {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const waiting = new Promise<void>(resolve => { entered = resolve })
  const pattern = `**/api/dishes/${dish.id}`
  await page.route(pattern, async route => {
    try {
      const response = await route.fetch()
      entered()
      await gate
      await route.fulfill({ response })
    } catch (error) { if (!cancellationExpected) throw error }
  })
  return { release, waiting, pattern }
}
async function ignoreAbortForOneCatalogResponse(page: Page, dish: ApiDish) {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const waiting = new Promise<void>(resolve => { entered = resolve })
  await page.exposeFunction("us33DelayedResponse", async () => { entered(); await gate })
  await page.evaluate(id => {
    const original = window.fetch.bind(window)
    let held = false
    window.fetch = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname
      if (!held && path === `/api/dishes/${id}`) {
        held = true
        // Emulate a transport that delivers success even after AbortController.abort().
        const response = await original(input, { ...init, signal: undefined })
        await (window as unknown as { us33DelayedResponse: () => Promise<void> }).us33DelayedResponse()
        return response
      }
      return original(input, init)
    }
  }, dish.id)
  return { release, waiting }
}

scenario("removing a multi-quantity line preserves other dishes and recalculates prices, totals and badge", async page => {
  await guest(page)
  for (let count = 1; count <= 3; count++) await add(page, dishes[0], count)
  await add(page, dishes[1], 4)
  await add(page, dishes[2], 5)
  const drawer = await cart(page, 5)
  const requests = observe(page)
  await remove(lines(drawer).filter({ hasText: dishes[0].name })).click()
  await expect(lines(drawer)).toHaveCount(2)
  await expect(lines(drawer).filter({ hasText: dishes[0].name })).toHaveCount(0)
  for (const dish of dishes.slice(1, 3)) {
    const line = lines(drawer).filter({ hasText: dish.name })
    await expect(quantity(line)).toHaveText("1")
    await expect(line.getByText(formatVND(dish.base_price), { exact: true })).toBeVisible()
  }
  await expect(badge(page, 2)).toBeVisible()
  await expect(drawer.getByRole("heading")).toContainText("(2)")
  const subtotal = dishes[1].base_price + dishes[2].base_price
  await summary(drawer, subtotal, subtotal >= 150000 ? 0 : SHIPPING_FEE)
  expect(requests).toHaveLength(0)
})

scenario("removing one option line keeps the same dish with other sizes, toppings and notes", async page => {
  await guest(page)
  await add(page, dishes[0], 1)
  await variant(page, "L", "Ít cay", 3)
  await variant(page, "M", "Không hành", 4)
  const drawer = await cart(page, 4)
  const custom = lines(drawer).filter({ hasText: "Ít cay" })
  await expect(remove(custom)).toHaveAccessibleDescription(/Size L.*Trứng ốp la.*Ít cay/)
  await remove(custom).click()
  await expect(lines(drawer)).toHaveCount(2)
  await expect(lines(drawer).filter({ hasText: "Ít cay" })).toHaveCount(0)
  await expect(quantity(lines(drawer).filter({ hasText: "Size S" }))).toHaveText("1")
  await expect(quantity(lines(drawer).filter({ hasText: "Không hành" }))).toHaveText("1")
  await expect(badge(page, 2)).toBeVisible()
  const subtotal = dishes[0].base_price * 2 + 10000
  await summary(drawer, subtotal, subtotal >= 150000 ? 0 : SHIPPING_FEE)
})

scenario("removing the last line at quantity 99 shows an empty cart and allows a new add", async page => {
  await guest(page)
  const detail = await openDish(page)
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
  await remove(lines(drawer)).click()
  await expect(drawer.getByText("Giỏ hàng đang trống", { exact: true })).toBeVisible()
  await expect(drawer.getByRole("heading")).toContainText("(0)")
  await expect(badge(page, 0)).toBeVisible()
  await expect(drawer.getByText("Tổng cộng", { exact: true })).toHaveCount(0)
  await expect(drawer.getByRole("button", { name: /Đặt hàng ngay/ })).toHaveCount(0)
  await drawer.getByRole("button", { name: "Khám phá món ăn", exact: true }).click()
  await add(page, dishes[1], 1)
  const reopened = await cart(page, 1)
  await expect(lines(reopened)).toHaveCount(1)
  await expect(lines(reopened)).toContainText(dishes[1].name)
  await expect(down(lines(reopened))).toBeDisabled() // US3.2 still keeps quantity 1.
})

scenario("rapid repeated removals interleaved with another line's quantity edits retain every update", async page => {
  await guest(page)
  for (let i = 0; i < 3; i++) await add(page, dishes[i], i + 1)
  const drawer = await cart(page, 3)
  await drawer.evaluate((element, names) => {
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>("button"))
    const first = buttons.find(button => button.getAttribute("aria-label") === `Xoá ${names[0]}`)!
    const last = buttons.find(button => button.getAttribute("aria-label") === `Xoá ${names[2]}`)!
    const middleLine = buttons.find(button => button.getAttribute("aria-label") === `Xoá ${names[1]}`)!.closest('section[aria-label="Món đã chọn"] > div')!
    const increase = middleLine.querySelector<HTMLButtonElement>('button[aria-label="Tăng số lượng"]')!
    for (let i = 0; i < 10; i++) { first.click(); increase.click(); last.click() }
  }, dishes.slice(0, 3).map(dish => dish.name))
  await expect(lines(drawer)).toHaveCount(1)
  await expect(lines(drawer)).toContainText(dishes[1].name)
  await expect(quantity(lines(drawer))).toHaveText("11")
  await expect(badge(page, 11)).toBeVisible()
  await summary(drawer, dishes[1].base_price * 11, 0)
})

scenario("authenticated removal does not emit view/add events or delete existing interaction history", async page => {
  await login(page)
  const events = traffic(page)
  const viewed = recorded(page, "/api/interactions/views")
  const detail = await openDish(page)
  await viewed
  setupViews++
  const added = recorded(page)
  await detail.getByRole("button", { name: /Thêm vào giỏ hàng/ }).click()
  await added
  setupAdds++
  await expect(detail).toHaveCount(0)
  const before = audit()
  const drawer = await cart(page, 1)
  const requests = observe(page)
  await remove(lines(drawer)).click()
  await expect(badge(page, 0)).toBeVisible()
  await expect(drawer.getByText("Giỏ hàng đang trống", { exact: true })).toBeVisible()
  await page.waitForTimeout(600)
  expect(events.adds).toHaveLength(1)
  expect(events.views).toHaveLength(1)
  expect(requests).toHaveLength(0)
  expect(audit()).toEqual(before)
})

scenario("removal preserves a pending telemetry retry for an add that already succeeded", async page => {
  await login(page)
  const events = traffic(page)
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const waiting = new Promise<void>(resolve => { entered = resolve })
  let attempts = 0
  await page.route(`**${addEndpoint}`, async route => {
    attempts++
    if (attempts !== 1) return route.continue()
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    entered()
    await gate
    await route.fulfill({ status: 503, json: { detail: "Simulated lost success response" } })
  })
  try {
    await add(page, dishes[0], 1)
    await waiting
    setupAdds++
    const before = audit()
    const drawer = await cart(page, 1)
    await remove(lines(drawer)).click()
    await expect(badge(page, 0)).toBeVisible()
    const replay = recorded(page, addEndpoint, 200)
    release()
    await replay
    expect(events.adds).toHaveLength(2)
    expect(events.adds[0]).toEqual(events.adds[1])
    expect(events.views).toHaveLength(0)
    expect(audit()).toEqual(before)
    await expect(drawer.getByText("Giỏ hàng đang trống", { exact: true })).toBeVisible()
  } finally { release() }
})

scenario("removal cancels only the stale matching add, keeps other pending adds and permits a fresh intent", async page => {
  await login(page)
  await authenticatedAdd(page, dishes[0], 1)
  await authenticatedAdd(page, dishes[1], 2)
  const events = traffic(page)
  const old = await holdCatalog(page, dishes[0], true)
  const other = await holdCatalog(page, dishes[2])
  try {
    await addButton(page).click()
    await old.waiting
    await addButton(page, dishes[2]).click()
    await other.waiting
    const drawer = await cart(page, 2)
    await remove(lines(drawer).filter({ hasText: dishes[0].name })).click()
    const remaining = lines(drawer).filter({ hasText: dishes[1].name })
    await clicks(up(remaining), 2)
    await expect(quantity(remaining)).toHaveText("3")
    const committed = recorded(page)
    other.release()
    await committed
    setupAdds++
    old.release()
    await page.unroute(old.pattern)
    await page.waitForTimeout(300)
    await expect(lines(drawer)).toHaveCount(2)
    await expect(lines(drawer).filter({ hasText: dishes[0].name })).toHaveCount(0)
    await expect(quantity(remaining)).toHaveText("3")
    await expect(badge(page, 4)).toBeVisible()
    expect(events.adds).toHaveLength(1)
    expect(events.adds[0].dish_id).toBe(dishes[2].id)
    expect(events.views).toHaveLength(0)
    await drawer.getByRole("button", { name: "Đóng giỏ hàng", exact: true }).click()
    await authenticatedAdd(page, dishes[0], 5)
    expect(events.adds).toHaveLength(2)
    expect(events.adds[0].event_id).not.toBe(events.adds[1].event_id)
    const reopened = await cart(page, 5)
    await expect(lines(reopened)).toHaveCount(3)
    await expect(quantity(lines(reopened).filter({ hasText: dishes[0].name }))).toHaveText("1")
  } finally { old.release(); other.release() }
})

scenario("a late success from a transport ignoring abort cannot restore a removed line", async page => {
  await guest(page)
  await add(page, dishes[0], 1)
  await add(page, dishes[1], 2)
  const held = await ignoreAbortForOneCatalogResponse(page, dishes[0])
  try {
    await addButton(page).click()
    await held.waiting
    const drawer = await cart(page, 2)
    await remove(lines(drawer).filter({ hasText: dishes[0].name })).click()
    held.release()
    await expect(addButton(page)).toBeEnabled()
    await expect(lines(drawer)).toHaveCount(1)
    await expect(lines(drawer)).toContainText(dishes[1].name)
    await expect(badge(page, 1)).toBeVisible()
    await page.waitForTimeout(300)
    await expect(lines(drawer).filter({ hasText: dishes[0].name })).toHaveCount(0)
  } finally { held.release() }
})

scenario("removing one option line does not cancel a pending add for another option set of the same dish", async page => {
  await guest(page)
  await add(page, dishes[0], 1)
  const detail = await openDish(page)
  await detail.getByText("Lớn", { exact: true }).click()
  await detail.getByLabel("Ghi chú cho bếp").fill("Tùy chọn mới")
  const held = await holdCatalog(page, dishes[0])
  try {
    await detail.getByRole("button", { name: /Thêm vào giỏ hàng/ }).click()
    await held.waiting
    await detail.getByRole("button", { name: "Đóng", exact: true }).click()
    const drawer = await cart(page, 1)
    await remove(lines(drawer)).click()
    await expect(badge(page, 0)).toBeVisible()
    held.release()
    await expect(badge(page, 1)).toBeVisible()
    await expect(lines(drawer)).toHaveCount(1)
    await expect(lines(drawer)).toContainText("Size L")
    await expect(lines(drawer)).toContainText("Tùy chọn mới")
  } finally { held.release() }
})

test.describe("mobile removal", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  scenario("touch targets, offline removal and the empty cart work at mobile width without horizontal overflow", async page => {
    await guest(page)
    await add(page, dishes[0], 1)
    await add(page, dishes[1], 2)
    const drawer = await cart(page, 2)
    const first = remove(lines(drawer).filter({ hasText: dishes[0].name }))
    // Wait for the existing slide-in animation before measuring its hit target.
    await first.tap({ trial: true })
    const bounds = await first.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.width).toBeGreaterThanOrEqual(44)
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    const requests = observe(page)
    await page.context().setOffline(true)
    try {
      await first.tap()
      await expect(lines(drawer)).toHaveCount(1)
      await expect(lines(drawer)).toContainText(dishes[1].name)
      await expect(badge(page, 1)).toBeVisible()
      await remove(lines(drawer)).tap()
      await expect(drawer.getByText("Giỏ hàng đang trống", { exact: true })).toBeVisible()
      await expect(badge(page, 0)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(requests).toHaveLength(0)
      await drawer.getByRole("button", { name: "Khám phá món ăn", exact: true }).tap()
      await expect(drawer).toHaveCount(0)
    } finally { await page.context().setOffline(false) }
  })
})

