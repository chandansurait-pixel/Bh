import express from "express"
import puppeteer from "puppeteer"
import { z } from "zod"
import { createJob, createRtpsAdapter } from "./rtps-adapter.js"

const app = express()
const port = Number(process.env.PORT || 8080)
const secret = process.env.WORKER_SHARED_SECRET
const jobs = new Map()

app.use(express.json({ limit: "256kb" }))

app.get("/health", (_request, response) => response.json({ ok: true, service: "rtps-worker" }))

app.use((request, response, next) => {
  if (!secret || request.get("authorization") !== `Bearer ${secret}`) return response.status(401).json({ error: "Unauthorized" })
  next()
})

app.post("/jobs", async (_request, response) => {
  if (jobs.size >= 2) return response.status(429).json({ error: "Worker concurrency limit reached" })
  const job = createJob()
  jobs.set(job.id, job)
  try {
    job.browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] })
    job.adapter = createRtpsAdapter({ browser: job.browser, job })
    await job.adapter.start()
    response.status(201).json(publicJob(job))
  } catch (error) {
    await cleanup(job)
    response.status(502).json({ error: "Unable to open RTPS portal" })
  }
})

app.get("/jobs/:id", (request, response) => {
  const job = jobs.get(request.params.id)
  if (!job) return response.status(404).json({ error: "Job not found" })
  response.json(publicJob(job))
})

app.post("/jobs/:id/captcha", async (request, response) => {
  const job = jobs.get(request.params.id)
  if (!job) return response.status(404).json({ error: "Job not found" })
  const parsed = z.object({ code: z.string().trim().min(4).max(12) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: "Invalid CAPTCHA" })
  try {
    await job.adapter.continueAfterCaptcha(parsed.data)
    response.json(publicJob(job))
  } catch {
    response.status(409).json({ error: "CAPTCHA step is unavailable" })
  }
})

app.post("/jobs/:id/confirm-submit", async (request, response) => {
  const job = jobs.get(request.params.id)
  if (!job) return response.status(404).json({ error: "Job not found" })
  if (request.body?.confirm !== true) return response.status(400).json({ error: "Explicit confirmation required" })
  job.captchaConfirmed = true
  try {
    await job.adapter.confirmSubmit()
    response.json(publicJob(job))
  } catch (error) {
    response.status(409).json({ error: error.message })
  }
})

app.delete("/jobs/:id", async (request, response) => {
  const job = jobs.get(request.params.id)
  if (job) await cleanup(job)
  response.status(204).end()
})

function publicJob(job) {
  return { id: job.id, state: job.state, message: job.message || null, createdAt: job.createdAt }
}

async function cleanup(job) {
  await job.adapter?.cleanup().catch(() => {})
  await job.browser?.close().catch(() => {})
  jobs.delete(job.id)
}

setInterval(() => {
  for (const job of jobs.values()) if (Date.now() - job.createdAt > 10 * 60 * 1000) cleanup(job)
}, 60_000).unref()

app.listen(port, () => console.log(`RTPS worker listening on ${port}`))
