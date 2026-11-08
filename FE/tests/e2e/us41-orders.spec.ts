import { test, expect, type Page } from "@playwright/test"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { ApiDish } from "../../lib/menu-api"
import { ORDER_A, ORDER_B, orderFixture } from "../fixtures/orders"
import { ORDER_STATUSES, type CustomerOrder } from "../../lib/orders-api"
import { formatVND } from "../../lib/menu-data"

test.use({ actionTimeout: 10_000 })
const origin = "http://127.0.0.1:3000"
const project = resolve(__dirname, "../../..")
const addEndpoint = "/api/interactions/add-to-cart"
type Customer = { name: string; email: string; password: string }
type Audit = { base: Record<string, string>; events: Record<string, string>; totals: Record<string, number> }
let customers: Customer[]
let customer: Customer
let dishes: ApiDish[]
let initial: Audit


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
  customers = JSON.parse(readFileSync(join(directory, "accounts.json"), "utf8"))
  customer = customers[0]
  const response = await fetch("http://127.0.0.1:8000/api/dishes")
  expect(response.status).toBe(200)
  dishes = await response.json()
  expect(dishes.length).toBeGreaterThanOrEqual(2)
})

test.afterAll(() => {
  if (!initial) return
  expect(audit()).toEqual(initial)
  console.log("US4.1: read-only real proxy tests and controlled UI mocks; all database rows unchanged, 0 orders/purchases created.")
})

function scenario(title: string, work: (page: Page) => Promise<void>) {
  test(title, async ({ page }) => {
    try { await work(page) }
    catch (error) {
      let message = error instanceof Error ? error.message : "Unknown failure"
      for (const account of customers || []) message = message.split(account.password).join("[redacted]")
      throw new Error(`US4.1: ${message}`)
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
function observe(page: Page) {
  const requests: string[] = []
  page.on("request", request => {
    const path = new URL(request.url()).pathname
    if (path.startsWith("/api/dishes/") || path.startsWith("/api/interactions/")) requests.push(path)
  })
  return requests
}

async function login(page: Page, account = customers[0], navigate = true) {
  if (navigate) await guest(page)
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Email", { exact: true }).fill(account.email)
  await dialog.getByLabel("Mật khẩu", { exact: true }).fill(account.password)
  await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await expect(page.getByRole("button", { name: account.name, exact: true })).toBeVisible()
}
async function tracking(page: Page) {
  await page.getByRole("button", { name: "Theo dõi đơn hàng", exact: true }).click()
  return page.getByRole("dialog", { name: "Theo dõi đơn hàng", exact: true })
}
async function lookup(page: Page, id = ORDER_A) {
  const dialog = page.getByRole("dialog", { name: "Theo dõi đơn hàng", exact: true })
  await dialog.getByLabel("Mã tra cứu đơn hàng", { exact: true }).fill(id)
  await dialog.getByRole("button", { name: "Tra cứu", exact: true }).click()
  return dialog
}
const mockOrder = (page: Page, get: () => CustomerOrder) => page.route("**/api/orders/*", route => {
  expect(route.request().method()).toBe("GET")
  expect(route.request().postData()).toBeNull()
  expect(new URL(route.request().url()).search).toBe("")
  expect(route.request().headers().authorization).toBeUndefined()
  return route.fulfill({ status: 200, json: get() })
})

scenario("guests see a login prompt and never a sample order", async page => {
  await guest(page)
  const dialog = await tracking(page)
  await expect(dialog.getByText("Vui lòng đăng nhập để xem đơn hàng của mình.", { exact: true })).toBeVisible()
  await expect(dialog.getByTestId("order-status")).toHaveCount(0)
  await expect(dialog.getByLabel("Mã tra cứu đơn hàng", { exact: true })).toHaveCount(0)
  await expect(dialog.getByText(/HD-88293|Nguyễn Văn Shipper|Dự kiến giao trong/)).toHaveCount(0)
  await dialog.getByRole("button", { name: "Đăng nhập để theo dõi", exact: true }).click()
  await expect(page.getByRole("dialog").getByLabel("Email", { exact: true })).toBeVisible()
})

scenario("real HttpOnly proxy requires its cookie, reads missing orders and rejects writes", async page => {
  await guest(page)
  const anonymous = await page.request.get(`${origin}/api/orders/${ORDER_A}`, { headers: { Authorization: "Bearer client-supplied" } })
  expect(anonymous.status()).toBe(401)
  await login(page, customers[0], false)
  const cookie = (await page.context().cookies(origin)).find(item => item.name === "foodorder_session")
  expect(cookie?.httpOnly).toBe(true)
  const missing = await page.request.get(`${origin}/api/orders/${ORDER_A}`)
  expect(missing.status()).toBe(404)
  expect(missing.headers()["cache-control"]).toContain("no-store")
  expect((await missing.json()).detail).toBe("Không tìm thấy đơn hàng của bạn.")
  expect((await page.request.get(`${origin}/api/orders/${ORDER_A}?user_id=${ORDER_B}&order_status=completed`)).status()).toBe(404)
  expect((await page.request.get(`${origin}/api/orders/not-a-uuid`)).status()).toBe(422)
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    expect((await page.request.fetch(`${origin}/api/orders/${ORDER_A}`, { method, data: { order_status: "completed", payment_status: "paid" } })).status()).toBe(405)
  }
})

scenario("controlled API data renders every actual model status without fixed demo progress", async page => {
  await login(page)
  let fixture = orderFixture()
  await mockOrder(page, () => fixture)
  const dialog = await tracking(page)
  await expect(dialog.getByText("Chưa chọn đơn hàng để theo dõi.", { exact: true })).toBeVisible()
  for (const status of Object.keys(ORDER_STATUSES) as CustomerOrder["order_status"][]) {
    fixture = orderFixture({ order_status: status })
    await lookup(page)
    await expect(dialog.getByTestId("order-status")).toHaveText(ORDER_STATUSES[status])
    await expect(dialog.getByRole("heading", { name: "Mã đơn hàng #MOCK-ORDER-001", exact: true })).toBeVisible()
    await expect(dialog.getByText("2 × Món fixture kiểm thử", { exact: true })).toBeVisible()
    await expect(dialog.locator("time")).toHaveAttribute("datetime", fixture.updated_at)
    if (status === "cancelled") await expect(dialog.getByRole("list", { name: "Tiến trình đơn hàng" })).toHaveCount(0)
    else await expect(dialog.locator('[aria-current="step"]')).toHaveText(ORDER_STATUSES[status])
  }
  await expect(dialog.getByText(/HD-88293|Nguyễn Văn Shipper|Dự kiến giao trong/)).toHaveCount(0)
})

scenario("refresh replaces status and database timestamp rather than keeping stale progress", async page => {
  await login(page)
  let fixture = orderFixture()
  await mockOrder(page, () => fixture)
  const dialog = await tracking(page)
  await lookup(page)
  await expect(dialog.getByTestId("order-status")).toHaveText("Chờ xác nhận")
  fixture = orderFixture({ order_status: "preparing", updated_at: "2026-11-08T11:00:00Z" })
  await dialog.getByRole("button", { name: "Làm mới trạng thái", exact: true }).click()
  await expect(dialog.getByTestId("order-status")).toHaveText("Đang chuẩn bị")
  await expect(dialog.locator("time")).toHaveAttribute("datetime", fixture.updated_at)
  await expect(dialog.getByText(formatVND(30000), { exact: true })).toBeVisible()
})

scenario("cancelled orders show a supplied reason or an explicit absence of reason", async page => {
  await login(page)
  let fixture = orderFixture({ order_status: "cancelled", cancellation_reason: "Cửa hàng không còn nguyên liệu" })
  await mockOrder(page, () => fixture)
  const dialog = await tracking(page)
  await lookup(page)
  await expect(dialog.getByText("Cửa hàng không còn nguyên liệu", { exact: true })).toBeVisible()
  fixture = orderFixture({ order_status: "cancelled" })
  await dialog.getByRole("button", { name: "Làm mới trạng thái", exact: true }).click()
  await expect(dialog.getByText(/Hệ thống chưa có thông tin lý do hủy/)).toBeVisible()
})

scenario("loading and the real not-found response never substitute sample details", async page => {
  await login(page)
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const waiting = new Promise<void>(resolve => { entered = resolve })
  await page.route("**/api/orders/*", async route => { entered(); await gate; await route.fulfill({ status: 404, json: {} }) })
  try {
    const dialog = await tracking(page)
    await lookup(page)
    await waiting
    await expect(dialog.getByText("Đang tải trạng thái đơn hàng...", { exact: true })).toBeVisible()
    await expect(dialog.getByTestId("order-status")).toHaveCount(0)
    release()
    await expect(dialog.getByRole("alert")).toHaveText("Không tìm thấy đơn hàng của bạn.")
    await page.unroute("**/api/orders/*")
    await dialog.getByRole("button", { name: "Làm mới trạng thái", exact: true }).click()
    await expect(dialog.getByRole("alert")).toHaveText("Không tìm thấy đơn hàng của bạn.")
    await expect(dialog.getByTestId("order-status")).toHaveCount(0)
  } finally { release() }
})

scenario("upstream errors, malformed data and invalid IDs leave the cart intact", async page => {
  await guest(page)
  await add(page, dishes[0], 1) // Guest setup does not create an interaction.
  await login(page, customers[0], false)
  const dialog = await tracking(page)
  const requests = observe(page)
  await lookup(page, "HD-12345")
  await expect(dialog.getByRole("alert")).toHaveText("Mã tra cứu đơn hàng chưa hợp lệ.")
  const failures = [
    { status: 503, body: "private-upstream-error" }, { status: 200, body: "not-json" },
    { status: 200, json: orderFixture({ id: ORDER_B }) }, { status: 200, json: { ...orderFixture(), order_status: "invented" } },
  ]
  for (const failure of failures) {
    await page.route("**/api/orders/*", route => route.fulfill(failure))
    await lookup(page)
    await expect(dialog.getByRole("alert")).toContainText(/Chưa thể tải đơn hàng|Thông tin đơn hàng chưa hợp lệ/)
    await expect(dialog.getByTestId("order-status")).toHaveCount(0)
    await expect(badge(page, 1)).toBeVisible()
    await expect(dialog.getByText("private-upstream-error", { exact: true })).toHaveCount(0)
    await page.unroute("**/api/orders/*")
  }
  expect(requests).toHaveLength(0)
})

scenario("invalid real session clears order details and the HttpOnly cookie", async page => {
  await login(page)
  await mockOrder(page, () => orderFixture())
  const dialog = await tracking(page)
  await lookup(page)
  await expect(dialog.getByTestId("order-status")).toHaveText("Chờ xác nhận")
  await page.unroute("**/api/orders/*")
  await page.context().addCookies([{ name: "foodorder_session", value: "invalid-us41-session", url: origin,
    httpOnly: true, sameSite: "Lax" }])
  await dialog.getByRole("button", { name: "Làm mới trạng thái", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Đăng nhập để theo dõi", exact: true })).toBeVisible()
  await expect(dialog.getByTestId("order-status")).toHaveCount(0)
  await expect(dialog.getByText(/MOCK-ORDER-001/)).toHaveCount(0)
  expect((await page.context().cookies(origin)).some(cookie => cookie.name === "foodorder_session")).toBe(false)
})

scenario("a late response for a previous lookup cannot replace the latest order", async page => {
  await login(page)
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const waiting = new Promise<void>(resolve => { entered = resolve })
  await page.route("**/api/orders/*", async route => {
    const old = route.request().url().endsWith(ORDER_A)
    if (old) { entered(); await gate }
    try { await route.fulfill({ status: 200, json: old ? orderFixture() : orderFixture({ id: ORDER_B, order_code: "MOCK-ORDER-002", order_status: "completed" }) }) }
    catch (error) { if (!old) throw error }
  })
  try {
    const dialog = await tracking(page)
    await lookup(page)
    await waiting
    await lookup(page, ORDER_B)
    await expect(dialog.getByTestId("order-status")).toHaveText("Hoàn thành")
    release()
    await page.waitForTimeout(300)
    await expect(dialog.getByRole("heading", { name: "Mã đơn hàng #MOCK-ORDER-002", exact: true })).toBeVisible()
    await expect(dialog.getByText(/MOCK-ORDER-001/)).toHaveCount(0)
  } finally { release() }
})

scenario("logout and another account never retain the previous customer's order", async page => {
  await login(page)
  await mockOrder(page, () => orderFixture())
  const dialog = await tracking(page)
  await lookup(page)
  await expect(dialog.getByTestId("order-status")).toHaveText("Chờ xác nhận")
  expect((await page.request.post(`${origin}/api/auth/logout`, { data: {} })).status()).toBe(200)
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(dialog.getByRole("button", { name: "Đăng nhập để theo dõi", exact: true })).toBeVisible()
  await expect(dialog.getByTestId("order-status")).toHaveCount(0)
  await dialog.getByRole("button", { name: "Đóng theo dõi đơn hàng", exact: true }).click()
  await login(page, customers[1], false)
  const reopened = await tracking(page)
  await expect(reopened.getByText("Chưa chọn đơn hàng để theo dõi.", { exact: true })).toBeVisible()
  await expect(reopened.getByText(/MOCK-ORDER-001/)).toHaveCount(0)
})

test.describe("mobile tracking", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  scenario("controlled order data and refresh are usable by touch without horizontal overflow", async page => {
    await login(page)
    await mockOrder(page, () => orderFixture({ order_status: "preparing" }))
    const dialog = await tracking(page)
    await lookup(page)
    await expect(dialog.getByTestId("order-status")).toHaveText("Đang chuẩn bị")
    await dialog.getByRole("button", { name: "Làm mới trạng thái", exact: true }).tap()
    await expect(dialog.getByTestId("order-status")).toHaveText("Đang chuẩn bị")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await dialog.getByRole("button", { name: "Đóng theo dõi đơn hàng", exact: true }).tap()
    await expect(dialog).toHaveCount(0)
  })
})

