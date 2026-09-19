export const API_BASE_URL = 'https://api.track.toggl.com/api/v9'
export const REPORTS_BASE_URL = 'https://api.track.toggl.com/reports/api/v3'

export const KEYCHAIN_SERVICE = 'toggl-track'
export const KEYCHAIN_ITEM_NOT_FOUND_EXIT_CODE = 44

export const TOKEN_ENV_VAR = 'TOGGL_API_TOKEN'

export const MIN_REQUEST_INTERVAL_MS = 1100
export const REQUEST_TIMEOUT_MS = 20000
export const MAX_RETRIES = 4
export const RETRY_BASE_DELAY_MS = 500
export const RETRY_MAX_DELAY_MS = 15000

export const ME_ENTRIES_HARD_LIMIT = 1000
export const REPORTS_PAGE_SIZE = 1000
export const REPORTS_MAX_PAGES = 50
export const BULK_PATCH_MAX_IDS = 100

export const DIRECT_FETCH_MAX_SPAN_DAYS = 31
export const DEFAULT_PENDING_LOOKBACK_DAYS = 90

export const CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export const PENDING_TAG = 'pending'
export const REGISTERED_TAG = 'registered'

export const MAX_TASK_SECONDS = 8 * 60 * 60
export const ESTIMATE_STEP_SECONDS = 30 * 60

export const CREATED_WITH = 'toggl-track-cli/0.1.0'
export const PENDING_TAG_FALLBACK = 'Pending'
export const MIRROR_STALE_MS = 12 * 60 * 60 * 1000
export const NOTE_BODY_MAX = 16384
export const TITLE_SOFT_MAX = 80
export const TITLE_HARD_MAX = 200

export const SCHEMA_VERSION = 2
