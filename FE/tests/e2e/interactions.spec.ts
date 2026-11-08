import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

test.use({ actionTimeout: 10_000 })

const origin = "http://127.0.0.1:3000"
const endpoint = "/api/interactions/views"
const project = resolve(__dirname, "../../..")
type Customer = { name: string; email: string; password: string }
type Dish = { id: string; name: string; description: string }
type View = { event_id: string; dish_id: string }
type StoredView = View & { user_id: string; event_type: string; created_at: string }
type Audit = { total: number; rows: StoredView[]; base: Record<string, { count: number; hash: string }> }
let customers: Customer[] = []
let dishes: Dish[] = []
let initial: Audit
const developmentIDs = new Set<string>()

function audit(ids: string[] = []): Audit {
  // Guard the configured AND actual database before every audit. SELECT only.
  const output = execFileSync(join(project, "BE/.venv/bin/python"), ["-B", "-c", `
import asyncio, hashlib, json, sys
from uuid import UUID
from sqlalchemy import select, func
from database import engine
import models
from init_database import validate_target, verify_connection
async def run():
 try:
  validate_target(engine.url, models.Base.metadata)
  async with engine.connect() as connection:
   await verify_connection(connection)
   report = {"base": {}}
   for table in models.Base.metadata.sorted_tables:
    if table.name == "user_interactions": continue
    rows = (await connection.execute(select(table).order_by(*table.primary_key.columns))).all()
    digest = hashlib.sha256(json.dumps([list(row) for row in rows], default=str).encode()).hexdigest()
    report["base"][table.name] = {"count": len(rows), "hash": digest}
   report["total"] = (await connection.execute(select(func.count()).select_from(models.UserInteraction))).scalar_one()
   ids = [UUID(value) for value in json.loads(sys.argv[1])]
   columns = [models.UserInteraction.event_id, models.UserInteraction.user_id, models.UserInteraction.dish_id,
              models.UserInteraction.event_type, models.UserInteraction.created_at]
   rows = (await connection.execute(select(*columns).where(models.UserInteraction.event_id.in_(ids)))).all()
   report["rows"] = [{key: str(value) for key, value in row._mapping.items()} for row in rows]
   print(json.dumps(report))
 finally: await engine.dispose()
try: asyncio.run(run())
except Exception: sys.exit(1)
`, JSON.stringify(ids)], { cwd: join(project, "BE"), stdio: "pipe" })
  return JSON.parse(output.toString())
}

test.beforeAll(async () => {
  initial = audit() // Fail before account creation or interaction POSTs if not foodorder_dev.
  const directory = join(homedir(), ".cache", "foodorder-auth-e2e", createHash("sha256").update(project).digest("hex").slice(0, 12))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, "accounts.json")
  if (!existsSync(path)) {
    const suffix = randomBytes(8).toString("hex")
    writeFileSync(path, JSON.stringify(["A", "B"].map(label => ({
      name: `Khách kiểm thử ${label}`, email: `foodorder-e2e-${label.toLowerCase()}-${suffix}@example.test`,
      password: randomBytes(24).toString("base64url"),
    }))), { mode: 0o600, flag: "wx" })
  }
  customers = JSON.parse(readFileSync(path, "utf8"))
  for (const customer of customers) {
    const login = await fetch("http://127.0.0.1:8000/api/auth/login", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: customer.email, password: customer.password }) })
    if (login.status === 401) {
      const registered = await fetch("http://127.0.0.1:8000/api/auth/register", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: customer.name, email: customer.email, password: customer.password }) })
      expect(registered.status).toBe(201)
    } else expect(login.status).toBe(200)
  }
  // Account setup can add two new fixtures on a fresh dev database, never update existing rows.
  const afterAccounts = audit()
  console.log(`US8.1 E2E fixture accounts added: ${afterAccounts.base.users.count - initial.base.users.count}.`)
  initial = afterAccounts
  const response = await fetch("http://127.0.0.1:8000/api/dishes")
  expect(response.status).toBe(200)
  dishes = await response.json()
  expect(dishes.length).toBeGreaterThanOrEqual(2)
})

test.afterAll(() => {
  if (!initial) return
  const final = audit([...developmentIDs])
  expect(final.base).toEqual(initial.base)
  console.log(`US8.1 E2E: ${final.rows.length} test events persisted in foodorder_dev; database event delta=${final.total - initial.total}; all 8 original tables unchanged.`)
})

type UI = { page: Page; context: BrowserContext; browser: Browser }
function scenario(title: string, work: (ui: UI) => Promise<void>) {
  test(title, async ({ page, context, browser }) => {
    try { await work({ page, context, browser }) }
    catch (error) {
      let message = error instanceof Error ? error.message : "Unknown failure"
      for (const customer of customers) message = message.split(customer.password).join("[redacted]")
      throw new Error(`US8.1: ${message}`)
    }
  })
}

function observe(page: Page) {
  const requests: View[] = []
  page.on("request", request => {
    if (new URL(request.url()).pathname !== endpoint || request.method() !== "POST") return
    const data = request.postDataJSON() as View
    requests.push(data)
    developmentIDs.add(data.event_id)
    // No token or user_id in client JavaScript/requests.
    expect(Object.keys(data).sort()).toEqual(["dish_id", "event_id"])
    expect(Object.keys(request.headers())).not.toContain("authorization")
  })
  return requests
}

async function login(page: Page, customer = customers[0]) {
  await page.goto(origin, { waitUntil: "networkidle" })
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

async function open(page: Page, dish = dishes[0]) {
  await page.locator("#popular").getByRole("button", { name: dish.name, exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: dish.name, exact: true })).toBeVisible()
  return dialog
}

async function close(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

function recorded(page: Page) {
  return page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === "POST")
}

function newEvent(dish = dishes[0]): View {
  const event = { event_id: randomUUID(), dish_id: dish.id }
  developmentIDs.add(event.event_id)
  return event
}

scenario("guest views and failed detail loads do not record account events", async ({ page }) => {
  const requests = observe(page)
  await page.goto(origin, { waitUntil: "networkidle" })
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible()
  await expect(page.locator("#popular article")).toHaveCount(dishes.length)
  const category = page.locator('section[aria-labelledby="category-title"] button').first()
  await category.click()
  await expect(category).toHaveAttribute("aria-pressed", "true")
  expect(await page.locator("#popular article").count()).toBeGreaterThan(0)
  await category.click()
  const search = page.getByRole("searchbox", { name: "Tìm món ăn" })
  await search.fill(dishes[0].name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d"))
  await expect(page.locator("#popular article")).toHaveCount(1)
  await search.fill("")
  await expect(page.locator("#popular article")).toHaveCount(dishes.length)
  expect(requests).toHaveLength(0)
  const dialog = await open(page)
  await expect(dialog.getByRole("button", { name: /Thêm vào giỏ hàng/ })).toBeEnabled()
  await page.waitForTimeout(400)
  expect(requests).toHaveLength(0)
  await close(page)
  // The login state is irrelevant when loading the detail itself fails.
  await login(page)
  await page.route(`**/api/dishes/${dishes[0].id}`, route => route.fulfill({ status: 404, json: { detail: "Missing" } }))
  await open(page)
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Không thể tải chi tiết món")
  await expect(page.getByRole("dialog").getByRole("button", { name: /Thêm vào giỏ hàng/ })).toBeDisabled()
  expect(requests).toHaveLength(0)
})

scenario("one successful open records once; state changes and refreshes do not; reopen records again", async ({ page }) => {
  const user = await login(page)
  const requests = observe(page)
  const first = recorded(page)
  const dialog = await open(page)
  expect((await first).status()).toBe(201)
  await dialog.getByRole("button", { name: "Tăng số lượng" }).click()
  await dialog.getByLabel("Ghi chú cho bếp").fill("Kiểm thử thay đổi state")
  await dialog.getByText("Lớn", { exact: true }).click()
  await page.evaluate(async id => {
    await fetch(`/api/dishes/${id}`, { cache: "no-store" })
    window.dispatchEvent(new Event("focus"))
  }, dishes[0].id)
  await page.waitForTimeout(400)
  expect(requests).toHaveLength(1)
  await close(page)
  const second = recorded(page)
  await open(page)
  expect((await second).status()).toBe(201)
  expect(requests).toHaveLength(2)
  expect(requests[0].event_id).not.toBe(requests[1].event_id)
  const rows = audit(requests.map(event => event.event_id)).rows
  expect(rows).toHaveLength(2)
  expect(rows.every(row => row.user_id === user && row.dish_id === dishes[0].id && row.event_type === "view")).toBe(true)
})

scenario("lost success response retries the same event ID without a second MariaDB row", async ({ page }) => {
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
  const retried = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.status() === 200)
  const dialog = await open(page)
  const response = await retried
  expect(response.status()).toBe(200)
  expect(requests).toHaveLength(2)
  expect(requests[0]).toEqual(requests[1])
  expect(audit([requests[0].event_id]).rows).toHaveLength(1)
  await expect(dialog.getByRole("button", { name: /Thêm vào giỏ hàng/ })).toBeEnabled()
})

scenario("interaction service failure leaves dish details and cart usable", async ({ page }) => {
  await login(page)
  const requests = observe(page)
  await page.route(`**${endpoint}`, route => route.fulfill({ status: 503, contentType: "text/plain", body: "Unavailable" }))
  const dialog = await open(page)
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[0]).toEqual(requests[1])
  await expect(dialog.getByText(dishes[0].description, { exact: true })).toBeVisible()
  await expect(dialog.getByRole("alert")).toHaveCount(0)
  await dialog.getByRole("button", { name: "Tăng số lượng" }).click()
  await dialog.getByRole("button", { name: /Thêm vào giỏ hàng/ }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByText(new RegExp(`Đã thêm 2 ×`))).toBeVisible()
  expect(audit([requests[0].event_id]).rows).toHaveLength(0)
})

scenario("two authenticated accounts viewing the same dish retain separate ownership", async ({ page, browser }) => {
  const a = await login(page)
  const aRequests = observe(page)
  const aResponse = recorded(page)
  await open(page)
  expect((await aResponse).status()).toBe(201)
  const bContext = await browser.newContext()
  try {
    const bPage = await bContext.newPage()
    const b = await login(bPage, customers[1])
    expect(a).not.toBe(b)
    const requests = observe(bPage)
    const response = recorded(bPage)
    await open(bPage)
    expect((await response).status()).toBe(201)
    const rows = audit([aRequests[0].event_id, requests[0].event_id]).rows
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(row => row.user_id))).toEqual(new Set([a, b]))
    expect(rows.every(row => row.dish_id === dishes[0].id)).toBe(true)
  } finally { await bContext.close() }
})

scenario("authenticated proxy rejects spoofing and collisions, including concurrent MariaDB writes", async ({ page, browser }) => {
  const a = await login(page)
  const bContext = await browser.newContext()
  const anonymous = await browser.newContext()
  try {
    const bPage = await bContext.newPage()
    const b = await login(bPage, customers[1])
    const post = (target: Page, data: unknown) => target.request.post(`${origin}${endpoint}`, { data })
    const event = newEvent()
    expect((await anonymous.request.post(`${origin}${endpoint}`, {
      data: event, headers: { Authorization: "Bearer client-supplied-token" },
    })).status()).toBe(401)
    expect((await post(page, { ...event, user_id: b })).status()).toBe(422)
    expect((await post(page, { ...event, event_type: "add_to_cart" })).status()).toBe(422)
    expect((await post(page, { ...event, dish_id: randomUUID() })).status()).toBe(404)
    expect((await post(page, { ...event, event_id: "invalid" })).status()).toBe(422)
    expect((await page.request.post(`${origin}${endpoint}`, {
      data: event, headers: { Origin: "https://example.invalid" },
    })).status()).toBe(403)
    expect((await post(page, event)).status()).toBe(201)
    const original = audit([event.event_id]).rows
    const replay = await post(page, event)
    expect(replay.status()).toBe(200)
    expect((await replay.json()).duplicate).toBe(true)
    expect((await post(page, { ...event, dish_id: dishes[1].id })).status()).toBe(409)
    const crossUser = await post(bPage, event)
    expect(crossUser.status()).toBe(409)
    expect(Object.keys(await crossUser.json())).toEqual(["detail"])
    expect(audit([event.event_id]).rows).toEqual(original)
    expect(original[0].user_id).toBe(a)
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await bPage.request.fetch(`${origin}/api/interactions/${event.event_id}`, { method })
      expect(response.status()).toBe(404)
    }
    const concurrent = newEvent()
    const same = await Promise.all([post(page, concurrent), post(page, concurrent)])
    expect(same.map(response => response.status()).sort()).toEqual([200, 201])
    expect(audit([concurrent.event_id]).rows).toHaveLength(1)
    const accounts = newEvent()
    const other = await Promise.all([post(page, accounts), post(bPage, accounts)])
    expect(other.map(response => response.status()).sort()).toEqual([201, 409])
    const winner = other[0].status() === 201 ? a : b
    expect(audit([accounts.event_id]).rows[0].user_id).toBe(winner)
    const content = newEvent()
    const changed = await Promise.all([post(page, content), post(page, { ...content, dish_id: dishes[1].id })])
    expect(changed.map(response => response.status()).sort()).toEqual([201, 409])
    const rows = audit([content.event_id]).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].dish_id).toBe(changed[0].status() === 201 ? dishes[0].id : dishes[1].id)
  } finally { await bContext.close(); await anonymous.close() }
})

scenario("invalid session during a view clears authentication while details remain available", async ({ page, context }) => {
  await login(page)
  const requests = observe(page)
  await context.addCookies([{ name: "foodorder_session", value: "invalid-token",
    url: origin, httpOnly: true, sameSite: "Lax" }])
  const response = recorded(page)
  const dialog = await open(page)
  expect((await response).status()).toBe(401)
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: /Thêm vào giỏ hàng/ })).toBeEnabled()
  expect(requests).toHaveLength(1)
  expect(audit([requests[0].event_id]).rows).toHaveLength(0)
  expect((await context.cookies()).some(cookie => cookie.name === "foodorder_session")).toBe(false)
})
