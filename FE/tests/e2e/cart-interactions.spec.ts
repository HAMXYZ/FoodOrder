import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

test.use({ actionTimeout: 10_000 })

const origin = "http://127.0.0.1:3000"
const endpoint = "/api/interactions/add-to-cart"
const views = "/api/interactions/views"
const project = resolve(__dirname, "../../..")
type Customer = { name: string; email: string; password: string }
type Dish = { id: string; name: string }
type Event = { event_id: string; dish_id: string }
type Stored = Event & { user_id: string; event_type: "view" | "add_to_cart"; created_at: string }
type Audit = {
  rows: Stored[]; totals: Record<string, number>; base: Record<string, string>;
  existing: Record<string, string>
}
let customers: Customer[] = []
let dishes: Dish[] = []
let initial: Audit
const ids = new Set<string>()

function audit(selected: string[] = []): Audit {
  // Guard both URL and actual connection before any live test write. No secrets returned.
  const result = execFileSync(join(project, "BE/.venv/bin/python"), ["-B", "-c", `
import asyncio, hashlib, json, sys
from sqlalchemy import select, func
from uuid import UUID
import models
from database import engine
from init_database import validate_target, verify_connection
async def run():
 try:
  validate_target(engine.url, models.Base.metadata)
  async with engine.connect() as connection:
   await verify_connection(connection)
   result = {"base": {}, "existing": {}}
   for table in models.Base.metadata.sorted_tables:
    rows = (await connection.execute(select(table).order_by(*table.primary_key.columns))).all()
    if table.name == "user_interactions":
     result["existing"] = {str(row.event_id): hashlib.sha256(json.dumps(list(row), default=str).encode()).hexdigest() for row in rows}
    else:
     result["base"][table.name] = hashlib.sha256(json.dumps([list(row) for row in rows], default=str).encode()).hexdigest()
   result["totals"] = dict((await connection.execute(select(models.UserInteraction.event_type, func.count()).group_by(models.UserInteraction.event_type))).all())
   selected = [UUID(value) for value in json.loads(sys.argv[1])]
   columns = [models.UserInteraction.event_id, models.UserInteraction.user_id, models.UserInteraction.dish_id,
              models.UserInteraction.event_type, models.UserInteraction.created_at]
   rows = (await connection.execute(select(*columns).where(models.UserInteraction.event_id.in_(selected)))).all()
   result["rows"] = [{key: str(value) for key, value in row._mapping.items()} for row in rows]
   print(json.dumps(result))
 finally: await engine.dispose()
try: asyncio.run(run())
except Exception: sys.exit(1)
`, JSON.stringify(selected)], { cwd: join(project, "BE"), stdio: "pipe" })
  return JSON.parse(result.toString())
}

test.beforeAll(async () => {
  initial = audit()
  const directory = join(homedir(), ".cache", "foodorder-auth-e2e", createHash("sha256").update(project).digest("hex").slice(0, 12))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, "accounts.json")
  if (!existsSync(file)) {
    const suffix = randomBytes(8).toString("hex")
    writeFileSync(file, JSON.stringify(["A", "B"].map(label => ({
      name: `Khách kiểm thử ${label}`, email: `foodorder-e2e-${label.toLowerCase()}-${suffix}@example.test`,
      password: randomBytes(24).toString("base64url"),
    }))), { mode: 0o600, flag: "wx" })
  }
  customers = JSON.parse(readFileSync(file, "utf8"))
  for (const customer of customers) {
    const response = await fetch("http://127.0.0.1:8000/api/auth/login", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: customer.email, password: customer.password }) })
    if (response.status === 401) {
      const registered = await fetch("http://127.0.0.1:8000/api/auth/register", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: customer.name, email: customer.email, password: customer.password }) })
      expect(registered.status).toBe(201)
    } else expect(response.status).toBe(200)
  }
  initial = audit()
  const menu = await fetch("http://127.0.0.1:8000/api/dishes")
  expect(menu.status).toBe(200)
  dishes = await menu.json()
  expect(dishes.length).toBeGreaterThanOrEqual(2)
})

test.afterAll(() => {
  if (!initial) return
  const final = audit([...ids])
  expect(final.base).toEqual(initial.base)
  for (const [id, hash] of Object.entries(initial.existing)) expect(final.existing[id]).toBe(hash)
  const added = Object.fromEntries(["view", "add_to_cart"].map(type => [type, (final.totals[type] || 0) - (initial.totals[type] || 0)]))
  console.log(`US8.2 E2E rows in foodorder_dev: ${JSON.stringify(added)}; ${Object.keys(initial.existing).length} pre-existing events and all 8 base tables unchanged.`)
})

type UI = { page: Page; browser: Browser; context: BrowserContext }
function scenario(title: string, work: (ui: UI) => Promise<void>) {
  test(title, async ({ page, browser, context }) => {
    try { await work({ page, browser, context }) }
    catch (error) {
      let message = error instanceof Error ? error.message : "Unknown failure"
      for (const customer of customers) message = message.split(customer.password).join("[redacted]")
      throw new Error(`US8.2: ${message}`)
    }
  })
}

async function login(page: Page, customer = customers[0], navigate = true) {
  if (navigate) await page.goto(origin, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Email", { exact: true }).fill(customer.email)
  await dialog.getByLabel("Mật khẩu", { exact: true }).fill(customer.password)
  await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await expect(page.getByRole("button", { name: customer.name, exact: true })).toBeVisible()
  const response = await page.request.get(`${origin}/api/users/me`)
  expect(response.status()).toBe(200)
  return (await response.json()).user.id as string
}

function observe(page: Page) {
  const cart: Event[] = []
  const view: Event[] = []
  page.on("request", request => {
    const path = new URL(request.url()).pathname
    if (request.method() !== "POST" || ![endpoint, views].includes(path)) return
    const event = request.postDataJSON() as Event
    ids.add(event.event_id)
    ;(path === endpoint ? cart : view).push(event)
    expect(Object.keys(event).sort()).toEqual(["dish_id", "event_id"])
    expect(Object.keys(request.headers())).not.toContain("authorization")
  })
  return { cart, view }
}

function recorded(page: Page, path = endpoint, status?: number) {
  return page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === "POST"
    && (status === undefined || response.status() === status))
}
const quickAdd = (page: Page) => page.locator("#popular").getByRole("button", { name: `Thêm ${dishes[0].name} vào giỏ`, exact: true })
const cartButton = (page: Page, count: number) => page.getByRole("button", { name: `Giỏ hàng, ${count} món`, exact: true })
async function openCart(page: Page, count: number) {
  await cartButton(page, count).click()
  return page.getByRole("dialog", { name: new RegExp(`^Giỏ hàng`) })
}
async function closeCart(page: Page) { await page.getByRole("button", { name: "Đóng giỏ hàng", exact: true }).click() }
async function openDish(page: Page) {
  await page.locator("#popular").getByRole("button", { name: dishes[0].name, exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("button", { name: /Thêm vào giỏ hàng/ })).toBeEnabled()
  return dialog
}
function newEvent(dish = dishes[0]) {
  const value = { event_id: randomUUID(), dish_id: dish.id }
  ids.add(value.event_id)
  return value
}

scenario("guest cart stays local and login or reload does not backfill events", async ({ page }) => {
  const requests = observe(page)
  await page.goto(origin, { waitUntil: "networkidle" })
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible()
  await quickAdd(page).click()
  await expect(cartButton(page, 1)).toBeVisible()
  await login(page, customers[0], false)
  await expect(cartButton(page, 1)).toBeVisible()
  const cart = await openCart(page, 1)
  await cart.getByRole("button", { name: "Tăng số lượng" }).click()
  await expect(cart.getByRole("heading")).toContainText("(2)")
  await closeCart(page)
  await page.reload({ waitUntil: "networkidle" })
  await expect(cartButton(page, 0)).toBeVisible()
  expect(requests.cart).toHaveLength(0)
  expect(requests.view).toHaveLength(0)
})

scenario("one click records once, quantity edits do not, and a second add has its own event", async ({ page }) => {
  const user = await login(page)
  const requests = observe(page)
  const first = recorded(page)
  await quickAdd(page).click()
  expect((await first).status()).toBe(201)
  await expect(cartButton(page, 1)).toBeVisible()
  const cart = await openCart(page, 1)
  await cart.getByRole("button", { name: "Tăng số lượng" }).click()
  await expect(cart.getByRole("heading")).toContainText("(2)")
  await cart.getByRole("button", { name: "Giảm số lượng" }).click()
  await closeCart(page)
  await page.getByRole("searchbox", { name: "Tìm món ăn" }).fill(dishes[0].name)
  await page.getByRole("searchbox", { name: "Tìm món ăn" }).fill("")
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await page.waitForTimeout(400)
  expect(requests.cart).toHaveLength(1)
  const second = recorded(page)
  await quickAdd(page).click()
  expect((await second).status()).toBe(201)
  await expect(cartButton(page, 2)).toBeVisible()
  expect(requests.cart).toHaveLength(2)
  expect(requests.cart[0].event_id).not.toBe(requests.cart[1].event_id)
  expect(requests.view).toHaveLength(0)
  const rows = audit(requests.cart.map(event => event.event_id)).rows
  expect(rows).toHaveLength(2)
  expect(rows.every(row => row.user_id === user && row.event_type === "add_to_cart")).toBe(true)
})

scenario("modal options do not record adds; confirming adds once; a failed detail cannot add", async ({ page }) => {
  await login(page)
  const requests = observe(page)
  const viewed = recorded(page, views)
  const dialog = await openDish(page)
  expect((await viewed).status()).toBe(201)
  await dialog.getByRole("button", { name: "Tăng số lượng" }).click()
  await dialog.getByText("Lớn", { exact: true }).click()
  await dialog.getByLabel("Ghi chú cho bếp").fill("US8.2 modal options")
  expect(requests.cart).toHaveLength(0)
  const added = recorded(page)
  await dialog.getByRole("button", { name: /Thêm vào giỏ hàng/ }).click()
  expect((await added).status()).toBe(201)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(cartButton(page, 2)).toBeVisible()
  expect(requests.cart).toHaveLength(1)
  expect(requests.cart[0].event_id).not.toBe(requests.view[0].event_id)
  await page.route(`**/api/dishes/${dishes[0].id}`, route => route.fulfill({ status: 503, json: { detail: "Unavailable" } }))
  await page.locator("#popular").getByRole("button", { name: dishes[0].name, exact: true }).click()
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible()
  await expect(page.getByRole("dialog").getByRole("button", { name: /Thêm vào giỏ hàng/ })).toBeDisabled()
  expect(requests.cart).toHaveLength(1)
})

scenario("quantity selection and failed adds to a capped cart do not emit new add events", async ({ page }) => {
  await login(page)
  const requests = observe(page)
  const viewed = recorded(page, views)
  const dialog = await openDish(page)
  expect((await viewed).status()).toBe(201)
  // Use the actual UI controls, allowing React to commit each quantity selection.
  const increase = dialog.getByRole("button", { name: "Tăng số lượng" })
  await increase.evaluate(async button => {
    const counter = button.parentElement!.querySelector("span")!
    for (let count = 2; count <= 99; count++) {
      ;(button as HTMLButtonElement).click()
      while (counter.textContent !== String(count)) await new Promise(requestAnimationFrame)
    }
  })
  await increase.click() // The existing UI itself clamps quantity at 99.
  await expect(increase.locator("..").getByText("99", { exact: true })).toBeVisible()
  await expect(cartButton(page, 0)).toBeVisible()
  expect(requests.cart).toHaveLength(0)
  const added = recorded(page)
  await dialog.getByRole("button", { name: /Thêm vào giỏ hàng/ }).click()
  expect((await added).status()).toBe(201)
  await expect(cartButton(page, 99)).toBeVisible()
  await quickAdd(page).click()
  await expect(page.getByText("Món này đã đạt giới hạn 99 trong giỏ hàng.", { exact: true })).toBeVisible()
  await expect(cartButton(page, 99)).toBeVisible()
  await page.waitForTimeout(400)
  expect(requests.cart).toHaveLength(1)
  const reopened = recorded(page, views)
  const full = await openDish(page)
  expect((await reopened).status()).toBe(201)
  await full.getByRole("button", { name: /Thêm vào giỏ hàng/ }).click()
  await expect(full).toBeVisible()
  await expect(cartButton(page, 99)).toBeVisible()
  await page.waitForTimeout(400)
  expect(requests.cart).toHaveLength(1)
  expect(audit([requests.cart[0].event_id]).rows).toHaveLength(1)
})

scenario("lost response retries the event without repeating the local cart mutation", async ({ page }) => {
  await login(page)
  const requests = observe(page)
  let attempts = 0
  await page.route(`**${endpoint}`, async route => {
    attempts++
    if (attempts === 1) {
      const committed = await route.fetch()
      expect(committed.status()).toBe(201)
      await route.fulfill({ status: 503, json: { detail: "Simulated lost response after commit" } })
    } else await route.continue()
  })
  const replay = recorded(page, endpoint, 200)
  await quickAdd(page).click()
  expect((await replay).status()).toBe(200)
  await expect(cartButton(page, 1)).toBeVisible()
  expect(requests.cart).toHaveLength(2)
  expect(requests.cart[0]).toEqual(requests.cart[1])
  expect(audit([requests.cart[0].event_id]).rows).toHaveLength(1)
})

scenario("interaction outage preserves the cart and never duplicates or retries an add", async ({ page }) => {
  await login(page)
  const requests = observe(page)
  await page.route(`**${endpoint}`, route => route.fulfill({ status: 503, contentType: "text/plain", body: "Unavailable" }))
  await quickAdd(page).click()
  await expect.poll(() => requests.cart.length).toBe(2)
  expect(requests.cart[0]).toEqual(requests.cart[1])
  await expect(cartButton(page, 1)).toBeVisible()
  const cart = await openCart(page, 1)
  await cart.getByRole("button", { name: "Tăng số lượng" }).click()
  await expect(cart.getByRole("heading")).toContainText("(2)")
  await cart.getByRole("button", { name: `Xoá ${dishes[0].name}`, exact: true }).click()
  await expect(cart.getByText("Giỏ hàng đang trống", { exact: true })).toBeVisible()
  expect(requests.cart).toHaveLength(2)
  expect(audit([requests.cart[0].event_id]).rows).toHaveLength(0)
})

scenario("two customer interfaces add the same dish with independent ownership", async ({ page, browser }) => {
  const a = await login(page)
  const aRequests = observe(page)
  const first = recorded(page)
  await quickAdd(page).click()
  expect((await first).status()).toBe(201)
  const other = await browser.newContext()
  try {
    const bPage = await other.newPage()
    const b = await login(bPage, customers[1])
    const bRequests = observe(bPage)
    const second = recorded(bPage)
    await quickAdd(bPage).click()
    expect((await second).status()).toBe(201)
    const rows = audit([aRequests.cart[0].event_id, bRequests.cart[0].event_id]).rows
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(row => row.user_id))).toEqual(new Set([a, b]))
    expect(rows.every(row => row.dish_id === dishes[0].id && row.event_type === "add_to_cart")).toBe(true)
  } finally { await other.close() }
})

scenario("proxy enforces ownership, cross-type conflicts and concurrent MariaDB uniqueness", async ({ page, browser }) => {
  const a = await login(page)
  const other = await browser.newContext()
  const anonymous = await browser.newContext()
  try {
    const bPage = await other.newPage()
    const b = await login(bPage, customers[1])
    const post = (target: Page, data: unknown, path = endpoint) => target.request.post(`${origin}${path}`, { data })
    const event = newEvent()
    expect((await anonymous.request.post(`${origin}${endpoint}`, { data: event,
      headers: { Authorization: "Bearer client-supplied-token" } })).status()).toBe(401)
    expect((await post(page, { ...event, user_id: b })).status()).toBe(422)
    expect((await post(page, { ...event, event_type: "view" })).status()).toBe(422)
    expect((await post(page, { ...event, event_type: "purchase" })).status()).toBe(422)
    expect((await post(page, { ...event, dish_id: randomUUID() })).status()).toBe(404)
    expect((await post(page, { ...event, event_id: "bad-id" })).status()).toBe(422)
    expect((await page.request.post(`${origin}${endpoint}`, { data: event, headers: { Origin: "https://example.invalid" } })).status()).toBe(403)
    expect((await post(page, event)).status()).toBe(201)
    const original = audit([event.event_id]).rows
    const replay = await post(page, event)
    expect(replay.status()).toBe(200)
    expect((await replay.json()).duplicate).toBe(true)
    expect((await post(page, { ...event, dish_id: dishes[1].id })).status()).toBe(409)
    expect((await post(bPage, event)).status()).toBe(409)
    expect((await post(page, event, views)).status()).toBe(409)
    expect(audit([event.event_id]).rows).toEqual(original)
    const view = newEvent()
    expect((await post(page, view, views)).status()).toBe(201)
    const originalView = audit([view.event_id]).rows
    expect((await post(page, view)).status()).toBe(409)
    expect(audit([view.event_id]).rows).toEqual(originalView)
    const concurrent = newEvent()
    const identical = await Promise.all([post(page, concurrent), post(page, concurrent)])
    expect(identical.map(response => response.status()).sort()).toEqual([200, 201])
    expect(audit([concurrent.event_id]).rows).toHaveLength(1)
    const account = newEvent()
    const accounts = await Promise.all([post(page, account), post(bPage, account)])
    expect(accounts.map(response => response.status()).sort()).toEqual([201, 409])
    expect(audit([account.event_id]).rows[0].user_id).toBe(accounts[0].status() === 201 ? a : b)
    const types = newEvent()
    const mixed = await Promise.all([post(page, types, views), post(page, types)])
    expect(mixed.map(response => response.status()).sort()).toEqual([201, 409])
    const winner = mixed[0].status() === 201 ? "view" : "add_to_cart"
    const rows = audit([types.event_id]).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].event_type).toBe(winner)
  } finally { await other.close(); await anonymous.close() }
})

scenario("invalid session rejects the event while a successful local add remains in the cart", async ({ page, context }) => {
  await login(page)
  const requests = observe(page)
  await context.addCookies([{ name: "foodorder_session", value: "invalid-token", url: origin, httpOnly: true, sameSite: "Lax" }])
  const rejected = recorded(page)
  await quickAdd(page).click()
  expect((await rejected).status()).toBe(401)
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible()
  await expect(cartButton(page, 1)).toBeVisible()
  expect(requests.cart).toHaveLength(1)
  expect(audit([requests.cart[0].event_id]).rows).toHaveLength(0)
  expect((await context.cookies()).some(cookie => cookie.name === "foodorder_session")).toBe(false)
})
