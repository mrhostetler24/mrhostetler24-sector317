// src/SocialPortal.jsx
// Social tab for the Customer Portal — Profile, Friends, Connect.

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  uploadAvatar, updateOwnAvatar, updateSocialProfile, updateSocialLinks,
  sendFriendRequest, cancelFriendRequest, acceptFriendRequest, rejectFriendRequest,
  removeFriend, searchPlayers, getRecentlyMet, getFriendProfile, getFriendExtended,
  fetchFriends, fetchReceivedRequests, fetchSentRequests,
} from './supabase.js'

// ── Social platforms ──────────────────────────────────────────────────────────
const PLATFORMS = [
  { key: 'twitch',    label: 'Twitch',       color: '#9146FF', abbr: 'TV',  noLink: false, placeholder: 'https://twitch.tv/username' },
  { key: 'discord',   label: 'Discord',      color: '#5865F2', abbr: 'DC',  noLink: true,  placeholder: 'Username (e.g. coolplayer)' },
  { key: 'steam',     label: 'Steam',        color: '#1b2838', abbr: 'STM', noLink: false, placeholder: 'https://steamcommunity.com/id/username' },
  { key: 'xbox',      label: 'Xbox',         color: '#107C10', abbr: 'XB',  noLink: true,  placeholder: 'Gamertag' },
  { key: 'psn',       label: 'PlayStation',  color: '#003087', abbr: 'PS',  noLink: true,  placeholder: 'PSN ID' },
  { key: 'reddit',    label: 'Reddit',       color: '#FF4500', abbr: 'RD',  noLink: false, placeholder: 'https://reddit.com/u/username' },
  { key: 'youtube',   label: 'YouTube',      color: '#FF0000', abbr: 'YT',  noLink: false, placeholder: 'https://youtube.com/@channel' },
  { key: 'tiktok',    label: 'TikTok',       color: '#010101', abbr: 'TT',  noLink: false, placeholder: 'https://tiktok.com/@username' },
  { key: 'kick',      label: 'Kick',         color: '#53FC18', abbr: 'KK',  noLink: false, placeholder: 'https://kick.com/username', darkText: true },
  { key: 'instagram', label: 'Instagram',    color: '#E1306C', abbr: 'IG',  noLink: false, placeholder: 'https://instagram.com/username' },
  { key: 'snapchat',  label: 'Snapchat',     color: '#FFFC00', abbr: 'SC',  noLink: false, placeholder: 'https://snapchat.com/add/username', darkText: true },
  { key: 'bereal',    label: 'BeReal',       color: '#111111', abbr: 'BR',  noLink: true,  placeholder: 'Username' },
  { key: 'pinterest', label: 'Pinterest',    color: '#E60023', abbr: 'PT',  noLink: false, placeholder: 'https://pinterest.com/username' },
  { key: 'twitter',   label: 'X (Twitter)',  color: '#000000', abbr: 'X',   noLink: false, placeholder: 'https://x.com/username' },
  { key: 'facebook',  label: 'Facebook',     color: '#1877F2', abbr: 'FB',  noLink: false, placeholder: 'https://facebook.com/username' },
  { key: 'linkedin',  label: 'LinkedIn',     color: '#0A66C2', abbr: 'in',  noLink: false, placeholder: 'https://linkedin.com/in/username' },
  { key: 'telegram',  label: 'Telegram',     color: '#2AABEE', abbr: 'TG',  noLink: false, placeholder: 'https://t.me/username' },
  { key: 'whatsapp',  label: 'WhatsApp',     color: '#25D366', abbr: 'WA',  noLink: false, placeholder: 'https://wa.me/1234567890', darkText: true },
  { key: 'signal',    label: 'Signal',       color: '#3A76F0', abbr: 'SG',  noLink: true,  placeholder: 'Username' },
  { key: 'website',   label: 'Website',      color: '#555555', abbr: 'WEB', noLink: false, placeholder: 'https://yourwebsite.com' },
]

const PLATFORM_SVGS = {
  twitch: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>
  ),
  discord: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
  ),
  steam: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.497 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z"/></svg>
  ),
  xbox: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.102 7.486C2.781 9.056 2 11.037 2 13.189c0 2.693 1.202 5.107 3.1 6.733C5.417 17.978 7.374 15.546 9.698 13c-1.302-1.48-2.607-2.767-3.99-3.864a18.522 18.522 0 0 0-1.606-1.65zM12 3c-1.258 0-2.84 1.085-4.297 2.686 1.47 1.086 2.865 2.412 4.297 4.02 1.43-1.608 2.825-2.934 4.296-4.02C14.84 4.085 13.258 3 12 3zm5.898 4.486a18.522 18.522 0 0 0-1.605 1.65C14.91 10.233 13.604 11.52 12.302 13c2.323 2.546 4.281 4.978 4.598 6.922C18.798 18.297 20 15.882 20 13.189c0-2.152-.782-4.133-2.102-5.703zM8.56 14.203C6.84 16.15 5.414 18.185 5.24 19.898A9.95 9.95 0 0 0 12 22a9.95 9.95 0 0 0 6.76-2.102c-.175-1.713-1.6-3.748-3.32-5.695C13.819 15.748 12.894 16.43 12 16.43c-.894 0-1.819-.682-3.44-2.227z"/></svg>
  ),
  psn: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.985 2.596v17.548l3.915 1.261V6.688c0-.69.304-1.151.794-.998.636.2.76.87.76 1.559v5.508c2.658 1.287 4.645-.2 4.645-3.458 0-3.33-1.15-4.808-4.507-5.933-1.288-.43-3.675-1.107-5.607-.77M2 17.993c2.9 1.105 5.987 1.6 8.461.967v-2.32c-2.185.52-4.985.387-6.966-.404z"/></svg>
  ),
  reddit: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
  ),
  youtube: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>
  ),
  kick: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 2h4v8l4-8h4l-5 9 5 11h-4l-4-8v8H3V2z"/></svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>
  ),
  snapchat: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.017 0C8.396 0 5.883 1.564 4.632 4.408c-.406.912-.405 1.96-.392 2.924l.01.64c-.285.04-.58.056-.863.056-.617 0-1.14-.098-1.55-.294-.145-.07-.3-.104-.456-.104-.31 0-.6.131-.805.382-.182.22-.267.497-.234.775.07.594.563 1.037 1.23 1.17a4.52 4.52 0 0 0 .49.069c.434.047.74.129.926.244.29.18.427.508.594 1.095a7.4 7.4 0 0 0 .138.416c-.1.057-.228.112-.384.165-.454.153-.989.234-1.495.234-.334 0-.618-.038-.803-.07-.208-.037-.402-.056-.577-.056-.416 0-.74.105-.962.313-.218.203-.33.484-.316.788.028.614.48 1.074 1.278 1.29.063.017.14.032.231.048.622.108 1.665.29 2.27 1.375.348.628 1.12 1.818 2.458 2.79 1.073.773 2.404 1.274 3.96 1.49-.21.352-.537.62-.973.8-.498.206-1.11.31-1.82.31-.286 0-.586-.022-.89-.065-.354-.05-.662-.075-.946-.075-.523 0-.9.096-1.153.293-.254.197-.381.463-.38.792 0 .47.302.888.808 1.127.574.27 1.558.455 2.928.549.12.17.23.44.33.8.126.455.397.686.806.686.27 0 .607-.087 1.006-.26.567-.245 1.228-.37 1.966-.37.74 0 1.407.127 1.981.376.393.172.726.258.99.258.41 0 .678-.233.804-.694.098-.358.206-.625.323-.794 1.374-.094 2.358-.279 2.932-.55.504-.24.806-.658.806-1.126 0-.328-.127-.594-.381-.79-.253-.197-.63-.294-1.153-.294-.284 0-.592.025-.947.075-.303.043-.603.065-.888.065-.712 0-1.325-.104-1.822-.31-.434-.18-.759-.447-.967-.8 1.553-.215 2.882-.717 3.956-1.49 1.34-.972 2.11-2.161 2.46-2.79.606-1.083 1.65-1.267 2.27-1.374.09-.016.17-.031.231-.048.8-.217 1.25-.677 1.278-1.29.014-.305-.098-.586-.316-.789-.221-.208-.546-.313-.963-.313-.174 0-.367.02-.576.056-.185.032-.47.07-.803.07-.506 0-1.04-.081-1.495-.234-.155-.053-.283-.108-.382-.165.05-.137.094-.274.137-.416.167-.587.305-.915.594-1.095.187-.115.492-.197.927-.244a4.52 4.52 0 0 0 .489-.069c.667-.133 1.16-.576 1.23-1.17.033-.278-.052-.555-.234-.775a1.075 1.075 0 0 0-.804-.382c-.157 0-.312.034-.456.104-.41.196-.933.294-1.55.294-.284 0-.578-.017-.864-.056l.01-.64c.014-.965.015-2.012-.39-2.924C18.126 1.564 15.613 0 11.992 0z"/></svg>
  ),
  bereal: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2C3.79 2 2 3.79 2 6v12c0 2.21 1.79 4 4 4h12c2.21 0 4-1.79 4-4V6c0-2.21-1.79-4-4-4H6zm1 4h4c1.1 0 2 .9 2 2v.5c0 .83-.67 1.5-1.5 1.5.83 0 1.5.67 1.5 1.5V12c0 1.1-.9 2-2 2H7V6zm2 2v2h1.5c.28 0 .5-.22.5-.5v-1c0-.28-.22-.5-.5-.5H9zm0 4v2h1.5c.28 0 .5-.22.5-.5v-1c0-.28-.22-.5-.5-.5H9zm5-6h2.5c1.1 0 2 .9 2 2v4c0 1.1-.9 2-2 2H14V6zm2 2v4h.5c.28 0 .5-.22.5-.5V8.5c0-.28-.22-.5-.5-.5H16zm-2 7h5v2h-5v-2z"/></svg>
  ),
  pinterest: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
  ),
  twitter: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
  ),
  linkedin: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
  ),
  telegram: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
  ),
  whatsapp: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
  ),
  signal: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-.27 4.418a7.617 7.617 0 0 1 5.064 1.939l.922-.922a.48.48 0 0 1 .68 0l.17.17a.48.48 0 0 1 0 .68l-.882.882a7.62 7.62 0 0 1 1.744 4.815 7.617 7.617 0 0 1-1.939 5.065l.922.921a.48.48 0 0 1 0 .68l-.17.17a.48.48 0 0 1-.68 0l-.882-.882a7.62 7.62 0 0 1-4.815 1.745 7.617 7.617 0 0 1-5.064-1.939l-.922.922a.48.48 0 0 1-.68 0l-.17-.17a.48.48 0 0 1 0-.68l.882-.882A7.62 7.62 0 0 1 4.17 11.98a7.617 7.617 0 0 1 1.939-5.064l-.922-.922a.48.48 0 0 1 0-.68l.17-.17a.48.48 0 0 1 .68 0l.882.882A7.62 7.62 0 0 1 11.73 4.28zm.27 1.444a6.258 6.258 0 1 0 0 12.516 6.258 6.258 0 0 0 0-12.516z"/></svg>
  ),
  website: (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1 17.93V18c0-.553-.448-1-1-1H8v-2c0-.553-.448-1-1-1H4.07A8.01 8.01 0 0 1 4 12c0-.34.02-.673.07-1H7c.552 0 1 .447 1 1v1h3c.552 0 1-.447 1-1V9l4.93 4.93A8.014 8.014 0 0 1 11 19.93zM17.93 14L13 9.07V8c0-.553-.448-1-1-1h-1V4.07A8.01 8.01 0 0 1 12 4a8 8 0 0 1 7.93 7h-2c0-.553-.448-1-1-1h-1v2l3 3-.18.18A7.984 7.984 0 0 1 17.93 14z"/></svg>
  ),
}

function PlatformIcon({ platformKey, size = 40 }) {
  const p = PLATFORMS.find(pl => pl.key === platformKey)
  if (!p) return null
  const svg = PLATFORM_SVGS[platformKey]
  return (
    <div style={{ width: size, height: size, borderRadius: Math.round(size * 0.2), background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: p.darkText ? '#111' : '#fff', padding: Math.round(size * 0.18) }}>
      {svg ? <svg viewBox={svg.props.viewBox} fill="currentColor" style={{ width: '100%', height: '100%' }}>{svg.props.children}</svg> : <span style={{ fontWeight: 700, fontSize: Math.round(size * 0.3), fontFamily: 'var(--fd)' }}>{p.abbr}</span>}
    </div>
  )
}

function SocialLinksList({ links, editable, onDelete }) {
  if (!links?.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {links.map(link => {
        const p = PLATFORMS.find(pl => pl.key === link.platform)
        if (!p) return null
        return (
          <div key={link.platform} style={{ display: 'flex', alignItems: 'center', gap: '.65rem' }}>
            <PlatformIcon platformKey={link.platform} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '.65rem', color: 'var(--muted)', letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: '.05rem' }}>{p.label}</div>
              {p.noLink ? (
                <div style={{ fontSize: '.88rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.value}</div>
              ) : (
                <a href={link.value} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.88rem', color: 'var(--acc)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', textDecoration: 'none' }}>{link.value}</a>
              )}
            </div>
            {editable && (
              <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '.85rem', padding: '2px 6px', flexShrink: 0, lineHeight: 1 }} onClick={() => onDelete(link.platform)}>✕</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Tier data ────────────────────────────────────────────────────────────────
const TIER_THRESHOLDS = [
  { key: 'recruit',  name: 'Recruit',  min: 0 },
  { key: 'initiate', name: 'Initiate', min: 4 },
  { key: 'operator', name: 'Operator', min: 10 },
  { key: 'striker',  name: 'Striker',  min: 18 },
  { key: 'vanguard', name: 'Vanguard', min: 28 },
  { key: 'sentinel', name: 'Sentinel', min: 40 },
  { key: 'enforcer', name: 'Enforcer', min: 56 },
  { key: 'apex',     name: 'Apex',     min: 71 },
  { key: 'elite',    name: 'Elite',    min: 86 },
  { key: 'legend',   name: 'Legend',   min: 100 },
]
const TIER_COLORS = {
  recruit: '#e8e8e8', initiate: '#8b95c9', operator: '#4db6ac',
  striker: '#85b07a', vanguard: '#5a9a6a', sentinel: '#6b9dcf',
  enforcer: '#c94a5a', apex: '#cd7f32', elite: '#b8bfc7', legend: '#f5c842',
}
const TIER_SHINE = {
  apex:   'drop-shadow(0 0 3px rgba(205,127,50,.55)) drop-shadow(0 0 7px rgba(205,127,50,.35)) drop-shadow(0 0 1px rgba(255,210,130,.6)) brightness(1.08) contrast(1.04)',
  elite:  'drop-shadow(0 0 3px rgba(200,210,220,.6)) drop-shadow(0 0 7px rgba(184,191,199,.35)) drop-shadow(0 0 1px rgba(240,245,255,.55)) brightness(1.13) contrast(1.03)',
  legend: 'drop-shadow(0 0 4px rgba(245,200,66,.65)) drop-shadow(0 0 9px rgba(245,200,66,.35)) drop-shadow(0 0 2px rgba(255,230,120,.55)) brightness(1.1) contrast(1.04)',
}
function TierImg({ tierKey, height = 16 }) {
  const filter = TIER_SHINE[tierKey]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: height * 1.5, height, flexShrink: 0 }}>
      <img src={`/${tierKey}.png`} style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', ...(filter ? { filter } : {}) }} alt={tierKey} />
    </span>
  )
}

function getTierInfo(runs) {
  const n = runs ?? 0
  let idx = 0
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    if (n >= TIER_THRESHOLDS[i].min) { idx = i; break }
  }
  const current = TIER_THRESHOLDS[idx]
  const next = TIER_THRESHOLDS[idx + 1] ?? null
  const runsToNext = next ? next.min - n : 0
  const sessionsToNext = next ? Math.ceil(runsToNext / 2) : 0
  return { current, next, runsToNext, sessionsToNext }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getInitials(name) {
  if (!name) return null
  const m = name.match(/^([A-Za-z]{1,3})-\d/)  // "JJ-5555" → "JJ"
  if (m) return m[1].toUpperCase()
  const words = name.trim().split(/[\s_]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function fmtShortDate(dateStr) {
  if (!dateStr) return null
  const [y, mo, d] = dateStr.split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[mo-1]} ${d}, ${y}`
}

function fmtSec(s) {
  if (!s && s !== 0) return '—'
  const m = Math.floor(s / 60), sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

function fmtMonthYear(dateStr) {
  if (!dateStr) return null
  const [y, m] = dateStr.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m, 10) - 1]} ${y}`
}

function fmtPhone(p) {
  if (!p) return null
  const d = p.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  return p
}

function computeStats(runArr) {
  if (!runArr.length) return null
  const scores = runArr.map(r => r.score ?? 0)
  const times = runArr.filter(r => r.elapsedSeconds != null).map(r => r.elapsedSeconds)
  return {
    sessions: new Set(runArr.map(r => r.reservationId)).size,
    runs:     runArr.length,
    best:     Math.max(...scores),
    avg:      Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10,
    objRate:  Math.round(runArr.filter(r => r.objectiveComplete).length / runArr.length * 100),
    avgTime:  times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
  }
}

// ── Small reusable components ─────────────────────────────────────────────────
function PrivacyToggle({ checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: '.15rem .55rem', borderRadius: 10, flexShrink: 0,
        border: `1px solid ${checked ? 'var(--acc)' : 'var(--bdr)'}`,
        background: checked ? 'rgba(200,224,58,.12)' : 'var(--bg)',
        color: checked ? 'var(--accB)' : 'var(--muted)',
        fontSize: '.68rem', fontWeight: checked ? 700 : 400, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: checked ? 'var(--accB)' : 'var(--muted)' }} />
      {checked ? 'Hidden' : 'Hide from Social'}
    </button>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.65rem .85rem', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--fd)', fontSize: '1.35rem', color: 'var(--accB)' }}>{value}</div>
      <div style={{ fontSize: '.7rem', color: 'var(--muted)', marginTop: '.1rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      {sub && <div style={{ fontSize: '.65rem', color: 'var(--muted)', opacity: .75, marginTop: '.1rem' }}>{sub}</div>}
    </div>
  )
}

function MiniAvatar({ url, hidden, initials, size = 36 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--surf2)', border: '1px solid var(--bdr)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: Math.round(size * 0.4) }}>
      {url && !hidden
        ? <img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
        : initials
          ? <span style={{ color: 'var(--muted)', fontFamily: 'var(--fd)', fontSize: Math.round(size * 0.32), lineHeight: 1 }}>{initials}</span>
          : <span style={{ color: 'var(--muted)' }}>👤</span>}
    </div>
  )
}

function TierChip({ runs }) {
  const { current: tier } = getTierInfo(runs ?? 0)
  const col = TIER_COLORS[tier.key]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '.2rem',
      background: col + '22', border: `1px solid ${col}66`,
      borderRadius: 4, padding: '1px 5px', fontSize: '.62rem',
      color: col, fontFamily: 'var(--fd)', textTransform: 'uppercase', letterSpacing: '.05em',
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <TierImg tierKey={tier.key} height={12} />
      {tier.name}
    </span>
  )
}

function TierIcon({ runs }) {
  const { current: tier } = getTierInfo(runs ?? 0)
  return <TierImg tierKey={tier.key} />
}

// ── Friend Profile Modal ──────────────────────────────────────────────────────
function EnvBar({ label, pct, color }) {
  if (!pct) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
      <div style={{ width: 56, color: 'var(--muted)', fontSize: '.75rem', textAlign: 'right', flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, background: 'rgba(255,255,255,.07)', borderRadius: 3, height: 5, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <div style={{ width: 30, fontFamily: 'var(--fd)', fontSize: '.75rem', color: 'var(--txt)' }}>{pct}%</div>
    </div>
  )
}

function RankCard({ label, rank, score }) {
  const isTop3 = rank && rank <= 3
  return (
    <div style={{ flex: 1, textAlign: 'center', padding: '.5rem .2rem', background: 'var(--surf2)', borderRadius: 5, border: '1px solid var(--bdr)' }}>
      <div style={{ fontSize: '.58rem', color: 'var(--muted)', fontFamily: 'var(--fc)', letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: '.3rem' }}>{label}</div>
      {rank
        ? <div style={{ fontFamily: 'var(--fd)', fontSize: '1.05rem', color: isTop3 ? '#f5c842' : 'var(--txt)', lineHeight: 1 }}>#{rank}</div>
        : <div style={{ color: 'var(--muted)', fontSize: '.85rem', lineHeight: 1 }}>—</div>
      }
      {rank && score != null && (
        <div style={{ fontSize: '.62rem', color: 'var(--muted)', marginTop: '.2rem' }}>{Number(score).toFixed(1)}</div>
      )}
    </div>
  )
}

const FP_SECTION = { fontSize: '.65rem', color: 'var(--muted)', fontFamily: 'var(--fc)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.5rem', marginTop: '1rem' }
const VIZ_COLORS = { V: '#9ca3af', C: '#a78bfa', R: '#f472b6', S: '#60a5fa', B: '#4b5563' }
const AUD_COLORS = { T: 'var(--accB)', C: '#f97316', O: '#6b7280' }

function FriendProfileModal({ userId, users, onClose }) {
  const [profile, setProfile] = useState(null)
  const [ext, setExt]         = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setProfile(null)
    setExt(null)
    Promise.all([
      getFriendProfile(userId),
      getFriendExtended(userId),
    ]).then(([{ data: pd }, { data: ed }]) => {
      const row = Array.isArray(pd) ? pd[0] : pd
      setProfile(row ?? null)
      setExt(ed ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [userId])

  const { current: tier } = profile ? getTierInfo(profile.total_runs ?? 0) : { current: { key: 'recruit', name: 'Recruit' } }
  const tierCol = TIER_COLORS[tier?.key] ?? 'var(--muted)'

  const hasEnv = ext && (ext.viz_std || ext.viz_cosmic || ext.viz_rave || ext.viz_strobe || ext.viz_dark)
  const hasProfile = profile && (profile.profession || profile.home_base_city || profile.home_base_state || profile.bio || profile.motto || profile.phone_last4 || profile.email)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.76)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 8, padding: '1.5rem', maxWidth: 460, width: '100%', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '.6rem', right: '.75rem', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>

        {loading && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '3rem 0' }}>Loading…</div>}
        {!loading && !profile && <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '3rem 0' }}>Profile not found.</div>}

        {!loading && profile && (<>

          {/* ── Header ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--surf2)', border: `2px solid ${tierCol}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem', flexShrink: 0 }}>
              {profile.avatar_url && !profile.hide_avatar
                ? <img src={profile.avatar_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                : <span style={{ color: 'var(--muted)' }}>👤</span>}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--fd)', fontSize: '1.2rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.leaderboard_name}</div>
              {profile.real_name && <div style={{ fontSize: '.82rem', color: 'var(--muted)', marginTop: '.1rem' }}>{profile.real_name}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginTop: '.35rem' }}>
                <TierImg tierKey={tier.key} />
                <span style={{ fontFamily: 'var(--fd)', fontSize: '.75rem', color: tierCol, textTransform: 'uppercase', letterSpacing: '.06em' }}>{tier.name}</span>
              </div>
            </div>
          </div>

          {/* ── Core Stats ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '.5rem' }}>
            <StatCard label="Total Runs" value={profile.total_runs ?? 0} />
            <StatCard label="Avg Score"  value={profile.avg_score != null ? Number(profile.avg_score).toFixed(1) : '—'} />
            <StatCard label="Best Run"   value={profile.best_run   != null ? Number(profile.best_run).toFixed(1) : '—'} />
          </div>

          {/* ── Leaderboard Rankings ── */}
          {ext && (ext.rank_all_time || ext.rank_yearly || ext.rank_monthly || ext.rank_weekly) && (<>
            <div style={FP_SECTION}>Leaderboard Standing</div>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              <RankCard label="All-Time"   rank={ext.rank_all_time} score={ext.score_all_time} />
              <RankCard label="This Year"  rank={ext.rank_yearly}   score={ext.score_yearly} />
              <RankCard label="This Month" rank={ext.rank_monthly}  score={ext.score_monthly} />
              <RankCard label="This Week"  rank={ext.rank_weekly}   score={ext.score_weekly} />
            </div>
          </>)}

          {/* ── Tactical Profile ── */}
          {(hasEnv || ext?.avg_time_sec != null) && (<>
            <div style={FP_SECTION}>Tactical Profile</div>
            <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '.45rem' }}>

              {/* Quick metrics row */}
              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '.2rem' }}>
                {ext.sessions != null && (
                  <div style={{ fontSize: '.8rem' }}>
                    <span style={{ color: 'var(--muted)' }}>Sessions </span>
                    <span style={{ fontFamily: 'var(--fd)', color: 'var(--txt)' }}>{ext.sessions}</span>
                  </div>
                )}
                {ext.avg_time_sec != null && (
                  <div style={{ fontSize: '.8rem' }}>
                    <span style={{ color: 'var(--muted)' }}>Avg Run </span>
                    <span style={{ fontFamily: 'var(--fd)', color: 'var(--txt)' }}>{fmtSec(ext.avg_time_sec)}</span>
                  </div>
                )}
                {ext.obj_pct != null && (
                  <div style={{ fontSize: '.8rem' }}>
                    <span style={{ color: 'var(--muted)' }}>Obj Complete </span>
                    <span style={{ fontFamily: 'var(--fd)', color: 'var(--accB)' }}>{ext.obj_pct}%</span>
                  </div>
                )}
              </div>

              {hasEnv && (<>
                <div style={{ fontSize: '.65rem', color: 'var(--muted)', letterSpacing: '.07em', textTransform: 'uppercase' }}>Visuals</div>
                <EnvBar label="Standard" pct={ext.viz_std}    color={VIZ_COLORS.V} />
                <EnvBar label="Cosmic"   pct={ext.viz_cosmic} color={VIZ_COLORS.C} />
                <EnvBar label="Rave"     pct={ext.viz_rave}   color={VIZ_COLORS.R} />
                <EnvBar label="Strobe"   pct={ext.viz_strobe} color={VIZ_COLORS.S} />
                <EnvBar label="Dark"     pct={ext.viz_dark}   color={VIZ_COLORS.B} />
              </>)}

              {(ext.aud_tunes || ext.aud_cranked || ext.aud_off) && (<>
                <div style={{ fontSize: '.65rem', color: 'var(--muted)', letterSpacing: '.07em', textTransform: 'uppercase', marginTop: '.2rem' }}>Audio</div>
                <EnvBar label="Tunes"   pct={ext.aud_tunes}   color={AUD_COLORS.T} />
                <EnvBar label="Cranked" pct={ext.aud_cranked} color={AUD_COLORS.C} />
                <EnvBar label="Off"     pct={ext.aud_off}     color={AUD_COLORS.O} />
              </>)}
            </div>
          </>)}

          {/* ── Operator Profile ── */}
          {hasProfile && (<>
            <div style={FP_SECTION}>Operator Profile</div>
            <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.65rem .85rem', display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.85rem' }}>
              {profile.profession && <div><span style={{ color: 'var(--muted)' }}>Profession: </span><span style={{ color: 'var(--txt)' }}>{profile.profession}</span></div>}
              {(profile.home_base_city || profile.home_base_state) && <div><span style={{ color: 'var(--muted)' }}>Home Base: </span><span style={{ color: 'var(--txt)' }}>{[profile.home_base_city, profile.home_base_state].filter(Boolean).join(', ')}</span></div>}
              {profile.phone_last4 && <div><span style={{ color: 'var(--muted)' }}>Phone: </span><span style={{ color: 'var(--txt)' }}>••••{profile.phone_last4}</span></div>}
              {profile.email && <div><span style={{ color: 'var(--muted)' }}>Email: </span><span style={{ color: 'var(--txt)', wordBreak: 'break-all' }}>{profile.email}</span></div>}
              {profile.motto && <div style={{ fontStyle: 'italic', color: 'var(--muted)', marginTop: '.1rem' }}>"{profile.motto}"</div>}
              {profile.bio && <div style={{ color: 'var(--txt)', lineHeight: 1.5, marginTop: '.15rem' }}>{profile.bio}</div>}
            </div>
          </>)}

          {/* ── Social Links ── */}
          {(() => {
            const friendUser = (users ?? []).find(u => u.id === userId)
            const links = friendUser?.socialLinks ?? []
            if (!links.length) return null
            return (<>
              <div style={FP_SECTION}>Social Profiles</div>
              <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.65rem .85rem' }}>
                <SocialLinksList links={links} editable={false} />
              </div>
            </>)
          })()}

        </>)}
      </div>
    </div>
  )
}

const MAX_BIO = 250

// ── Main export ───────────────────────────────────────────────────────────────
export default function SocialPortal({ user, users, setUsers, reservations, resTypes, runs, careerRuns, onEditProfile, onFriendsChanged }) {
  const [tab, setTab]                         = useState('profile')
  const [profileStatsSub, setProfileStatsSub] = useState('coop')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarKey, setAvatarKey]             = useState(() => Date.now())
  const [editing, setEditing]                 = useState(false)
  const [editDraft, setEditDraft]             = useState({})
  const [editSaving, setEditSaving]           = useState(false)

  // Social links state
  const [socialLinks, setSocialLinks]         = useState(() => user.socialLinks ?? [])
  const [linkPickerOpen, setLinkPickerOpen]   = useState(false)
  const [linkPlatform, setLinkPlatform]       = useState(null)
  const [linkInputVal, setLinkInputVal]       = useState('')
  const [linkSaving, setLinkSaving]           = useState(false)

  // Friends state
  const [friendships, setFriendships]         = useState([])
  const [receivedRequests, setReceivedRequests] = useState([])
  const [sentRequests, setSentRequests]       = useState([])
  const [recentlyMet, setRecentlyMet]         = useState([])
  const [recentlyMetOffset, setRecentlyMetOffset] = useState(0)
  const [recentlyMetHasMore, setRecentlyMetHasMore] = useState(false)
  const [recentlyMetLoading, setRecentlyMetLoading] = useState(false)
  const [friendLoading, setFriendLoading]     = useState(false)
  const [friendError, setFriendError]         = useState(null)
  const [friendRunsMap, setFriendRunsMap]     = useState({})
  const [searchQuery, setSearchQuery]         = useState('')
  const [searchResults, setSearchResults]     = useState([])
  const [searching, setSearching]             = useState(false)
  const [sendingTo, setSendingTo]             = useState(null) // userId being added
  const [profileModal, setProfileModal]       = useState(null) // userId string
  const searchTimerRef                        = useRef(null)

  // ── Stats computation ────────────────────────────────────────────────────
  const myRes = reservations.filter(r => r.userId === user.id)
  const myResMap = Object.fromEntries(myRes.map(r => [r.id, r]))
  const myRuns = runs.filter(rn => myResMap[rn.reservationId] && rn.score != null)

  const coopResIds = new Set(
    myRes.filter(r => resTypes.find(t => t.id === r.typeId)?.mode === 'coop').map(r => r.id)
  )
  const versResIds = new Set(
    myRes.filter(r => resTypes.find(t => t.id === r.typeId)?.mode === 'versus').map(r => r.id)
  )
  const coopRuns = myRuns.filter(rn => coopResIds.has(rn.reservationId))
  const versRuns = myRuns.filter(rn => versResIds.has(rn.reservationId))

  // Count sessions (unique reservations) won/lost — each session has multiple runs per team
  // winningTeam and pl.team are both integers (1=Hunters, 2=Coyotes)
  const versSessionResults = new Map()
  versRuns.forEach(rn => {
    if (rn.winningTeam == null || versSessionResults.has(rn.reservationId)) return
    const res = myResMap[rn.reservationId]
    const pl = res?.players?.find(p => p.userId === user.id)
    if (pl?.team == null) return
    // eslint-disable-next-line eqeqeq
    versSessionResults.set(rn.reservationId, pl.team == rn.winningTeam ? 'win' : 'loss')
  })
  const versWins   = [...versSessionResults.values()].filter(v => v === 'win').length
  const versLosses = [...versSessionResults.values()].filter(v => v === 'loss').length

  const operatorSince = myRes.length
    ? fmtMonthYear(myRes.reduce((min, r) => r.date < min ? r.date : min, myRes[0].date))
    : null

  // ── Friend helpers ───────────────────────────────────────────────────────
  const friendIds = new Set(
    friendships.map(f => f.user_id_1 === user.id ? f.user_id_2 : f.user_id_1)
  )
  const resolveUser = id => {
    const u = (users ?? []).find(u => u.id === id)
    return u ?? { id, name: 'Operative', leaderboardName: null, avatarUrl: null, hideAvatar: false }
  }

  const loadFriends = useCallback(async () => {
    setFriendLoading(true)
    setFriendError(null)
    try {
      const [{ data: fs, error: e1 }, { data: recv, error: e2 }, { data: sent, error: e3 }] = await Promise.all([
        fetchFriends(user.id),
        fetchReceivedRequests(user.id),
        fetchSentRequests(user.id),
      ])
      const err = e1 || e2 || e3
      if (err) { setFriendError(err.message); return }
      const friendList = fs ?? []
      setFriendships(friendList)
      setReceivedRequests(recv ?? [])
      setSentRequests(sent ?? [])
      // Fetch run counts for friends + request users (for rank icon display)
      const friendIds = friendList.map(f => f.user_id_1 === user.id ? f.user_id_2 : f.user_id_1)
      const reqIds = [
        ...(recv ?? []).map(r => r.from_user_id),
        ...(sent ?? []).map(r => r.to_user_id),
      ]
      const allIds = [...new Set([...friendIds, ...reqIds])]
      const runsMap = {}
      await Promise.all(allIds.map(async id => {
        const { data } = await getFriendProfile(id)
        const row = Array.isArray(data) ? data[0] : data
        if (row) runsMap[id] = row.total_runs ?? 0
      }))
      setFriendRunsMap(runsMap)
    } catch (e) {
      setFriendError(e.message)
    } finally {
      setFriendLoading(false)
    }
  }, [user.id])

  useEffect(() => {
    if (tab === 'friends' || tab === 'connect') loadFriends()
  }, [tab, loadFriends])

  useEffect(() => {
    if (tab !== 'connect') return
    setRecentlyMet([])
    setRecentlyMetOffset(0)
    setRecentlyMetHasMore(false)
    setRecentlyMetLoading(true)
    getRecentlyMet(20, 0).then(({ data, error }) => {
      setRecentlyMetLoading(false)
      if (error) { console.error('getRecentlyMet error:', error); return }
      const rows = data ?? []
      setRecentlyMet(rows)
      setRecentlyMetHasMore(rows.length === 20)
      setRecentlyMetOffset(rows.length)
    })
  }, [tab])

  // Debounced search
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) { setSearchResults([]); return }
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true)
      // Strip formatting chars for phone searches (e.g. "317-867-5309" → "3178675309")
      const digitsOnly = q.replace(/[\s\-().+]/g, '')
      const searchQ = /^\d+$/.test(digitsOnly) && digitsOnly.length >= 2 ? digitsOnly : q
      const { data } = await searchPlayers(searchQ)
      setSearchResults(data ?? [])
      setSearching(false)
    }, 400)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchQuery])

  // ── Friend action handlers ───────────────────────────────────────────────
  async function handleAccept(fromId) {
    await acceptFriendRequest(fromId)
    await loadFriends()
    onFriendsChanged?.()
  }

  async function handleIgnore(fromId) {
    await rejectFriendRequest(fromId)
    setReceivedRequests(prev => prev.filter(r => r.from_user_id !== fromId))
  }

  async function handleRemoveFriend(otherId) {
    if (!window.confirm('Remove this operative from your squad?')) return
    await removeFriend(otherId)
    setFriendships(prev => prev.filter(f => f.user_id_1 !== otherId && f.user_id_2 !== otherId))
    onFriendsChanged?.()
  }

  async function handleSendRequest(toId) {
    if (sendingTo) return
    setSendingTo(toId)
    const { error } = await sendFriendRequest(toId)
    if (!error) {
      setSentRequests(prev =>
        prev.some(r => r.to_user_id === toId)
          ? prev
          : [...prev, { to_user_id: toId, created_at: new Date().toISOString() }]
      )
    } else {
      // 409 = request already exists in other direction — reload to surface incoming request
      await loadFriends()
    }
    setSendingTo(null)
  }

  async function handleCancelRequest(toId) {
    await cancelFriendRequest(toId)
    setSentRequests(prev => prev.filter(r => r.to_user_id !== toId))
  }

  // ── Avatar upload ────────────────────────────────────────────────────────
  const handleAvatarChange = async e => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    try {
      const url = await uploadAvatar(user.id, file)
      await updateOwnAvatar(user.id, url)
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, avatarUrl: url } : u))
      setAvatarKey(Date.now())
    } catch (err) {
      alert('Upload failed: ' + err.message)
    } finally {
      setAvatarUploading(false)
    }
  }

  // ── Social profile edit ──────────────────────────────────────────────────
  function startEditing() {
    setEditDraft({
      motto:         user.motto         || '',
      profession:    user.profession    || '',
      homeBaseCity:  user.homeBaseCity  || '',
      homeBaseState: user.homeBaseState || '',
      bio:           user.bio           || '',
      hidePhone:      user.hidePhone      ?? false,
      hideEmail:      user.hideEmail      ?? false,
      hideName:       user.hideName       ?? false,
      hideAvatar:     user.hideAvatar     ?? false,
      hideMotto:      user.hideMotto      ?? false,
      hideProfession: user.hideProfession ?? false,
      hideHomeBase:   user.hideHomeBase   ?? false,
      hideBio:        user.hideBio        ?? false,
    })
    setEditing(true)
  }

  async function handleSaveSocial() {
    setEditSaving(true)
    try {
      const updated = await updateSocialProfile(user.id, {
        motto:         editDraft.motto.trim()         || null,
        profession:    editDraft.profession.trim()    || null,
        homeBaseCity:  editDraft.homeBaseCity.trim()  || null,
        homeBaseState: editDraft.homeBaseState.trim() || null,
        bio:           editDraft.bio.trim().slice(0, MAX_BIO) || null,
        hidePhone:      editDraft.hidePhone,
        hideEmail:      editDraft.hideEmail,
        hideName:       editDraft.hideName,
        hideAvatar:     editDraft.hideAvatar,
        hideMotto:      editDraft.hideMotto,
        hideProfession: editDraft.hideProfession,
        hideHomeBase:   editDraft.hideHomeBase,
        hideBio:        editDraft.hideBio,
      })
      setUsers(prev => prev.map(u => u.id === user.id ? updated : u))
      setEditing(false)
    } catch (err) {
      alert('Save failed: ' + err.message)
    } finally {
      setEditSaving(false)
    }
  }

  async function saveSocialLinks(newLinks) {
    setLinkSaving(true)
    try {
      const { error } = await updateSocialLinks(newLinks)
      if (error) throw new Error(error.message)
      setSocialLinks(newLinks)
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, socialLinks: newLinks } : u))
    } catch (err) {
      alert('Save failed: ' + err.message)
    } finally {
      setLinkSaving(false)
    }
  }

  const activeStats = profileStatsSub === 'coop' ? computeStats(coopRuns)
    : profileStatsSub === 'versus' ? computeStats(versRuns)
    : computeStats(myRuns)

  const lbl = { color: 'var(--muted)', fontSize: '.87rem' }
  const val = { color: 'var(--txt)',   fontSize: '.87rem' }

  const SECTION_HDR = { fontSize: '.7rem', fontFamily: 'var(--fd)', letterSpacing: '.1em', color: 'var(--acc2)', textTransform: 'uppercase', marginBottom: '.5rem' }

  return (
    <>
      {profileModal && (
        <FriendProfileModal userId={profileModal} users={users} onClose={() => setProfileModal(null)} />
      )}

      {/* Platform picker modal */}
      {linkPickerOpen && (
        <div className="mo" onClick={e => e.target === e.currentTarget && setLinkPickerOpen(false)}>
          <div className="mc" style={{ maxWidth: 480 }}>
            <div className="mt2">Link a Social Profile</div>
            <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginBottom: '1rem' }}>Select a platform to link</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '.55rem' }}>
              {PLATFORMS.filter(p => !socialLinks.some(l => l.platform === p.key)).map(p => (
                <button
                  key={p.key}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.3rem', padding: '.4rem', borderRadius: 6 }}
                  onClick={() => { setLinkPlatform(p); setLinkPickerOpen(false); setLinkInputVal('') }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surf2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <PlatformIcon platformKey={p.key} size={42} />
                  <span style={{ fontSize: '.62rem', color: 'var(--muted)', textAlign: 'center', lineHeight: 1.2 }}>{p.label}</span>
                </button>
              ))}
            </div>
            <div className="ma" style={{ marginTop: '1.25rem' }}>
              <button className="btn btn-s" onClick={() => setLinkPickerOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Platform input modal */}
      {linkPlatform && (
        <div className="mo" onClick={e => e.target === e.currentTarget && setLinkPlatform(null)}>
          <div className="mc" style={{ maxWidth: 400 }}>
            <div className="mt2" style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
              <PlatformIcon platformKey={linkPlatform.key} size={30} />
              <span>{linkPlatform.label}</span>
            </div>
            <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginBottom: '.75rem' }}>
              {linkPlatform.noLink ? 'Enter your username or ID' : 'Enter your profile link'}
            </p>
            <input
              className="inp"
              style={{ width: '100%', boxSizing: 'border-box' }}
              placeholder={linkPlatform.placeholder}
              value={linkInputVal}
              onChange={e => setLinkInputVal(e.target.value)}
              autoFocus
              onKeyDown={async e => {
                if (e.key === 'Enter' && linkInputVal.trim() && !linkSaving) {
                  const newLinks = [...socialLinks, { platform: linkPlatform.key, value: linkInputVal.trim() }]
                  await saveSocialLinks(newLinks)
                  setLinkPlatform(null); setLinkInputVal('')
                }
              }}
            />
            <div className="ma" style={{ marginTop: '1rem', gap: '.5rem' }}>
              <button className="btn btn-s" onClick={() => { setLinkPlatform(null); setLinkInputVal('') }}>Cancel</button>
              <button
                className="btn btn-p"
                disabled={!linkInputVal.trim() || linkSaving}
                onClick={async () => {
                  const newLinks = [...socialLinks, { platform: linkPlatform.key, value: linkInputVal.trim() }]
                  await saveSocialLinks(newLinks)
                  setLinkPlatform(null); setLinkInputVal('')
                }}
              >{linkSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sub-tabs ── */}
      <div className="tabs" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--bdr)' }}>
        <button className={`tab${tab === 'profile' ? ' on' : ''}`} onClick={() => setTab('profile')}>Profile</button>
        <button className={`tab${tab === 'friends' ? ' on' : ''}`} onClick={() => setTab('friends')}>
          Friends
          {receivedRequests.length > 0 && (
            <span style={{ marginLeft: '.35rem', background: '#e04444', color: '#fff', borderRadius: 10, fontSize: '.6rem', padding: '1px 5px', fontFamily: 'var(--fd)', verticalAlign: 'middle' }}>
              {receivedRequests.length}
            </span>
          )}
        </button>
        <button className={`tab${tab === 'connect' ? ' on' : ''}`} onClick={() => setTab('connect')}>Connect</button>
      </div>

      {/* ════════════════════════════════════════════════════════
          PROFILE TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'profile' && <>
        {/* Avatar + Identity */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'var(--surf2)', border: '2px solid var(--bdr)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.2rem' }}>
              {user.avatarUrl
                ? <img src={`${user.avatarUrl}?_=${avatarKey}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                : <span style={{ color: 'var(--muted)' }}>👤</span>}
            </div>
            <label
              title={avatarUploading ? 'Uploading…' : 'Change photo'}
              style={{ position: 'absolute', bottom: 0, right: 0, background: 'var(--acc)', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: avatarUploading ? 'default' : 'pointer', fontSize: '.75rem', border: '2px solid var(--bg)', boxSizing: 'border-box', color: '#111209' }}
            >
              {avatarUploading ? '…' : '✎'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} disabled={avatarUploading} />
            </label>
          </div>

          <div style={{ flex: 1, minWidth: 0, paddingTop: '.25rem' }}>
            <div style={{ fontFamily: 'var(--fd)', fontSize: '1.3rem', color: 'var(--txt)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
            <div style={{ fontSize: '.85rem', color: 'var(--acc2)', marginTop: '.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.leaderboardName || <span style={{ color: 'var(--muted)' }}>No callsign set</span>}
            </div>
            {careerRuns != null && (() => {
              const { current: tier } = getTierInfo(careerRuns)
              const col = TIER_COLORS[tier.key]
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', marginTop: '.45rem', flexWrap: 'wrap', lineHeight: 1 }}>
                  <TierImg tierKey={tier.key} />
                  <span style={{ fontFamily: 'var(--fd)', fontSize: '.78rem', color: col, textTransform: 'uppercase', letterSpacing: '.06em', lineHeight: 1 }}>{tier.name}</span>
                  <span style={{ fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1 }}>· {careerRuns} career run{careerRuns !== 1 ? 's' : ''}</span>
                </div>
              )
            })()}
            {user.motto && !editing && (
              <div style={{ fontSize: '.8rem', color: 'var(--muted)', fontStyle: 'italic', marginTop: '.4rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{user.motto}"</div>
            )}
          </div>
        </div>

        {/* ── Operative Info ── */}
        <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 6, padding: '.75rem 1rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.65rem' }}>
            <div style={{ fontSize: '.7rem', fontFamily: 'var(--fd)', letterSpacing: '.1em', color: 'var(--acc2)', textTransform: 'uppercase' }}>Operative Info</div>
            {!editing && (
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <button className="btn btn-s btn-sm" onClick={startEditing}>✎ Edit Social</button>
                <button className="btn btn-s btn-sm" onClick={onEditProfile}>⚙ Account</button>
              </div>
            )}
          </div>

          {!editing ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '.3rem .85rem', fontSize: '.87rem' }}>
                <span style={lbl}>Name</span>
                <span style={val}>{user.name}</span>

                <span style={lbl}>Callsign</span>
                <span style={{ ...val, color: 'var(--accB)' }}>{user.leaderboardName || <span style={{ color: 'var(--muted)' }}>—</span>}</span>

                {user.profession && <>
                  <span style={lbl}>Profession</span>
                  <span style={val}>{user.profession}</span>
                </>}

                {(user.homeBaseCity || user.homeBaseState) && <>
                  <span style={lbl}>Home Base</span>
                  <span style={val}>{[user.homeBaseCity, user.homeBaseState].filter(Boolean).join(', ')}</span>
                </>}

                {operatorSince && <>
                  <span style={lbl}>Operative Since</span>
                  <span style={val}>{operatorSince}</span>
                </>}

                <span style={lbl}>Phone</span>
                <span style={val}>
                  {user.phone ? fmtPhone(user.phone) : '—'}
                  {user.phone && user.hidePhone && <span style={{ marginLeft: '.5rem', fontSize: '.72rem', color: 'var(--muted)', background: 'var(--surf3,var(--bdr))', borderRadius: 3, padding: '1px 5px' }}>private</span>}
                </span>

                <span style={lbl}>Email</span>
                <span style={{ ...val, wordBreak: 'break-all' }}>
                  {user.email || '—'}
                  {user.email && user.hideEmail && <span style={{ marginLeft: '.5rem', fontSize: '.72rem', color: 'var(--muted)', background: 'var(--surf3,var(--bdr))', borderRadius: 3, padding: '1px 5px' }}>private</span>}
                </span>
              </div>

              {user.bio && (
                <div style={{ marginTop: '.75rem', padding: '.55rem .65rem', background: 'var(--bg)', borderRadius: 4, fontSize: '.84rem', color: 'var(--txt)', lineHeight: 1.5, borderLeft: '2px solid var(--bdr)' }}>
                  {user.bio}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
              <p style={{ margin: 0, fontSize: '.75rem', color: 'var(--muted)' }}>
                Name and callsign are updated in{' '}
                <button onClick={onEditProfile} style={{ fontSize: '.75rem', color: 'var(--accB)', fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Account Settings</button>.
              </p>

              {/* Read-only fields with privacy toggles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', borderBottom: '1px solid var(--bdr)', paddingBottom: '.65rem' }}>
                {[
                  ['Name',          user.name,             'hideName'],
                  ['Profile Photo', null,                   'hideAvatar'],
                  ['Phone',         fmtPhone(user.phone),  'hidePhone'],
                  ['Email',         user.email,            'hideEmail'],
                ].map(([title, val, field]) => (
                  <div key={field} style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <span style={{ fontSize: '.82rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                      {title}
                      {title === 'Profile Photo' && user.avatar_url
                        ? <span style={{ color: 'var(--acc)', fontWeight: 700 }}>✓</span>
                        : null}
                    </span>
                    <PrivacyToggle checked={editDraft[field] ?? false} onChange={v => setEditDraft(d => ({ ...d, [field]: v }))} />
                    {val ? <span style={{ fontSize: '.82rem', color: 'var(--txt)', marginLeft: 'auto' }}>{val}</span> : null}
                  </div>
                ))}
              </div>

              {/* Editable fields with inline privacy toggles */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.2rem' }}>
                  <label style={{ fontSize: '.75rem', color: 'var(--muted)' }}>Motto</label>
                  <PrivacyToggle checked={editDraft.hideMotto ?? false} onChange={v => setEditDraft(d => ({ ...d, hideMotto: v }))} />
                </div>
                <input className="inp" style={{ width: '100%' }} placeholder="Your personal motto…" value={editDraft.motto} maxLength={80} onChange={e => setEditDraft(d => ({ ...d, motto: e.target.value }))} />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.2rem' }}>
                  <label style={{ fontSize: '.75rem', color: 'var(--muted)' }}>Profession</label>
                  <PrivacyToggle checked={editDraft.hideProfession ?? false} onChange={v => setEditDraft(d => ({ ...d, hideProfession: v }))} />
                </div>
                <input className="inp" style={{ width: '100%' }} placeholder="e.g. Software Engineer" value={editDraft.profession} maxLength={60} onChange={e => setEditDraft(d => ({ ...d, profession: e.target.value }))} />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.2rem' }}>
                  <label style={{ fontSize: '.75rem', color: 'var(--muted)' }}>Home Base</label>
                  <PrivacyToggle checked={editDraft.hideHomeBase ?? false} onChange={v => setEditDraft(d => ({ ...d, hideHomeBase: v }))} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px', gap: '.5rem' }}>
                  <input className="inp" style={{ width: '100%' }} placeholder="Indianapolis" value={editDraft.homeBaseCity} maxLength={60} onChange={e => setEditDraft(d => ({ ...d, homeBaseCity: e.target.value }))} />
                  <input className="inp" placeholder="IN" value={editDraft.homeBaseState} maxLength={4} onChange={e => setEditDraft(d => ({ ...d, homeBaseState: e.target.value }))} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.2rem' }}>
                  <label style={{ fontSize: '.75rem', color: 'var(--muted)' }}>
                    Bio <span style={{ color: editDraft.bio.length > MAX_BIO ? 'var(--danger,#e05)' : 'var(--muted)' }}>{editDraft.bio.length}/{MAX_BIO}</span>
                  </label>
                  <PrivacyToggle checked={editDraft.hideBio ?? false} onChange={v => setEditDraft(d => ({ ...d, hideBio: v }))} />
                </div>
                <textarea className="inp" rows={3} style={{ width: '100%', resize: 'vertical' }} placeholder="Tell other operatives a little about yourself…" value={editDraft.bio} maxLength={MAX_BIO} onChange={e => setEditDraft(d => ({ ...d, bio: e.target.value.slice(0, MAX_BIO) }))} />
              </div>

              <div style={{ display: 'flex', gap: '.5rem', paddingTop: '.25rem' }}>
                <button className="btn btn-s" onClick={handleSaveSocial} disabled={editSaving} style={{ minWidth: 90 }}>
                  {editSaving ? 'Saving…' : '✓ Save'}
                </button>
                <button className="btn btn-s btn-sm" onClick={() => setEditing(false)} disabled={editSaving}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Social Links */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.65rem' }}>
            <div style={{ fontSize: '.7rem', fontFamily: 'var(--fd)', letterSpacing: '.1em', color: 'var(--acc2)', textTransform: 'uppercase' }}>Social Links</div>
            {socialLinks.length < PLATFORMS.length && (
              <button className="btn btn-s btn-sm" style={{ fontSize: '.72rem', padding: '2px 10px' }} onClick={() => setLinkPickerOpen(true)}>
                {socialLinks.length === 0 ? '+ Link a Profile' : '+ Link Another'}
              </button>
            )}
          </div>
          {socialLinks.length === 0
            ? <div style={{ fontSize: '.82rem', color: 'var(--muted)', fontStyle: 'italic' }}>No social profiles linked yet.</div>
            : <SocialLinksList links={socialLinks} editable onDelete={async key => { const n = socialLinks.filter(l => l.platform !== key); await saveSocialLinks(n) }} />
          }
        </div>

        {/* Match Stats */}
        <div>
          <div style={{ fontSize: '.7rem', fontFamily: 'var(--fd)', letterSpacing: '.1em', color: 'var(--acc2)', textTransform: 'uppercase', marginBottom: '.65rem' }}>Match Stats</div>
          <div className="tabs" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--bdr)' }}>
            <button className={`tab${profileStatsSub === 'all'    ? ' on' : ''}`} onClick={() => setProfileStatsSub('all')}>All ({myRuns.length})</button>
            <button className={`tab${profileStatsSub === 'coop'   ? ' on' : ''}`} onClick={() => setProfileStatsSub('coop')}>Co-op ({coopRuns.length})</button>
            <button className={`tab${profileStatsSub === 'versus' ? ' on' : ''}`} onClick={() => setProfileStatsSub('versus')}>Versus ({versRuns.length})</button>
          </div>
          {!activeStats && (
            <div className="empty" style={{ paddingTop: '1.25rem' }}>
              <div className="ei">{profileStatsSub === 'coop' ? '🤝' : profileStatsSub === 'versus' ? '⚔' : '🎯'}</div>
              <p style={{ color: 'var(--muted)', fontSize: '.88rem' }}>No {profileStatsSub === 'all' ? '' : profileStatsSub + ' '}runs yet.</p>
            </div>
          )}
          {activeStats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '.5rem', marginBottom: '.75rem' }}>
              <StatCard label="Sessions"   value={activeStats.sessions} />
              <StatCard label="Total Runs" value={activeStats.runs} />
              <StatCard label="Best Score" value={activeStats.best} />
              <StatCard label="Avg Score"  value={activeStats.avg.toFixed(1)} />
              <StatCard label="Obj Rate"   value={`${activeStats.objRate}%`} />
              <StatCard label="Avg Time"   value={fmtSec(activeStats.avgTime)} />
              {(profileStatsSub === 'versus' || profileStatsSub === 'all') && versRuns.length > 0 && <>
                <StatCard label="VS Wins"   value={versWins}
                  sub={versWins + versLosses > 0 ? `${Math.round(versWins / (versWins + versLosses) * 100)}% W/L` : undefined} />
                <StatCard label="VS Losses" value={versLosses} />
              </>}
            </div>
          )}
        </div>
      </>}

      {/* ════════════════════════════════════════════════════════
          FRIENDS TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'friends' && (
        <div>
          {friendLoading && <div style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '.75rem' }}>Loading…</div>}
          {friendError && <div style={{ color: 'var(--danger)', fontSize: '.82rem', marginBottom: '.75rem', padding: '.5rem .75rem', background: 'var(--bg2)', borderRadius: 5, border: '1px solid var(--danger)' }}>Error loading friends: {friendError}</div>}

          {/* Pending received requests */}
          {receivedRequests.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={SECTION_HDR}>Pending Requests</div>
              {receivedRequests.map(req => {
                const sender = resolveUser(req.from_user_id)
                return (
                  <div key={req.from_user_id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderBottom: '1px solid var(--bdr)' }}>
                    <MiniAvatar url={sender.avatarUrl} hidden={sender.hideAvatar} initials={getInitials(sender.leaderboardName || sender.name)} />
                    <TierIcon runs={friendRunsMap[req.from_user_id]} />
                    <span style={{ flex: 1, fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sender.leaderboardName || sender.name || 'Operative'}
                    </span>
                    <button className="btn btn-s" onClick={() => handleAccept(req.from_user_id)} title="Accept" style={{ padding: '3px 10px', fontSize: '.8rem' }}>✓</button>
                    <button className="btn btn-s btn-sm" onClick={() => handleIgnore(req.from_user_id)} title="Ignore" style={{ padding: '3px 8px', fontSize: '.8rem' }}>✕</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Friends list */}
          <div>
            <div style={SECTION_HDR}>Your Squad</div>
            {!friendLoading && friendships.length === 0 && (
              <div className="empty">
                <div className="ei">👥</div>
                <p style={{ color: 'var(--muted)', fontSize: '.9rem', marginBottom: '.5rem' }}>Well, this is awkward... You have no friends.</p>
                <p style={{ color: 'var(--muted)', fontSize: '.78rem' }}>Add some <button className="btn btn-s btn-sm" style={{ display: 'inline', padding: '1px 10px', fontSize: '.78rem', verticalAlign: 'middle' }} onClick={() => setTab('connect')}>HERE</button></p>
              </div>
            )}
            {friendships.map(f => {
              const otherId = f.user_id_1 === user.id ? f.user_id_2 : f.user_id_1
              const friend = resolveUser(otherId)
              return (
                <div
                  key={otherId}
                  style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderBottom: '1px solid var(--bdr)', cursor: 'pointer' }}
                  onClick={() => setProfileModal(otherId)}
                >
                  <MiniAvatar url={friend.avatarUrl} hidden={friend.hideAvatar} initials={getInitials(friend.leaderboardName || friend.name)} />
                  <TierIcon runs={friendRunsMap[otherId]} />
                  <span style={{ flex: 1, fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {friend.leaderboardName || friend.name || 'Operative'}
                  </span>
                  <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>View →</span>
                  <button
                    className="btn btn-s btn-sm"
                    title="Remove from squad"
                    onClick={e => { e.stopPropagation(); handleRemoveFriend(otherId) }}
                    style={{ fontSize: '.72rem', padding: '2px 7px', opacity: .55 }}
                  >✕</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          CONNECT TAB
      ════════════════════════════════════════════════════════ */}
      {tab === 'connect' && (
        <div>
          {/* Search */}
          <div style={{ marginBottom: '1rem' }}>
            <input
              className="inp"
              style={{ width: '100%', boxSizing: 'border-box' }}
              placeholder="🔍 Search by name or phone…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoComplete="off"
            />
            {searching && <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.4rem' }}>Searching…</div>}
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              {searchResults.map(p => {
                const isFriend  = friendIds.has(p.id)
                const isPending = sentRequests.some(r => r.to_user_id === p.id) ||
                                  receivedRequests.some(r => r.from_user_id === p.id)
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderBottom: '1px solid var(--bdr)' }}>
                    <MiniAvatar url={p.avatar_url} hidden={p.hide_avatar} initials={getInitials(p.leaderboard_name)} />
                    <TierIcon runs={p.total_runs} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.leaderboard_name}</div>
                      {p.phone_last4 && <div style={{ fontSize: '.73rem', color: 'var(--muted)' }}>••••{p.phone_last4}</div>}
                    </div>
                    {isFriend ? (
                      <span style={{ fontSize: '.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Friends</span>
                    ) : isPending ? (
                      <span style={{ fontSize: '.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Pending</span>
                    ) : (
                      <button className="btn btn-s" disabled={!!sendingTo} onClick={() => handleSendRequest(p.id)} style={{ fontSize: '.75rem', padding: '3px 10px', whiteSpace: 'nowrap' }}>{sendingTo === p.id ? '…' : 'Add'}</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Sent requests */}
          {sentRequests.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={SECTION_HDR}>Sent Requests</div>
              {sentRequests.map(req => {
                const recipient = resolveUser(req.to_user_id)
                return (
                  <div key={req.to_user_id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderBottom: '1px solid var(--bdr)' }}>
                    <MiniAvatar url={recipient.avatarUrl} hidden={recipient.hideAvatar} initials={getInitials(recipient.leaderboardName || recipient.name)} />
                    <TierIcon runs={friendRunsMap[req.to_user_id]} />
                    <span style={{ flex: 1, fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {recipient.leaderboardName || recipient.name || 'Operative'}
                    </span>
                    <button className="btn btn-s btn-sm" onClick={() => handleCancelRequest(req.to_user_id)} style={{ fontSize: '.75rem', padding: '3px 10px', whiteSpace: 'nowrap' }}>Cancel</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Recently met — always visible */}
          <div style={{ marginTop: sentRequests.length > 0 ? '1.5rem' : 0 }}>
            <div style={SECTION_HDR}>Recently Met</div>
            {friendLoading && <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Loading…</div>}
            {!friendLoading && recentlyMet.length === 0 && (
              <div style={{ fontSize: '.85rem', color: 'var(--muted)', fontStyle: 'italic', padding: '.4rem 0' }}>
                No operatives from recent sessions to show yet.
              </div>
            )}
            {recentlyMetLoading && recentlyMet.length === 0 && <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Loading…</div>}
            {recentlyMet.map(p => {
              const isFriend  = friendIds.has(p.id)
              const isPending = sentRequests.some(r => r.to_user_id === p.id) ||
                                receivedRequests.some(r => r.from_user_id === p.id)
              const initials  = getInitials(p.leaderboard_name)
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.55rem 0', borderBottom: '1px solid var(--bdr)' }}>
                  <MiniAvatar url={p.avatar_url} hidden={p.hide_avatar} initials={initials} />
                  <TierIcon runs={p.total_runs} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '.9rem', color: 'var(--txt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.leaderboard_name}</div>
                    <div style={{ fontSize: '.73rem', color: 'var(--muted)', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                      {p.phone_last4 && <span>••••{p.phone_last4}</span>}
                      {p.last_together && <span>Played {fmtShortDate(p.last_together)}</span>}
                    </div>
                  </div>
                  {isFriend ? (
                    <span style={{ fontSize: '.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Friends</span>
                  ) : isPending ? (
                    <span style={{ fontSize: '.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Pending</span>
                  ) : (
                    <button className="btn btn-s" onClick={() => handleSendRequest(p.id)} style={{ fontSize: '.75rem', padding: '3px 10px', whiteSpace: 'nowrap' }}>Add</button>
                  )}
                </div>
              )
            })}
            {recentlyMetHasMore && (
              <button
                className="btn btn-s btn-sm"
                disabled={recentlyMetLoading}
                style={{ marginTop: '.75rem', width: '100%' }}
                onClick={() => {
                  setRecentlyMetLoading(true)
                  getRecentlyMet(20, recentlyMetOffset).then(({ data, error }) => {
                    setRecentlyMetLoading(false)
                    if (error) { console.error('getRecentlyMet error:', error); return }
                    const rows = data ?? []
                    setRecentlyMet(prev => [...prev, ...rows])
                    setRecentlyMetHasMore(rows.length === 20)
                    setRecentlyMetOffset(prev => prev + rows.length)
                  })
                }}
              >{recentlyMetLoading ? 'Loading…' : 'Load more'}</button>
            )}
          </div>

        </div>
      )}
    </>
  )
}
