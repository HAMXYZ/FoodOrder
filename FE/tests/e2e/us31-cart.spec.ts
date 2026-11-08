import { test, expect, type Page } from "@playwright/test"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { ApiDish } from "../../lib/menu-api"
import { formatVND } from "../../lib/menu-data"

test.use({ actionTimeout: 10_000 })
const origin = "http://127.0.0.1:3000"
const endpoint = "/api/interactions/add-to-cart"
const project = resolve(__dirname, "../../..")
type Customer = { name: string; email: string; password: string }
type Event = { event_id: string; dish_id: string }
type Audit = { base: Record<string, string>; events: Record<string, string>; totals: Record<string, number>;
  rows: { event_id: string; dish_id: string; user_id: string; event_type: string }[] }
let customer: Customer
let dishes: ApiDish[]
let initial: Audit
const eventIDs = new Set<string>()

function audit(ids: string[] = []): Audit {
  const result = execFileSync(join(project, "BE/.venv/bin/python"), ["-B", "-c", `
import asyncio, hashlib, json, sys
from uuid import UUID
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
   selected = [UUID(value) for value in json.loads(sys.argv[1])]
   rows = (await connection.execute(select(models.UserInteraction.event_id, models.UserInteraction.dish_id,
       models.UserInteraction.user_id, models.UserInteraction.event_type).where(models.UserInteraction.event_id.in_(selected)))).all()
   result["rows"] = [{key: str(value) for key, value in row._mapping.items()} for row in rows]
   print(json.dumps(result))
 finally: await engine.dispose()
try: asyncio.run(run())
except Exception: sys.exit(1)
`, JSON.stringify(ids)], { cwd: join(project, "BE"), stdio: "pipe" })
  return JSON.parse(result.toString())
}

test.beforeAll(async () => {
  initial = audit() // Read-only guard before any authenticated UI action.
  const directory = join(homedir(), ".cache", "foodorder-auth-e2e", createHash("sha256").update(project).digest("hex").slice(0, 12))
  customer = JSON.parse(readFileSync(join(directory, "accounts.json"), "utf8"))[0]
  dishes = await (await fetch("http://127.0.0.1:8000/api/dishes")).json()
  expect(dishes.length).toBeGreaterThanOrEqual(2)
})

test.afterAll(() => {
  if (!initial) return
  const final = audit([...eventIDs])
  expect(final.base).toEqual(initial.base)
  for (const [id, hash] of Object.entries(initial.events)) expect(final.events[id]).toBe(hash)
  expect(final.totals.purchase || 0).toBe(initial.totals.purchase || 0)
  console.log(`US3.1: ${final.rows.length} add events recorded after successful operations; original menu/accounts/orders and ${Object.keys(initial.events).length} events unchanged.`)
})

function scenario(title: string, work: (page: Page) => Promise<void>) {
  test(title, async ({ page }) => {
    try { await work(page) }
    catch (error) {
      let message = error instanceof Error ? error.message : "Unknown failure"
      if (customer?.password) message = message.split(customer.password).join("[redacted]")
      throw new Error(`US3.1: ${message}`)
    }
  })
}

const addButton = (page: Page, dish = dishes[0]) => page.locator("#popular").getByRole("button", { name: `Thêm ${dish.name} vào giỏ`, exact: true })
const badge = (page: Page, count: number) => page.getByRole("button", { name: `Giỏ hàng, ${count} món`, exact: true })
async function guest(page: Page) {
  await page.goto(origin, { waitUntil: "networkidle" })
  await expect(page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible()
}
async function login(page: Page, navigate = true) {
  if (navigate) await guest(page)
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Email", { exact: true }).fill(customer.email)
  await dialog.getByLabel("Mật khẩu", { exact: true }).fill(customer.password)
  await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await expect(page.getByRole("button", { name: customer.name, exact: true })).toBeVisible()
  return (await (await page.request.get(`${origin}/api/users/me`)).json()).user.id as string
}
function observe(page: Page) {
  const adds: Event[] = []
  const views: Event[] = []
  page.on("request", request => {
    const path = new URL(request.url()).pathname
    if (request.method() !== "POST" || ![endpoint, "/api/interactions/views"].includes(path)) return
    const event = request.postDataJSON() as Event
    if (path === endpoint) { adds.push(event); eventIDs.add(event.event_id) }
    else views.push(event)
  })
  return { adds, views }
}
const recorded = (page: Page) => page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.status() === 201)
async function quickAdd(page: Page, dish: ApiDish, count: number) {
  await addButton(page, dish).click()
  await expect(badge(page, count)).toBeVisible()
  await expect(addButton(page, dish)).toBeEnabled()
}
async function cart(page: Page, count: number) {
  await badge(page, count).click()
  return page.getByRole("dialog", { name: /^Giỏ hàng/ })
}
const lines = (dialog: ReturnType<Page["getByRole"]>) => dialog.locator('section[aria-label="Món đã chọn"] > div')
async function openDish(page: Page, dish = dishes[0]) {
  await page.locator("#popular").getByRole("button", { name: dish.name, exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("button", { name: /Thêm vào giỏ hàng/ })).toBeEnabled()
  return dialog
}
async function confirm(page: Page, dialog: ReturnType<Page["getByRole"]>, count: number) {
  await dialog.getByRole("button", { name: /Thêm vào giỏ hàng/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(badge(page, count)).toBeVisible()
}

async function holdCatalog(page: Page, dish = dishes[0], cancellationExpected = false) {
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const waiting = new Promise<void>(resolve => { entered = resolve })
  await page.route(`**/api/dishes/${dish.id}`, async route => {
    try {
      const response = await route.fetch()
      entered()
      await gate
      await route.fulfill({ response })
    } catch (error) { if (!cancellationExpected) throw error }
  })
  return { release, waiting }
}

scenario("list adds preserve different dishes and merge repeat dishes with correct badge and prices", async page => {
  await guest(page)
  const events = observe(page)
  await quickAdd(page, dishes[0], 1)
  await quickAdd(page, dishes[1], 2)
  await quickAdd(page, dishes[0], 3)
  const dialog = await cart(page, 3)
  await expect(lines(dialog)).toHaveCount(2)
  const first = lines(dialog).filter({ hasText: dishes[0].name })
  const second = lines(dialog).filter({ hasText: dishes[1].name })
  await expect(first.locator('[aria-live="polite"]')).toHaveText("2")
  await expect(second.locator('[aria-live="polite"]')).toHaveText("1")
  await expect(first.getByText(formatVND(dishes[0].base_price * 2), { exact: true })).toBeVisible()
  await expect(second.getByText(formatVND(dishes[1].base_price), { exact: true })).toBeVisible()
  expect(events.adds).toHaveLength(0)
  expect(events.views).toHaveLength(0)
})

scenario("modal options separate lines while equivalent topping order and trimmed notes merge", async page => {
  await guest(page)
  await quickAdd(page, dishes[0], 1)
  let dialog = await openDish(page)
  await dialog.getByText("Lớn", { exact: true }).click()
  await dialog.getByText("Trứng ốp la", { exact: true }).click()
  await dialog.getByText("Phô mai", { exact: true }).click()
  await dialog.getByLabel("Ghi chú cho bếp").fill("  Ít cay  ")
  await dialog.getByRole("button", { name: "Tăng số lượng" }).click()
  await confirm(page, dialog, 3)
  dialog = await openDish(page)
  await dialog.getByText("Lớn", { exact: true }).click()
  await dialog.getByText("Phô mai", { exact: true }).click()
  await dialog.getByText("Trứng ốp la", { exact: true }).click()
  await dialog.getByLabel("Ghi chú cho bếp").fill("Ít cay")
  await confirm(page, dialog, 4)
  dialog = await openDish(page)
  await dialog.getByText("Vừa", { exact: true }).click()
  await confirm(page, dialog, 5)
  const drawer = await cart(page, 5)
  await expect(lines(drawer)).toHaveCount(3)
  const customized = lines(drawer).filter({ hasText: "Ít cay" })
  await expect(customized.locator('[aria-live="polite"]')).toHaveText("3")
  await expect(customized.getByText(formatVND((dishes[0].base_price + 20000 + 7000 + 10000) * 3), { exact: true })).toBeVisible()
})

scenario("missing and newly unavailable dishes fail without losing the existing cart or emitting add events", async page => {
  const owner = await login(page)
  const events = observe(page)
  const success = recorded(page)
  await quickAdd(page, dishes[1], 1)
  await success
  const pattern = `**/api/dishes/${dishes[0].id}`
  for (const unavailable of [false, true]) {
    await page.route(pattern, route => route.fulfill(unavailable
      ? { status: 200, json: { ...dishes[0], is_available: false } }
      : { status: 404, json: { detail: "Unavailable" } }))
    await addButton(page).click()
    await expect(page.getByText(/Món ăn không tồn tại hoặc đã hết bán/)).toBeVisible()
    await expect(addButton(page)).toBeEnabled()
    await expect(badge(page, 1)).toBeVisible()
    await page.unroute(pattern)
  }
  expect(events.adds).toHaveLength(1)
  expect(events.views).toHaveLength(0)
  const rows = audit(events.adds.map(event => event.event_id)).rows
  expect(rows).toHaveLength(1)
  expect(rows[0].dish_id).toBe(dishes[1].id)
  expect(rows[0].user_id).toBe(owner)
  const drawer = await cart(page, 1)
  await expect(lines(drawer)).toHaveCount(1)
  await expect(lines(drawer)).toContainText(dishes[1].name)
})

scenario("re-adding uses the current server name and price rather than the stale card", async page => {
  await guest(page)
  await quickAdd(page, dishes[0], 1)
  const fresh = { ...dishes[0], name: `${dishes[0].name} (mới)`, base_price: dishes[0].base_price + 1000 }
  await page.route(`**/api/dishes/${dishes[0].id}`, route => {
    expect(route.request().method()).toBe("GET")
    expect(route.request().postData()).toBeNull()
    expect(new URL(route.request().url()).search).toBe("")
    return route.fulfill({ status: 200, json: fresh })
  })
  await quickAdd(page, dishes[0], 2)
  await expect(page.getByText(/Giá món đã được cập nhật theo thực đơn mới/)).toBeVisible()
  const drawer = await cart(page, 2)
  await expect(lines(drawer)).toHaveCount(1)
  await expect(lines(drawer)).toContainText(fresh.name)
  await expect(lines(drawer).getByText(formatVND(fresh.base_price * 2), { exact: true })).toBeVisible()
})

scenario("catalog errors, invalid payloads, network failures and timeouts leave the cart intact", async page => {
  await guest(page)
  const events = observe(page)
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await quickAdd(page, dishes[1], 1)
  const pattern = `**/api/dishes/${dishes[0].id}`
  const failures = [
    { status: 503, body: "Unavailable" }, { status: 200, body: "not-json" },
    { status: 200, json: { ...dishes[0], id: dishes[1].id } },
    { status: 200, json: { ...dishes[0], base_price: -1 } },
  ]
  for (const failure of failures) {
    await page.route(pattern, route => route.fulfill(failure))
    await addButton(page).click()
    await expect(page.getByText(/Không thể kiểm tra món ăn|Thông tin món ăn chưa hợp lệ|Món ăn không tồn tại/)).toBeVisible()
    await expect(addButton(page)).toBeEnabled()
    await expect(badge(page, 1)).toBeVisible()
    await page.unroute(pattern)
  }
  await page.route(pattern, route => route.abort("connectionrefused"))
  await addButton(page).click()
  await expect(page.getByText(/Không thể kiểm tra món ăn/)).toBeVisible()
  await expect(addButton(page)).toBeEnabled()
  await page.unroute(pattern)
  await page.route(pattern, () => {}) // No response: the five-second validation timeout must recover the UI.
  await addButton(page).click()
  await expect(addButton(page)).toBeEnabled({ timeout: 8000 })
  await expect(page.getByText(/Không thể kiểm tra món ăn/)).toBeVisible()
  await expect(badge(page, 1)).toBeVisible()
  expect(events.adds).toHaveLength(0)
  expect(events.views).toHaveLength(0)
  expect(errors).toHaveLength(0)
})

scenario("out-of-order validations retain both dishes and emit one event per successful action", async page => {
  const owner = await login(page)
  const events = observe(page)
  const held = await holdCatalog(page)
  try {
    await addButton(page).click()
    await held.waiting
    await expect(addButton(page)).toBeDisabled()
    await expect(addButton(page)).toHaveAttribute("aria-busy", "true")
    const fast = recorded(page)
    await quickAdd(page, dishes[1], 1)
    await fast
    const slow = recorded(page)
    held.release()
    await slow
    await expect(badge(page, 2)).toBeVisible()
    expect(events.adds).toHaveLength(2)
    expect(new Set(events.adds.map(event => event.event_id)).size).toBe(2)
    expect(events.views).toHaveLength(0)
    const rows = audit(events.adds.map(event => event.event_id)).rows
    expect(rows).toHaveLength(2)
    expect(rows.every(row => row.user_id === owner && row.event_type === "add_to_cart")).toBe(true)
    expect(new Set(rows.map(row => row.dish_id))).toEqual(new Set([dishes[0].id, dishes[1].id]))
    await expect(lines(await cart(page, 2))).toHaveCount(2)
  } finally { held.release() }
})

scenario("login while a guest add is pending does not attribute that action to an account", async page => {
  await guest(page)
  const events = observe(page)
  const held = await holdCatalog(page)
  try {
    await addButton(page).click()
    await held.waiting
    await login(page, false)
    held.release()
    await expect(badge(page, 1)).toBeVisible()
    await page.waitForTimeout(400)
    expect(events.adds).toHaveLength(0)
    expect(events.views).toHaveLength(0)
  } finally { held.release() }
})

scenario("finishing an add from a closed modal does not close a newly opened dish", async page => {
  await guest(page)
  let dialog = await openDish(page)
  const held = await holdCatalog(page)
  try {
    await dialog.getByRole("button", { name: /Thêm vào giỏ hàng/ }).click()
    await held.waiting
    await dialog.getByRole("button", { name: "Đóng", exact: true }).click()
    dialog = await openDish(page, dishes[1])
    held.release()
    await expect(badge(page, 1)).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("heading", { name: dishes[1].name, exact: true })).toBeVisible()
  } finally { held.release() }
})

scenario("reload aborts a pending validation without ghost additions or telemetry", async page => {
  await guest(page)
  const events = observe(page)
  const held = await holdCatalog(page, dishes[0], true)
  try {
    await addButton(page).click()
    await held.waiting
    await page.reload({ waitUntil: "networkidle" })
    held.release()
    await expect(badge(page, 0)).toBeVisible()
    await page.waitForTimeout(400)
    expect(events.adds).toHaveLength(0)
    expect(events.views).toHaveLength(0)
  } finally { held.release() }
})
