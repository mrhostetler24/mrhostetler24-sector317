import { supabase } from "./supabase.client.js"

// local copy of toUser used by updateSocialProfile
const toUser = r => r ? ({
  id:                 r.id,
  name:               r.name,
  phone:              r.phone,
  email:              r.email,
  authId:             r.auth_id,
  access:             r.access,
  role:               r.role,
  active:             r.active,
  authProvider:       r.auth_provider,
  needsRewaiverDocId: r.needs_rewaiver_doc_id,
  waivers:            r.waivers ?? [],
  leaderboardName:        r.leaderboard_name ?? null,
  hideFromLeaderboard:    r.hide_from_leaderboard ?? false,
  isReal:                 r.is_real ?? true,
  createdByUserId:    r.created_by_user_id ?? null,
  createdAt:          r.created_at ?? null,
  avatarUrl:          r.avatar_url ?? null,
  motto:              r.motto ?? null,
  homeBaseCity:       r.home_base_city ?? null,
  homeBaseState:      r.home_base_state ?? null,
  profession:         r.profession ?? null,
  bio:                r.bio ?? null,
  hidePhone:          r.hide_phone  ?? false,
  hideEmail:          r.hide_email  ?? false,
  hideName:           r.hide_name       ?? false,
  hideAvatar:         r.hide_avatar     ?? false,
  hideMotto:          r.hide_motto      ?? false,
  hideProfession:     r.hide_profession ?? false,
  hideHomeBase:       r.hide_home_base  ?? false,
  hideBio:            r.hide_bio        ?? false,
  socialLinks:        r.social_links    ?? [],
  zipCode:            r.zip_code        ?? null,
  credits:            r.credits         ?? 0,
  platoonTag:         r.platoon_tag        ?? null,
  platoonBadgeColor:  r.platoon_badge_color ?? null,
  canBook:            r.can_book           ?? false,
}) : null

// ============================================================
// AVATAR / PROFILE PICTURE
// ============================================================

/** Resize an image file to at most maxPx on the longest side, returned as JPEG blob. */
function resizeImage(file, maxPx = 512, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Image resize failed')); return }
        resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
    img.src = url
  })
}

/** Upload a profile picture to Supabase Storage (bucket: avatars) and return the public URL. */
export async function uploadAvatar(_userId, file) {
  const MAX_BYTES = 8 * 1024 * 1024 // 8 MB pre-resize guard
  if (file.size > MAX_BYTES) throw new Error('File too large — please choose an image under 8 MB.')
  const resized = await resizeImage(file, 512, 0.85)
  // RLS policy checks auth.uid() — use the session's auth UUID, not the public.users id
  const { data: { session } } = await supabase.auth.getSession()
  const authUid = session?.user?.id
  if (!authUid) throw new Error('Not authenticated.')
  const path = `${authUid}/avatar.jpg`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, resized, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}

/** Persist the avatar URL to the users table via SECURITY DEFINER RPC. */
export async function updateOwnAvatar(userId, avatarUrl) {
  const { error } = await supabase.rpc('update_own_avatar', {
    p_user_id:   userId,
    p_avatar_url: avatarUrl,
  })
  if (error) throw error
}

/** Update social profile fields (motto, home base, profession, bio, privacy flags). */
export async function updateSocialProfile(id, { leaderboardName, avatarUrl, motto, homeBaseCity, homeBaseState, profession, bio, zipCode, hidePhone, hideEmail, hideName, hideAvatar, hideMotto, hideProfession, hideHomeBase, hideBio }) {
  const { error } = await supabase.rpc('update_social_profile', {
    p_user_id:          id,
    p_leaderboard_name: leaderboardName ?? null,
    p_avatar_url:       avatarUrl       ?? null,
    p_motto:            motto           ?? null,
    p_home_base_city:   homeBaseCity    ?? null,
    p_home_base_state:  homeBaseState   ?? null,
    p_profession:       profession      ?? null,
    p_bio:              bio             ?? null,
    p_zip_code:         zipCode         ?? null,
    p_hide_phone:       hidePhone       ?? false,
    p_hide_email:       hideEmail       ?? false,
    p_hide_name:        hideName        ?? false,
    p_hide_avatar:      hideAvatar      ?? false,
    p_hide_motto:       hideMotto       ?? false,
    p_hide_profession:  hideProfession  ?? false,
    p_hide_home_base:   hideHomeBase    ?? false,
    p_hide_bio:         hideBio         ?? false,
  })
  if (error) throw error
  // RPC returns void — fetch the updated row separately
  const { data: row, error: fetchErr } = await supabase
    .from('users').select('*').eq('id', id).single()
  if (fetchErr) throw fetchErr
  return toUser(row)
}


// ============================================================
// FRIENDS
// ============================================================

export const sendFriendRequest   = (toId)    => supabase.rpc('send_friend_request',   { p_to: toId })
export const cancelFriendRequest = (toId)    => supabase.rpc('cancel_friend_request', { p_to: toId })
export const acceptFriendRequest = (fromId)  => supabase.rpc('accept_friend_request', { p_from: fromId })
export const rejectFriendRequest = (fromId)  => supabase.rpc('reject_friend_request', { p_from: fromId })
export const removeFriend        = (otherId) => supabase.rpc('remove_friend',          { p_other: otherId })
export const searchPlayers       = (query)   => supabase.rpc('search_players',         { p_query: query })
export const getRecentlyMet      = (limit = 20, offset = 0) => supabase.rpc('get_recently_met', { p_limit: limit, p_offset: offset })
export const updateSocialLinks   = (links) => supabase.rpc('update_social_links', { p_links: links })
export const getFriendProfile    = (userId)  => supabase.rpc('get_friend_profile',     { p_user_id: userId })
export const getFriendExtended   = (userId)  => supabase.rpc('get_friend_extended',    { p_user_id: userId })

export const fetchFriends = (userId) =>
  supabase.rpc('get_friends', { p_user_id: userId })

export const fetchReceivedRequests = async (userId) => {
  const r = await supabase.rpc('get_pending_friend_requests', { p_for_user: userId })
  if (!r.error) return r
  // RPC not deployed yet — fall back to direct query
  return supabase.from('friend_requests')
    .select('id, from_user_id, created_at')
    .eq('to_user_id', userId)
    .order('created_at', { ascending: false })
}

export const fetchSentRequests = async (userId) => {
  const r = await supabase.rpc('get_sent_friend_requests', { p_for_user: userId })
  if (!r.error) return r
  // RPC not deployed yet — fall back to direct query
  return supabase.from('friend_requests')
    .select('id, to_user_id, created_at')
    .eq('from_user_id', userId)
    .order('created_at', { ascending: false })
}

// ============================================================
// PLATOONS
// ============================================================

const rpc = (fn, params) => supabase.rpc(fn, params).then(r => { if (r.error) throw r.error; return r.data })

export const searchPlatoons          = (query = '')           => rpc('search_platoons',          { p_query: query })
export const getPlatoonForUser       = (userId)               => rpc('get_platoon_for_user',      { p_user_id: userId })
export const getPlatoonMembers       = (platoonId)            => rpc('get_platoon_members',       { p_platoon_id: platoonId })
export const getPlatoonJoinRequests  = ()                     => rpc('get_platoon_join_requests', {})
export const getPlatoonPosts         = (platoonId, limit=20, offset=0) => rpc('get_platoon_posts', { p_platoon_id: platoonId, p_limit: limit, p_offset: offset })
export const getPlatoonSessions      = (platoonId)            => rpc('get_platoon_sessions',      { p_platoon_id: platoonId })
export const getPlatoonUpcoming      = (platoonId)            => rpc('get_platoon_upcoming',      { p_platoon_id: platoonId })
export const createPlatoon           = (tag, name, desc, isOpen) => rpc('create_platoon',         { p_tag: tag, p_name: name, p_description: desc, p_is_open: isOpen })
export const joinPlatoon             = (platoonId)            => rpc('join_platoon',              { p_platoon_id: platoonId })
export const requestToJoin           = (platoonId, message)   => rpc('request_to_join',           { p_platoon_id: platoonId, p_message: message })
export const cancelJoinRequest       = (platoonId)            => rpc('cancel_join_request',       { p_platoon_id: platoonId })
export const getMyJoinRequests       = ()                      => rpc('get_my_join_requests',       {})
export const approveJoinRequest      = (requestId)            => rpc('approve_join_request',      { p_request_id: requestId })
export const denyJoinRequest         = (requestId)            => rpc('deny_join_request',         { p_request_id: requestId })
export const goAwol                  = ()                     => rpc('go_awol',                   {})
export const kickPlatoonMember       = (targetUserId)         => rpc('kick_platoon_member',       { p_target_user_id: targetUserId })
export const setPlatoonMemberRole    = (targetUserId, role)   => rpc('set_platoon_member_role',   { p_target_user_id: targetUserId, p_new_role: role })
export const transferPlatoonAdmin    = (newAdminUserId)       => rpc('transfer_platoon_admin',    { p_new_admin_user_id: newAdminUserId })
export const disbandPlatoon          = ()                     => rpc('disband_platoon',           {})
export const postPlatoonMessage      = (platoonId, content)   => rpc('post_platoon_message',      { p_platoon_id: platoonId, p_content: content })
export const deletePlatoonPost       = (postId)               => rpc('delete_platoon_post',       { p_post_id: postId })
export const updatePlatoonTag        = (tag)                  => rpc('update_platoon_tag',         { p_tag: tag })
export const updatePlatoonSettings   = (name, desc, isOpen)   => rpc('update_platoon_settings',   { p_name: name, p_description: desc, p_is_open: isOpen })
export const updatePlatoonBadge      = (badgeUrl)             => rpc('update_platoon_badge',      { p_badge_url: badgeUrl })
export const updatePlatoonBadgeColor = (color)               => rpc('update_platoon_badge_color', { p_color: color })
export const searchInvitablePlayers  = (platoonId, query)     => rpc('search_invitable_players',  { p_platoon_id: platoonId, p_query: query })
export const inviteToPlatoon         = (toUserId)             => rpc('invite_to_platoon',         { p_to_user_id: toUserId })
export const cancelPlatoonInvite        = (inviteId)          => rpc('cancel_platoon_invite',          { p_invite_id: inviteId })
export const getPlatoonPendingInvites   = ()                  => rpc('get_platoon_pending_invites',    {})
export const getMyPlatoonInvites     = ()                     => rpc('get_my_platoon_invites',    {})
export const acceptPlatoonInvite     = (inviteId)             => rpc('accept_platoon_invite',     { p_invite_id: inviteId })
export const declinePlatoonInvite    = (inviteId)             => rpc('decline_platoon_invite',    { p_invite_id: inviteId })

export const uploadPlatoonBadge = async (platoonId, file) => {
  const ext = file.name.split('.').pop()
  const path = `platoon-badges/${platoonId}.${ext}`
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl + '?v=' + Date.now()
}
