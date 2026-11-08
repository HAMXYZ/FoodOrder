import { test, expect, type Page, type BrowserContext } from "@playwright/test"
import type { AuthUser } from "../../lib/auth-types"
import { createHmac, randomBytes, createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { resolve, join } from "node:path"

type Customer = { name: string; email: string; password: string }
const backend = "http://127.0.0.1:8000"
const cookieName = "foodorder_session"

test("real customer authentication, ownership, expiration and logout", async ({ browser }) => {
  let stage = "development database guard"
  const sensitive: string[] = []
  const contexts: BrowserContext[] = []
  try {
    const project = resolve(__dirname, "../../..")
    // Fail closed before creating any test account. This command performs SELECT only.
    execFileSync(join(project, "BE/.venv/bin/python"), ["-B", "-c", `
import asyncio, sys
try:
 from database import engine
 import models
 from init_database import validate_target, verify_connection
 validate_target(engine.url, models.Base.metadata)
 async def check():
  try:
   async with engine.connect() as connection: await verify_connection(connection)
  finally: await engine.dispose()
 asyncio.run(check())
except Exception: sys.exit(1)
`], { cwd: join(project, "BE"), stdio: "pipe" })

    const directory = join(homedir(), ".cache", "foodorder-auth-e2e", createHash("sha256").update(project).digest("hex").slice(0, 12))
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const fixture = join(directory, "accounts.json")
    if (!existsSync(fixture)) {
      const suffix = randomBytes(8).toString("hex")
      writeFileSync(fixture, JSON.stringify(["A", "B"].map(label => ({
        name: `Khách kiểm thử ${label}`, email: `foodorder-e2e-${label.toLowerCase()}-${suffix}@example.test`,
        password: randomBytes(24).toString("base64url"),
      }))), { mode: 0o600, flag: "wx" })
    }
    const customers: Customer[] = JSON.parse(readFileSync(fixture, "utf8"))
    for (const customer of customers) sensitive.push(customer.password)
    const env = readFileSync(join(project, "BE/.env"), "utf8")
    const signingKey = process.env.FOODORDER_SECRET_KEY || env.match(/^FOODORDER_SECRET_KEY=(.+)$/m)?.[1].trim()
    if (!signingKey) throw new Error("Development signing key is not configured")
    sensitive.push(signingKey)

    const issue = (subject: string, expiry: number, key = signingKey) => {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
      const payload = Buffer.from(JSON.stringify({ sub: subject, exp: expiry })).toString("base64url")
      const value = `${header}.${payload}`
      const token = `${value}.${createHmac("sha256", key).update(value).digest("base64url")}`
      sensitive.push(token)
      return token
    }
    const directLogin = async (customer: Customer) => {
      const response = await fetch(`${backend}/api/auth/login`, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: customer.email, password: customer.password }) })
      const data = await response.json()
      if (data.access_token) sensitive.push(data.access_token)
      return { status: response.status, data }
    }
    const openLogin = async (page: Page) => {
      await page.getByRole("button", { name: "Đăng nhập", exact: true }).click()
      await page.getByRole("tab", { name: "Đăng nhập", exact: true }).click()
    }
    const login = async (page: Page, customer: Customer, remember = false) => {
      await openLogin(page)
      const dialog = page.getByRole("dialog")
      await dialog.getByLabel("Email", { exact: true }).fill(customer.email)
      await dialog.getByLabel("Mật khẩu", { exact: true }).fill(customer.password)
      if (remember) await dialog.getByRole("checkbox", { name: "Ghi nhớ đăng nhập" }).check()
      const received = page.waitForResponse(response => response.url().endsWith("/api/auth/login"))
      await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click()
      const response = await received
      expect(response.status()).toBe(200)
      const data = await response.json()
      expect(Object.hasOwn(data, "access_token")).toBe(false)
      await expect(page.getByRole("button", { name: customer.name, exact: true })).toBeVisible()
    }

    const profiles: { context: BrowserContext; page: Page; user: AuthUser; customer: Customer }[] = []
    let created = 0
    for (const [index, customer] of customers.entries()) {
      stage = `customer ${index + 1} registration and login`
      const origin = index === 0 ? "http://127.0.0.1:3000" : "http://localhost:3000"
      const context = await browser.newContext({ baseURL: origin })
      contexts.push(context)
      const page = await context.newPage()
      await page.goto(origin, { waitUntil: "networkidle" })
      const before = await directLogin(customer)
      if (before.status === 401) {
        await openLogin(page)
        await page.getByRole("tab", { name: "Đăng ký", exact: true }).click()
        const dialog = page.getByRole("dialog")
        await dialog.getByLabel("Họ và tên", { exact: true }).fill(customer.name)
        await dialog.getByLabel("Email", { exact: true }).fill(customer.email)
        await dialog.getByLabel("Số điện thoại", { exact: true }).fill("0900000000")
        await dialog.getByLabel("Mật khẩu", { exact: true }).fill(customer.password)
        await dialog.getByLabel("Nhập lại mật khẩu", { exact: true }).fill(customer.password)
        await dialog.getByRole("checkbox", { name: /Tôi đồng ý/ }).check()
        const registered = page.waitForResponse(response => response.url().endsWith("/api/auth/register"))
        await dialog.getByRole("button", { name: "Tạo tài khoản", exact: true }).click()
        expect((await registered).status()).toBe(201)
        created++
        await expect(page.getByRole("button", { name: customer.name, exact: true })).toBeVisible()
      } else {
        expect(before.status).toBe(200)
        await login(page, customer)
      }
      const response = await page.request.get("/api/users/me")
      expect(response.status()).toBe(200)
      const data = await response.json()
      expect(data.user.email).toBe(customer.email)
      expect(data.user.role).toBe("customer")
      const cookie = (await context.cookies()).find(value => value.name === cookieName)
      expect(!!cookie && cookie.httpOnly && cookie.sameSite === "Lax").toBe(true)
      if (cookie) sensitive.push(cookie.value)
      expect(await page.evaluate(() => document.cookie.includes("foodorder_session"))).toBe(false)
      expect(await page.evaluate(() => [localStorage, sessionStorage].some(storage =>
        Object.keys(storage).some(key => /auth|token|session|user/i.test(key))))).toBe(false)
      await page.reload({ waitUntil: "networkidle" })
      await page.getByRole("button", { name: customer.name, exact: true }).click()
      await expect(page.getByRole("dialog", { name: "Tài khoản của tôi" }).getByText(customer.email, { exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Đóng thông tin tài khoản" }).click()
      profiles.push({ context, page, user: data.user, customer })
    }

    const [a, b] = profiles
    stage = "cross-user resource protection"
    const access = await directLogin(a.customer)
    const headers = { Authorization: `Bearer ${access.data.access_token}`, "Content-Type": "application/json" }
    const me = await fetch(`${backend}/api/users/me?user_id=${b.user.id}`, { headers })
    expect((await me.json()).user.id).toBe(a.user.id)
    const changed = await a.page.request.put("/api/users/me", { data: { full_name: "Forbidden change", user_id: b.user.id } })
    expect(changed.status()).toBe(422)
    expect((await (await b.page.request.get("/api/users/me")).json()).user.full_name).toBe(b.customer.name)
    const forbidden = await b.page.request.post("/api/auth/logout", { headers: { Origin: "https://example.invalid" } })
    expect(forbidden.status()).toBe(403)
    expect((await b.page.request.get("/api/users/me")).status()).toBe(200)

    stage = "logout and cross-tab synchronization"
    const otherTab = await a.context.newPage()
    await otherTab.goto("http://127.0.0.1:3000", { waitUntil: "networkidle" })
    await expect(otherTab.getByRole("button", { name: a.customer.name, exact: true })).toBeVisible()
    await a.page.getByRole("button", { name: a.customer.name, exact: true }).click()
    await a.page.getByRole("button", { name: "Đăng xuất", exact: true }).click()
    await expect(a.page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible()
    await expect(otherTab.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible()
    expect((await a.page.request.get("/api/users/me")).status()).toBe(401)
    expect((await a.context.cookies()).some(value => value.name === cookieName)).toBe(false)
    await otherTab.close()

    stage = "account service outage UI"
    await a.page.route("**/api/auth/login", route => route.fulfill({ status: 503, contentType: "text/plain", body: "Service unavailable" }))
    await openLogin(a.page)
    const unavailable = a.page.getByRole("dialog")
    await unavailable.getByLabel("Email", { exact: true }).fill(a.customer.email)
    await unavailable.getByLabel("Mật khẩu", { exact: true }).fill(a.customer.password)
    await unavailable.getByRole("button", { name: "Đăng nhập", exact: true }).click()
    await expect(unavailable.getByRole("status")).toContainText("Chưa thể kết nối dịch vụ tài khoản")
    await unavailable.getByRole("button", { name: "Đóng cửa sổ đăng nhập" }).click()
    await a.page.unroute("**/api/auth/login")

    stage = "incorrect password UI"
    await openLogin(a.page)
    const dialog = a.page.getByRole("dialog")
    await dialog.getByLabel("Email", { exact: true }).fill(a.customer.email)
    await dialog.getByLabel("Mật khẩu", { exact: true }).fill("Deliberately-wrong-password")
    await dialog.getByRole("button", { name: "Đăng nhập", exact: true }).click()
    await expect(dialog.getByRole("status")).toContainText("Email hoặc mật khẩu không chính xác")
    await dialog.getByRole("button", { name: "Đóng cửa sổ đăng nhập" }).click()

    stage = "remembered login and expired JWT"
    await login(a.page, a.customer, true)
    const remembered = (await a.context.cookies()).find(value => value.name === cookieName)
    expect(!!remembered && remembered.expires > Date.now() / 1000).toBe(true)
    if (remembered) sensitive.push(remembered.value)
    await a.context.addCookies([{ name: cookieName, value: issue(a.user.id, Math.floor(Date.now() / 1000) - 60),
      url: "http://127.0.0.1:3000", httpOnly: true, sameSite: "Lax" }])
    await a.page.reload({ waitUntil: "networkidle" })
    await expect(a.page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible()
    await expect(a.page.getByText(/Phiên đăng nhập đã hết hạn hoặc không còn hợp lệ/)).toBeVisible()
    expect((await a.context.cookies()).some(value => value.name === cookieName)).toBe(false)

    stage = "stale tab cannot clear a newer authenticated session"
    await a.context.addCookies([{ name: cookieName, value: issue(a.user.id, Math.floor(Date.now() / 1000) + 3),
      url: "http://127.0.0.1:3000", httpOnly: true, sameSite: "Lax" }])
    await a.page.reload({ waitUntil: "networkidle" })
    await expect(a.page.getByRole("button", { name: a.customer.name, exact: true })).toBeVisible()
    const replacement = await a.page.request.post("/api/auth/login", {
      data: { email: b.customer.email, password: b.customer.password },
    })
    expect(replacement.status()).toBe(200)
    const replacementCookie = (await a.context.cookies()).find(value => value.name === cookieName)
    if (replacementCookie) sensitive.push(replacementCookie.value)
    await expect(a.page.getByRole("button", { name: b.customer.name, exact: true })).toBeVisible({ timeout: 10_000 })
    expect((await a.page.request.get("/api/users/me")).status()).toBe(200)

    stage = "automatic expiration timer for a real short-lived JWT"
    await a.context.addCookies([{ name: cookieName, value: issue(a.user.id, Math.floor(Date.now() / 1000) + 3),
      url: "http://127.0.0.1:3000", httpOnly: true, sameSite: "Lax" }])
    await a.page.reload({ waitUntil: "networkidle" })
    await expect(a.page.getByRole("button", { name: a.customer.name, exact: true })).toBeVisible()
    await expect(a.page.getByRole("button", { name: "Đăng nhập", exact: true })).toBeVisible({ timeout: 10_000 })
    expect((await a.context.cookies()).some(value => value.name === cookieName)).toBe(false)
    expect((await a.page.request.get("/api/users/me")).status()).toBe(401)
    console.log(`Auth E2E passed: 2 isolated customers, both origins, HttpOnly cookies, ownership, logout and expiration; new_accounts=${created}.`)
  } catch (error) {
    let message = error instanceof Error ? error.message : "Unknown failure"
    for (const value of sensitive) if (value) message = message.split(value).join("[redacted]")
    throw new Error(`Authentication E2E failed at ${stage}: ${message}`)
  } finally {
    for (const context of contexts) await context.close()
  }
})
