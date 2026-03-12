// src/emails.js
// Client-side email dispatch helper for Sector 317.
//
// Usage:
//   import { sendEmail } from './emails.js'
//   await sendEmail('booking_confirmation', userId, { ...data })
//
// - Fires-and-forgets by default (errors are logged, not thrown).
// - Pass { throw: true } as the 4th arg to get errors bubbled up.
// - Multi-recipient (e.g. match_summary): pass an array of IDs as 2nd arg.
//
// Supported types (see api/email-templates.js for full data shapes):
//   booking_confirmation | booking_cancellation
//   match_summary
//   friend_request | friend_accepted | customer_message
//   merch_purchase | merch_shipping_update | merch_pickup_ready
//   store_credit_applied
//   newsletter  (manager/admin only)
//   welcome
//   social_auth_invite

import { supabase } from './supabase.js'

/**
 * @param {string}          type         - Email template key
 * @param {string|string[]} recipientId  - One user ID or array of user IDs
 * @param {object}          data         - Template-specific data (see email-templates.js)
 * @param {object}          [opts]
 * @param {boolean}         [opts.throw] - If true, re-throws on error instead of logging
 */
export async function sendEmail(type, recipientId, data = {}, opts = {}) {
  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) {
      console.warn('[sendEmail] No active session — email skipped:', type)
      return
    }

    const isMulti = Array.isArray(recipientId)
    const body = {
      type,
      data,
      ...(isMulti ? { recipientIds: recipientId } : { recipientId }),
    }

    const resp = await fetch('/api/send-email', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }))
      throw new Error(`Email API error (${resp.status}): ${err.error ?? JSON.stringify(err)}`)
    }

    const result = await resp.json()
    if (result.errors?.length) {
      console.warn('[sendEmail] Partial send errors:', result.errors)
    }
    return result
  } catch (err) {
    if (opts.throw) throw err
    console.warn('[sendEmail] Failed silently:', err.message)
  }
}

// ── Convenience wrappers ─────────────────────────────────────────────────────
// These document the exact data shape expected by each template.

export function emailBookingConfirmation(recipientId, { sessionType, date, startTime,
  playerCount, amountPaid, creditsApplied, cardLast4, refNum }) {
  return sendEmail('booking_confirmation', recipientId,
    { sessionType, date, startTime, playerCount, amountPaid, creditsApplied, cardLast4, refNum })
}

export function emailBookingCancellation(recipientId, { sessionType, date, startTime, refNum, reason }) {
  return sendEmail('booking_cancellation', recipientId, { sessionType, date, startTime, refNum, reason })
}

export function emailMatchSummary(recipientIds, { sessionType, date, startTime, players, teamOutcome }) {
  return sendEmail('match_summary', recipientIds, { sessionType, date, startTime, players, teamOutcome })
}

export function emailFriendRequest(recipientId, { senderName, senderLeaderboardName }) {
  return sendEmail('friend_request', recipientId, { senderName, senderLeaderboardName })
}

export function emailFriendAccepted(recipientId, { acceptorName, acceptorLeaderboardName }) {
  return sendEmail('friend_accepted', recipientId, { acceptorName, acceptorLeaderboardName })
}

export function emailCustomerMessage(recipientId, { senderName, senderLeaderboardName, message }) {
  return sendEmail('customer_message', recipientId, { senderName, senderLeaderboardName, message })
}

export function emailMerchPurchase(recipientId, { orderRef, items, total, creditsApplied,
  fulfillmentType, shippingAddress, cardLast4 }) {
  return sendEmail('merch_purchase', recipientId,
    { orderRef, items, total, creditsApplied, fulfillmentType, shippingAddress, cardLast4 })
}

export function emailMerchShippingUpdate(recipientId, { orderRef, trackingNumber, carrier,
  estimatedDelivery, trackingUrl }) {
  return sendEmail('merch_shipping_update', recipientId,
    { orderRef, trackingNumber, carrier, estimatedDelivery, trackingUrl })
}

export function emailMerchPickupReady(recipientId, { orderRef, items }) {
  return sendEmail('merch_pickup_ready', recipientId, { orderRef, items })
}

export function emailStoreCreditApplied(recipientId, { amount, reason, newBalance }) {
  return sendEmail('store_credit_applied', recipientId, { amount, reason, newBalance })
}

export function emailNewsletter(recipientIds, { subject, bodyHtml }) {
  return sendEmail('newsletter', recipientIds, { subject, bodyHtml })
}

export function emailWelcome(recipientId) {
  return sendEmail('welcome', recipientId, {})
}

export function emailSocialAuthInvite(recipientId, { recipientName }) {
  return sendEmail('social_auth_invite', recipientId, { recipientName })
}

export function emailPlatoonInviteReceived(recipientId, { platoonTag, platoonName, inviterName }) {
  return sendEmail('platoon_invite_received', recipientId, { platoonTag, platoonName, inviterName })
}

export function emailPlatoonRequestReceived(recipientIds, { applicantName, platoonTag, platoonName, message }) {
  return sendEmail('platoon_request_received', recipientIds, { applicantName, platoonTag, platoonName, message })
}

export function emailPlatoonRequestApproved(recipientId, { platoonTag, platoonName }) {
  return sendEmail('platoon_request_approved', recipientId, { platoonTag, platoonName })
}

export function emailPlatoonRequestDenied(recipientId, { platoonTag, platoonName }) {
  return sendEmail('platoon_request_denied', recipientId, { platoonTag, platoonName })
}
