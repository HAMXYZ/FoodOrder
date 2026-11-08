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
type Audit = { base: Record<string, string>; events: Record<string, string>; totals: Record<string, number> }
let customer: Customer
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
  initial = audit()
  const directory = join(homedir(), ".cache", "foodorder-auth-e2e", createHash("sha256").update(project).digest("hex").slice(0, 12))
  customer = JSON.parse(readFileSync(join(directory, "accounts.json"), "utf8"))[0]
  const response = await fetch("http://127.0.0.1:8000/openapi.json")
  expect(response.status).toBe(200)
  const { paths } = await response.json()
  expect(Object.keys(paths).some(path => /rating|review|feedback/.test(path))).toBe(false)
})
test.afterAll(() => {
  if (!initial) return
  expect(audit()).toEqual(initial)
  console.log("US8.4 boundary: public forged ratings rejected; every base row and interaction unchanged, no order/rating/purchase fixture in MariaDB.")
})

function scenario(title: string, work: (page: Page) => Promise<void>) {
  test(title, async ({ page }) => {
    try { await work(page) }
    catch (error) {
      let message = error instanceof Error ? error.message : "Unknown failure"
      if (customer?.password) message = message.split(customer.password).join("[redacted]")
      throw new Error(`US8.4: ${message}`)
    }
  })
}
function forged() {
  return { event_id: randomUUID(), dish_id: randomUUID(), user_id: randomUUID(),
    event_type: "rating", rating: 5, source_id: "client-invented-review", source_revision: 1, verified: true }
}
const paths = ["/api/interactions/rating", "/api/interactions/ratings", "/api/ratings/feedback", "/api/reviews"]

scenario("anonymous clients cannot create AI rating feedback or bypass the HttpOnly boundary", async page => {
  for (const path of paths) {
    expect((await page.request.post(`${origin}${path}`, { data: forged() })).status()).toBe(404)
    expect((await page.request.get(`${origin}${path}`)).status()).toBe(404)
  }
  for (const path of ["/api/interactions/views", "/api/interactions/add-to-cart"]) {
    const response = await page.request.post(`${origin}${path}`, { data: forged(),
      headers: { Authorization: "Bearer client-supplied-token" } })
    expect(response.status()).toBe(401)
  }
})

scenario("valid customer sessions cannot submit unverified stars, spoof user_id or repurpose existing events", async page => {
  await page.goto(origin, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Email", { exact: true }).fill(customer.email)
  await dialog.getByLabel("Mật khẩu", { exact: true }).fill(customer.password)
  await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click()
  await expect(page.getByRole("button", { name: customer.name, exact: true })).toBeVisible()
  for (const path of paths) expect((await page.request.post(`${origin}${path}`, { data: forged() })).status()).toBe(404)
  for (const [path, type] of [["/api/interactions/views", "view"], ["/api/interactions/add-to-cart", "add_to_cart"]]) {
    expect((await page.request.post(`${origin}${path}`, { data: forged() })).status()).toBe(422)
    expect((await page.request.post(`${origin}${path}`, { data: { ...forged(), event_type: type } })).status()).toBe(422)
  }
  const profile = await page.request.get(`${origin}/api/users/me`)
  expect(profile.status()).toBe(200)
})

