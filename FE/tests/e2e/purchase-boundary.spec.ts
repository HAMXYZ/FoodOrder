import { test, expect, type Page } from "@playwright/test"
import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

test.use({ actionTimeout: 10_000 })
const origin = "http://127.0.0.1:3000"
const project = resolve(__dirname, "../../..")
type Customer = { name: string; email: string; password: string }
type Audit = { base: Record<string, string>; orders: number; purchases: number; dishes: number }
let initial: Audit
let customer: Customer

function audit(): Audit {
  // SELECT only. Never create a completed order/purchase fixture in development.
  const output = execFileSync(join(project, "BE/.venv/bin/python"), ["-B", "-c", `
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
   result = {"base": {}}
   for table in models.Base.metadata.sorted_tables:
    if table.name == "user_interactions": continue
    rows = (await connection.execute(select(table).order_by(*table.primary_key.columns))).all()
    result["base"][table.name] = hashlib.sha256(json.dumps([list(row) for row in rows], default=str).encode()).hexdigest()
   result["orders"] = (await connection.execute(select(func.count()).select_from(models.Order))).scalar_one()
   result["dishes"] = (await connection.execute(select(func.count()).select_from(models.Dish))).scalar_one()
   result["purchases"] = (await connection.execute(select(func.count()).select_from(models.UserInteraction).where(models.UserInteraction.event_type == "purchase"))).scalar_one()
   print(json.dumps(result))
 finally: await engine.dispose()
try: asyncio.run(run())
except Exception: sys.exit(1)
`], { cwd: join(project, "BE"), stdio: "pipe" })
  return JSON.parse(output.toString())
}

test.beforeAll(async () => {
  initial = audit()
  const directory = join(homedir(), ".cache", "foodorder-auth-e2e", createHash("sha256").update(project).digest("hex").slice(0, 12))
  // The existing auth E2E provisions these fixtures first; no new account here.
  customer = JSON.parse(readFileSync(join(directory, "accounts.json"), "utf8"))[0]
  const api = await fetch("http://127.0.0.1:8000/openapi.json")
  const { paths } = await api.json()
  expect(Object.keys(paths["/api/orders/{order_id}"])).toEqual(["get"])
  expect(Object.keys(paths).some(path => path.startsWith("/api/admin/orders") || path.includes("purchase"))).toBe(false)
})

test.afterAll(() => {
  if (!initial) return
  const final = audit()
  expect(final).toEqual(initial)
  console.log(`US8.3 browser boundary: demo checkout and forged requests created 0 orders / 0 purchases; dishes=${final.dishes}, actual_orders=${final.orders}, actual_purchases=${final.purchases}.`)
})

async function login(page: Page) {
  await page.goto(origin, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Email", { exact: true }).fill(customer.email)
  await dialog.getByLabel("Mật khẩu", { exact: true }).fill(customer.password)
  await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await expect(page.getByRole("button", { name: customer.name, exact: true })).toBeVisible()
}

function safe(title: string, work: (page: Page) => Promise<void>) {
  test(title, async ({ page }) => {
    try { await work(page) }
    catch (error) {
      let message = error instanceof Error ? error.message : "Unknown failure"
      if (customer?.password) message = message.split(customer.password).join("[redacted]")
      throw new Error(`US8.3 boundary: ${message}`)
    }
  })
}

safe("demo checkout never sends purchase or creates a real completed order", async page => {
  await login(page)
  const forbiddenRequests: string[] = []
  page.on("request", request => {
    const path = new URL(request.url()).pathname
    if (path.includes("purchase") || path.startsWith("/api/orders") || path.startsWith("/api/admin/orders")) forbiddenRequests.push(path)
  })
  const menu = await (await page.request.get(`${origin}/api/dishes`)).json()
  const accepted = page.waitForResponse(response => response.url().endsWith("/api/interactions/add-to-cart") && response.status() === 201)
  await page.locator("#popular").getByRole("button", { name: `Thêm ${menu[0].name} vào giỏ`, exact: true }).click()
  await accepted
  await page.getByRole("button", { name: "Giỏ hàng, 1 món", exact: true }).click()
  const cart = page.getByRole("dialog", { name: /^Giỏ hàng/ })
  await cart.getByRole("button", { name: /^Đặt hàng ngay/ }).click()
  const tracking = page.getByRole("dialog", { name: "Theo dõi đơn hàng", exact: true })
  await expect(tracking).toBeVisible()
  await expect(tracking.getByText(/Đặt hàng hiện là bản demo/)).toBeVisible()
  await expect(tracking.getByTestId("order-status")).toHaveCount(0)
  await page.getByRole("button", { name: "Đóng theo dõi đơn hàng", exact: true }).click()
  await expect(page.getByRole("button", { name: "Giỏ hàng, 0 món", exact: true })).toBeVisible()
  expect(forbiddenRequests).toHaveLength(0)
  expect(audit()).toEqual(initial)
})

safe("authenticated customers cannot forge purchases or complete orders through HTTP", async page => {
  await login(page)
  const menu = await (await page.request.get(`${origin}/api/dishes`)).json()
  const order = randomUUID()
  const forged = { event_id: randomUUID(), dish_id: menu[0].id, event_type: "purchase",
    user_id: randomUUID(), order_id: order, order_item_id: randomUUID(), quantity: 3 }
  for (const path of ["/api/interactions/views", "/api/interactions/add-to-cart"]) {
    expect((await page.request.post(`${origin}${path}`, { data: forged })).status()).toBe(422)
  }
  for (const path of ["/api/interactions/purchase", "/api/interactions/purchases"]) {
    expect((await page.request.post(`${origin}${path}`, { data: forged })).status()).toBe(404)
  }
  for (const path of [`/api/orders/${order}/status`, `/api/admin/orders/${order}/status`]) {
    expect((await page.request.put(`${origin}${path}`, { data: { order_status: "completed" } })).status()).toBe(404)
  }
  expect(audit()).toEqual(initial)
})
