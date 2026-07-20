const OWNER_STORAGE_KEY = 'fs0ciety_owner'

export function isOwner() {
  try {
    return localStorage.getItem(OWNER_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

// Visiting once with ?owner=1 remembers the flag in localStorage and scrubs
// the param from the URL, so the site owner's own visits stop generating
// "returning visitor" noise in the live feed.
export function captureOwnerFlagFromUrl() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('owner') !== '1') return

  try {
    localStorage.setItem(OWNER_STORAGE_KEY, '1')
  } catch {
    // storage disabled, nothing we can do
  }

  params.delete('owner')
  const query = params.toString()
  const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  window.history.replaceState({}, '', newUrl)
}
