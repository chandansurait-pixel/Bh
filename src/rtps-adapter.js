import { randomUUID } from "node:crypto"

const RTPS_ORIGIN = "https://serviceonline.bihar.gov.in"

export function createRtpsAdapter({ browser, job }) {
  let page

  return {
    async start() {
      page = await browser.newPage()
      await page.setRequestInterception(true)
      page.on("request", (request) => {
        const url = request.url()
        if (url.startsWith(RTPS_ORIGIN)) request.continue()
        else request.abort()
      })
      await page.goto(RTPS_ORIGIN, { waitUntil: "domcontentloaded", timeout: 45_000 })
      job.state = "awaiting_manual_portal_check"
      job.message = "RTPS खुल गया है। लाइव पोर्टल के वर्तमान selectors और OTP/CAPTCHA चरण की पुष्टि आवश्यक है।"
    },

    async continueAfterCaptcha({ code }) {
      if (!page) throw new Error("RTPS page is not ready")
      if (!code || code.length < 4) throw new Error("A user-entered CAPTCHA is required")
      job.state = "manual_confirmation_required"
      job.message = "CAPTCHA प्राप्त हुआ। अंतिम submit से पहले उपयोगकर्ता की स्पष्ट पुष्टि आवश्यक है।"
      job.captchaConfirmed = false
    },

    async confirmSubmit() {
      if (!page || !job.captchaConfirmed) throw new Error("Explicit submit confirmation is required")
      throw new Error("RTPS adapter is intentionally not enabled until current selectors and written authorization are verified")
    },

    async cleanup() {
      await page?.close().catch(() => {})
    },
  }
}

export function createJob() {
  return { id: randomUUID(), state: "created", createdAt: Date.now(), captchaConfirmed: false }
}
